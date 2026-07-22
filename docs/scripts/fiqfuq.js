/**
 * FiqFuq (fiqfuq.com) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - FiqFuq 是竖屏短视频聚合站(前端 jQuery SPA + 后端 PHP/MongoDB),内容主要
 *    来自 Reddit / redgifs 的搬运,每条记录已带【直链 video_url】(v.redd.it 的
 *    CMAF mp4 或 redgifs 直链),无需二次解析。
 *  - 单一 API 入口:POST /api,body 是 JSON:
 *      { a:<action>, skip:<n>, limit:<k>, id:0, sort:0, author:"",
 *        discover:"0", category:"<分类名或空>", filter:"videos" }
 *    返回一个数组,每项:
 *      { id, media_type:"video"|"image", description, category, thumbnail,
 *        author, video_url, video_width, video_height, image_url }
 *    (2026-07 实测,经 127.0.0.1:7897 代理匿名验证)
 *  - 【最新流】不带 category(或 category="")→ 全站按时间倒序;skip 顺序翻页,
 *    分页不重叠。
 *  - 【分类】category="<分类名>"(如 "Amateur")→ 该分类流,同样 skip 翻页。
 *    分类清单从 /c/ 页面抓 <a href="/c/<name>"> 链接(缓存一天)。
 *  - 【无自由文本搜索】后端 search/q action 会 fallthrough 到默认流,且 id 字段
 *    被当作 MongoDB ObjectId 解析(传非法值直接 500)。所以 search 走【分类名
 *    模糊匹配】—— 关键词命中分类清单则拉该分类,否则回退最新流并在描述里过滤。
 *  - filter:"videos" 只返回视频(跳过图片项);媒体直链:
 *      - v.redd.it/<id>/CMAF_1080.mp4 → GET 206 video/mp4(匿名可 Range seek)
 *      - redgifs / 其它 → 直接透传
 *    CDN 不校验 Referer/UA。国内直连被墙,请在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-20,全程匿名):
 *  - LIST: POST /api {a:"recent",skip:0,limit:20,filter:"videos"} → 200,20 条 video,
 *          带 video_url=v.redd.it/.../CMAF_1080.mp4。skip=0 vs skip=5 分页不重叠。
 *  - CAT:  POST /api {...,category:"Amateur"} → 全 category=Amateur;skip=0 vs 30 不重叠。
 *  - PLAY: GET Range v.redd.it/htjk6gsicp3g1/CMAF_1080.mp4 → 206 video/mp4。
 *  - CATS: GET /c/ → 581 个 <a href="/c/<name>"> 分类链接。
 */
