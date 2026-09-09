/**
 * Pin.Porn (pin.porn) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Pin.Porn 是 Vue SPA,后端 REST JSON API 挂在同域 /api/*。竖屏短视频聚合(reddit/onlyfans 等)。
 *  - 【重要:主 videoList 接口对数据中心出口 IP 降级返空】——
 *    /api/videoList/?from=<游标> 在浏览器(住宅 IP)正常,但经代理(机房 IP)一律返回
 *    {page_total:0,data:[]}。故【不用 videoList】,改走 /api/searchVideos —— 后者对机房 IP
 *    仍返回全库数据(q= 空即全站 243k+ 条),是唯一稳定可用的浏览路径。
 *  - 【分页对策】searchVideos 的 from 游标同样被机房 IP 屏蔽(from=任意值都返回同一批),
 *    但它【无视 from 却尊重 ipp(每页条数,无上限)且返回顺序稳定】。故用
 *    ipp = page * PER 拉一批,再 slice((page-1)*PER, page*PER) 取当前页 —— 翻页真实有效。
 *    (代价:翻到第 N 页会重复拉前 N-1 页的数据,但 pin.porn 响应快、条目轻,可接受。)
 *  - 【排序】searchVideos 支持 sort_by=post_date(最新,默认)/rating/views。
 *  - 【分类】tag_id/cs_id 走 videoInfo 同样被机房 IP 屏蔽 → 改用 tagsList 拿热门 tag 名,
 *    分类浏览 = searchVideos?q=<tag 名>(全文搜索,足够呈现该主题内容)。
 *  - 【播放】item.link = https://pin.porn/get_file/1/<hash>/<shard>/<id>/<id>.mp4/
 *    → 302 跳 privatehost.com CDN 直链(带 sign/exp,实测 Range 206 video/mp4)。
 *    link 里的 hash 会过期,故 playUrl 存 item.link,resolvePlayUrl 时原样交给 dyproxy
 *    (它跟随 302 到新鲜直链)。CDN 不校验 Referer/UA。
 *  - 封面 item.screen = pin.porn/contents/videos_screenshots/<shard>/<id>/180x320/1.jpg。
 *  - 国内直连被墙 → 「设置 → 代理」配代理。成人内容源,需自行确认法律/ToS 并配年龄门控。
 *
 * 实测证据 (2026-07,经 127.0.0.1:7897 机房 IP 代理匿名验证):
 *  - LIST: searchVideos?q=&ipp=500 → 200,n=500,顺序稳定;sort_by=rating 返回不同排序。
 *  - CATS: tagsList → 分字母的 tag 清单(带 videos 计数);热门 tag 如 "18 years old"(3217)。
 *  - PLAY: get_file link → 302 → nvms10-b.cdn.privatehost.com/.../<id>.mp4?sign=.. → Range 206 video/mp4。
 */
return {
  meta: {
    name: "Pin.Porn",
    author: "DouyTV",
    version: "0.1.0",
    description: "Pin.Porn 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _PER: 24,

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://pin.porn";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx, json) {
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      Referer: this._base(ctx) + "/",
      Accept: json
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 25000,
      // pin.porn 走 Cloudflare —— ureq(HTTP/1.1 + rustls 默认指纹)会被 bot 检测层
      // 403/连接重置。走 reqwest(http2)栈更接近浏览器,实测 API 在浏览器指纹下正常。
      http2: true,
    });
    if (!res.ok) throw new Error("Pin.Porn HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [
      { id: "latest", name: "最新", group: "浏览" },
      { id: "rating", name: "高分", group: "浏览" },
      { id: "views", name: "最多播放", group: "浏览" },
    ];
    let tags = [];
    try {
      tags = await this._fetchTags(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Pin.Porn tag 抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const t of tags) {
      (this._asianRank(t.title) < 99 ? asian : other).push(t);
    }
    const item = (t, group) => ({ id: "q:" + t.title, name: t.title, group });
    for (const t of asian) sources.push(item(t, "亚洲"));
    for (const t of other) sources.push(item(t, "分类"));
    return sources;
  },

  /** tagsList → 按 videos 数降序取热门 tag 名(做分类)。缓存一天。 */
  async _fetchTags(ctx) {
    const CK = "pinporn:tags:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const data = await this._getJson(ctx, "/api/tagsList/", {});
    const flat = [];
    for (const group of (data && data.data) || []) {
      for (const t of (group && group.tags) || []) {
        if (!t || !t.title) continue;
        flat.push({
          id: String(t.id || ""),
          title: this._decode(String(t.title)).trim(),
          videos: parseInt(t.videos || "0", 10) || 0,
        });
      }
    }
    // 过滤太小的 tag,按热度降序,取前 60。
    flat.sort((a, b) => b.videos - a.videos);
    const out = flat.filter((t) => t.videos >= 30 && t.title.length <= 24).slice(0, 60);
    if (out.length) {
      try {
        await ctx.cache.set(CK, out, 86400);
      } catch (e) {
        /* ignore */
      }
    }
    return out;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    if (id.indexOf("q:") === 0) {
      return this._feed(ctx, p, { q: id.slice(2), sort: "post_date" });
    }
    if (id === "rating") return this._feed(ctx, p, { q: "", sort: "rating" });
    if (id === "views") return this._feed(ctx, p, { q: "", sort: "views" });
    return this._feed(ctx, p, { q: "", sort: "post_date" });
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feed(ctx, p, { q: kw, sort: "post_date" });
  },

  /**
   * searchVideos 浏览流。from 游标对机房 IP 失效,但 ipp 有效且顺序稳定 →
   * 拉 ipp = page*PER 条,slice 出当前页,实现真实翻页。
   */
  async _feed(ctx, page, opt) {
    const PER = this._PER;
    const need = page * PER;
    const query = { q: opt.q || "", ipp: need };
    if (opt.sort && opt.sort !== "post_date") query.sort_by = opt.sort;

    let data;
    try {
      data = await this._getJson(ctx, "/api/searchVideos/", query);
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    const all = Array.isArray(data && data.data) ? data.data : [];
    const slice = all.slice((page - 1) * PER, page * PER);
    const list = [];
    for (const it of slice) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    // 拉满 need 条 → 说明可能还有下一页;不足 → 到底。
    const hasMore = all.length >= need && slice.length > 0;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /** searchVideos item → ScriptVodItem。缓存 link/screen/title 供 detail 命中。 */
  _toVod(it) {
    if (!it || !it.id || !it.link) return null;
    const id = String(it.id);
    const title = this._decode(String(it.title || "")).trim() || id;
    const poster = it.screen || "";
    const author = (it.user && it.user.userTitle) || (it.cs && it.cs.csName) || "";

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = { link: it.link, title, poster, author };

    return {
      id,
      title,
      poster: poster || undefined,
      type_name: author || undefined,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info || !info.link) {
      // 缓存 miss:searchVideos 无按 id 精确查的接口 → 用 id 当关键词兜底找回。
      try {
        const data = await this._getJson(ctx, "/api/searchVideos/", {
          q: "",
          ipp: 1,
          from: id,
        });
        const arr = (data && data.data) || [];
        for (const it of arr) {
          if (String(it.id) === String(id)) {
            info = {
              link: it.link,
              title: this._decode(String(it.title || "")).trim() || id,
              poster: it.screen || "",
            };
            break;
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
    if (!info || !info.link) throw new Error("Pin.Porn: 缺少播放地址 @ " + id);

    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: "",
      type_name: info.author || undefined,
      playbacks: [
        {
          sourceId: sourceId || "pinporn",
          sourceName: "Pin.Porn",
          // playUrl 存 get_file link(302 跳 CDN 直链,dyproxy 跟随)。
          episodes: [{ playUrl: info.link, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const url = String(playUrl || "");
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Pin.Porn: 无效播放地址 @ " + playUrl);
    }
    // get_file 会 302 到 privatehost.com 的带签直链;交给 dyproxy 跟随重定向。
    return {
      url,
      type: /\.m3u8(\?|$)/i.test(url) ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },

  _decode(s) {
    if (!s || typeof s !== "string") return "";
    return s
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&hellip;/g, "…")
      .replace(/&nbsp;/g, " ")
      .trim();
  },
};