return {
  meta: {
    name: "FiqFuq",
    author: "DouyTV",
    version: "0.1.0",
    description: "FiqFuq 竖屏短视频聚合(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://fiqfuq.com";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx, kind) {
    const h = {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      Referer: this._base(ctx) + "/",
    };
    if (kind === "api") {
      h.Accept = "application/json, text/javascript, */*; q=0.01";
      h["X-Requested-With"] = "XMLHttpRequest";
      h.Origin = this._base(ctx);
      h["Content-Type"] = "application/json; charset=UTF-8";
    } else {
      h.Accept =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    }
    return h;
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("FiqFuq 分类抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const c of cats) {
      (this._asianRank(c.name) < 99 ? asian : other).push(c);
    }
    const item = (c, group) => ({ id: "cat:" + c.name, name: c.name, group });
    for (const c of asian) sources.push(item(c, "亚洲"));
    for (const c of other) sources.push(item(c, "分类"));
    return sources;
  },

  /** 从 /c/ 页面抓分类名(<a href="/c/<name>">)。缓存一天。 */
  async _fetchCategories(ctx) {
    const CK = "fiqfuq:categories:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const res = await ctx.request.get(this._base(ctx) + "/c/", {
      headers: this._headers(ctx, "html"),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("FiqFuq /c/ HTTP " + res.status);
    const html = await res.text();
    const out = [];
    const seen = {};
    const re = /href=["']\/c\/([^"']+)["']/g;
    let m;
    while ((m = re.exec(html))) {
      let name = this._safeDecodeURI(m[1]).trim();
      name = this._decode(name);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ name });
    }
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
    const category = id.indexOf("cat:") === 0 ? id.slice("cat:".length) : "";
    return this._feed(ctx, p, category);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    // 无自由文本搜索 —— 关键词命中分类清单则拉该分类,否则回退最新流按描述过滤。
    let category = "";
    try {
      const cats = await this._fetchCategories(ctx);
      const low = kw.toLowerCase();
      let hit = cats.find((c) => c.name.toLowerCase() === low);
      if (!hit) hit = cats.find((c) => c.name.toLowerCase().indexOf(low) >= 0);
      if (hit) category = hit.name;
    } catch (e) {
      /* ignore */
    }
    if (category) return this._feed(ctx, p, category);
    // 兜底:拉最新流,按 description 关键词过滤(仅当页,粗筛)。
    const res = await this._feed(ctx, p, "");
    const low = kw.toLowerCase();
    const list = res.list.filter(
      (it) =>
        (it.title && it.title.toLowerCase().indexOf(low) >= 0) ||
        (it.desc && it.desc.toLowerCase().indexOf(low) >= 0)
    );
    return { list, page: p, pageCount: res.pageCount, total: list.length };
  },

  /**
   * 通用取流:POST /api。page 从 1 起,skip = (page-1)*limit。
   * category 为空 → 最新流;非空 → 该分类流。
   */
  async _feed(ctx, page, category) {
    const limit = 20;
    const skip = (Math.max(1, page) - 1) * limit;
    const body = JSON.stringify({
      a: "recent",
      skip,
      limit,
      id: 0,
      sort: 0,
      author: "",
      discover: "0",
      category: category || "",
      filter: "videos",
    });
    let arr;
    try {
      const res = await ctx.request.post(this._base(ctx) + "/api", {
        headers: this._headers(ctx, "api"),
        body,
        timeout: 25000,
      });
      if (!res.ok) throw new Error("FiqFuq /api HTTP " + res.status);
      arr = await res.json();
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    if (!Array.isArray(arr)) return { list: [], page, pageCount: page, total: 0 };
    const list = [];
    for (const item of arr) {
      const vod = this._toVod(item);
      if (vod) list.push(vod);
    }
    const hasMore = arr.length >= limit;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  _toVod(item) {
    if (!item || item.media_type !== "video") return null;
    const url = item.video_url || "";
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const id = String(item.id || "");
    if (!id) return null;
    const title =
      this._decode(this._stripHtml(item.description || "")) ||
      this._decode(item.category || "") ||
      id;
    const poster = item.thumbnail || item.image_url || "";

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      url,
      title,
      poster,
      author: item.author || "",
      desc: this._decode(this._stripHtml(item.description || "")),
    };

    return {
      id,
      title,
      poster: poster || undefined,
      type_name: item.author || undefined,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const info = (this._pendingCache && this._pendingCache[id]) || {
      title: String(id),
    };
    // 直链是搬运的 CDN 地址(无 token 过期问题),直接塞 playUrl。
    const playUrl = info.url || "";
    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.author || undefined,
      playbacks: [
        {
          sourceId: sourceId || "fiqfuq",
          sourceName: "FiqFuq",
          episodes: [{ playUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const url = String(playUrl || "");
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("FiqFuq: 无效播放地址 @ " + playUrl);
    }
    const isHls = /\.m3u8(\?|$)/i.test(url);
    return {
      url,
      type: isHls ? "hls" : "mp4",
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

  _safeDecodeURI(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s.replace(/%[0-9a-f]{2}/gi, (seq) => {
        try {
          return decodeURIComponent(seq);
        } catch (e2) {
          return seq;
        }
      });
    }
  },

  _stripHtml(s) {
    if (!s || typeof s !== "string") return "";
    return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
