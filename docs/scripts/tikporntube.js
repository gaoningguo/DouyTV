/**
 * TikPorn.tube 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - TikPorn.tube 是 KVS(Kernel Video Sharing)引擎驱动的竖屏成人短视频站,
 *    前端 Vue SPA,API 干净返回 JSON(无 Cloudflare 托管质询)。
 *  - 【列表 / 分类 / 排序】统一走 KVS videos2 接口(URL 各字段用 / 和 . 分隔):
 *      GET /api/json/videos2/{lifetime}/{gender}/{sort}/{count}/{section}.{object}.{page}.{type}.{duration}.{date}.json
 *    实测(2026-07,经 127.0.0.1:7897 代理匿名):
 *      · 全站最新:section/object 留空 →
 *        /api/json/videos2/3600/str/latest-updates/60/..1.all...json  (total 151223)
 *      · 分类:section=categories, object=<dir> →
 *        /api/json/videos2/3600/str/latest-updates/60/categories.asian.2.all...json  (只出该分类)
 *      · sort 可取 latest-updates / most-popular / most-viewed / top-rated / longest / most-commented。
 *      gender 固定 "str",count=60,type 恒 "all",duration/date 留空(尾部三点)。
 *  - 【搜索】走 videos2.php(不同端点,relevance 排序):
 *      GET /api/videos2.php?params={lifetime}/str/relevance/{count}/search.json.{page}.all..&s=<kw>
 *  - 【分类清单】GET /api/json/categories/{lifetime}/str.all.en.json
 *      → { categories:[{ dir, title, total_videos }] },按 total_videos 降序。
 *  - 【详情】KVS 把 video_id 分片成路径:
 *      GET /api/json/video/{lifetime}/{floor(id/1e6)*1e6}/{floor(id/1e3)*1e3}/{id}.json
 *    (返回标题/封面/分类,但【不含直链】)。
 *  - 【播放】实测直链就是 https://v.tikporn.tube/videos/{video_id}.mp4(前端源码里
 *    的固定前缀 https://v.tikporn.tube/videos/ + video_id + ".mp4";CDN 302 到自身
 *    带签名的 mp4,匿名 Range 206 video/mp4,不校验 Referer/UA)。
 *    故【不必解 videofile.php 的 KVS 混淆直链】,直接拼即可 —— 更稳、少一次请求。
 *  - 封面 https://tn.tikporn.tube/contents/videos_screenshots/<shard>/<id>/270x480/1.jpg,
 *    列表 JSON 的 video_id 就能拼出;实测匿名 200 image/jpeg。
 *  - 国内直连被墙 → 在「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 */
return {
  meta: {
    name: "TikPorn.tube",
    author: "DouyTV",
    version: "0.1.0",
    description: "TikPorn.tube 竖屏短视频(KVS 引擎,成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://tikporn.tube";
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
      timeout: 20000,
    });
    if (!res.ok) throw new Error("TikPorn.tube HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [
      { id: "latest-updates", name: "最新", group: "浏览" },
      { id: "most-popular", name: "热门", group: "浏览" },
      { id: "most-viewed", name: "最多播放", group: "浏览" },
      { id: "top-rated", name: "高评分", group: "浏览" },
    ];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("TikPorn.tube 分类抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const c of cats) {
      if (!c.total) continue;
      (this._asianRank(c.dir + " " + c.name) < 99 ? asian : other).push(c);
    }
    const item = (c, group) => ({ id: "cat:" + c.dir, name: c.name, group });
    for (const c of asian) sources.push(item(c, "亚洲"));
    for (const c of other) sources.push(item(c, "分类"));
    return sources;
  },

  /** 抓 KVS 分类清单,按内容量降序。缓存一天。 */
  async _fetchCategories(ctx) {
    const CK = "tikporntube:categories:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const data = await this._getJson(
      ctx,
      "/api/json/categories/14400/str.all.en.json",
      {}
    );
    const arr = (data && data.categories) || [];
    const out = [];
    for (const c of Array.isArray(arr) ? arr : []) {
      if (!c || !c.dir) continue;
      out.push({
        dir: String(c.dir),
        name: this._decode(c.title || c.dir),
        total: parseInt(c.total_videos || "0", 10) || 0,
      });
    }
    out.sort((a, b) => b.total - a.total);
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
    const id = sourceId || "latest-updates";
    if (id.indexOf("cat:") === 0) {
      return this._feedVideos2(ctx, p, {
        sort: "latest-updates",
        cat: id.slice("cat:".length),
      });
    }
    // sourceId 直接就是 sort
    return this._feedVideos2(ctx, p, { sort: id });
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feedSearch(ctx, p, kw);
  },

  /**
   * KVS videos2 列表接口。字段顺序(前端源码逐字对照):
   *   /api/json/videos2/{lifetime}/{gender}/{sort}/{count}/{section}.{object}.{page}.{type}.{duration}.{date}.json
   * 全站流:section/object 留空;分类:section=categories, object=<dir>。
   */
  async _feedVideos2(ctx, page, opts) {
    const lifetime = 3600;
    const gender = "str";
    const count = 60;
    const sort = (opts && opts.sort) || "latest-updates";
    const section = opts && opts.cat ? "categories" : "";
    const object = (opts && opts.cat) || "";
    // 尾段: {section}.{object}.{page}.{type}.{duration}.{date}.json
    const tail =
      section + "." + object + "." + page + ".all..." + "json";
    const path =
      "/api/json/videos2/" +
      lifetime +
      "/" +
      gender +
      "/" +
      encodeURIComponent(sort) +
      "/" +
      count +
      "/" +
      tail;
    let data;
    try {
      data = await this._getJson(ctx, path, {});
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    return this._packVideos(data, page);
  },

  /**
   * 搜索走 videos2.php(relevance),尾段与 videos2 略不同(search 段 + &s=)。
   *   /api/videos2.php?params={lifetime}/str/relevance/{count}/search.json.{page}.all..&s=<kw>
   */
  async _feedSearch(ctx, page, keyword) {
    const lifetime = 259200;
    const count = 60;
    const params =
      lifetime + "/str/relevance/" + count + "/search.json." + page + ".all..";
    const url =
      this._base(ctx) +
      "/api/videos2.php?params=" +
      params +
      "&s=" +
      encodeURIComponent(keyword);
    let data;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, true),
        timeout: 20000,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    return this._packVideos(data, page);
  },

  /** KVS videos2 响应 → { list, page, pageCount, total }。 */
  _packVideos(data, page) {
    const videos = (data && data.videos) || [];
    const arr = Array.isArray(videos) ? videos : [];
    const list = [];
    for (const v of arr) {
      const vod = this._toVod(v);
      if (vod) list.push(vod);
    }
    const totalPages = parseInt((data && data.pages) || "0", 10) || 0;
    const hasMore = totalPages ? page < totalPages : list.length >= 60;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: parseInt((data && data.total_count) || "0", 10) || list.length,
    };
  },

  /** KVS video item → ScriptVodItem。封面用 video_id 拼分片路径。 */
  _toVod(v) {
    if (!v || v.video_id == null) return null;
    const id = String(v.video_id);
    const title = this._decode(v.title || "") || id;
    // 封面: 优先 item 自带 thumb,否则用 video_id 拼分片路径。
    const poster = v.thumb || this._thumbUrl(id);
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = { title, poster };
    return { id, title, poster: poster || undefined };
  },

  /** tn.tikporn.tube 封面路径:分片 = floor(id/1000)*1000。 */
  _thumbUrl(id) {
    const n = parseInt(id, 10);
    if (!isFinite(n)) return "";
    const shard = Math.floor(n / 1000) * 1000;
    return (
      "https://tn.tikporn.tube/contents/videos_screenshots/" +
      shard +
      "/" +
      id +
      "/270x480/1.jpg"
    );
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      // KVS 详情:分片路径 {floor(id/1e6)*1e6}/{floor(id/1e3)*1e3}/{id}.json
      try {
        const n = parseInt(id, 10);
        const shardM = Math.floor(n / 1e6) * 1e6;
        const shardK = Math.floor(n / 1e3) * 1e3;
        const data = await this._getJson(
          ctx,
          "/api/json/video/86400/" + shardM + "/" + shardK + "/" + id + ".json",
          {}
        );
        const v = data && data.video;
        if (v) {
          info = {
            title: this._decode(v.title || "") || id,
            poster: v.thumb || this._thumbUrl(id),
            desc: this._decode(v.description || ""),
          };
        }
      } catch (e) {
        /* ignore, 下面兜底 */
      }
    }
    if (!info) info = { title: String(id), poster: this._thumbUrl(id) };

    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      playbacks: [
        {
          sourceId: sourceId || "tikporntube",
          sourceName: "TikPorn.tube",
          // playUrl 直接拼固定前缀,resolvePlayUrl 里补 headers 即可。
          episodes: [{ playUrl: "id:" + id, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    if (url.indexOf("id:") === 0) {
      const id = url.slice(3);
      url = "https://v.tikporn.tube/videos/" + encodeURIComponent(id) + ".mp4";
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("TikPorn.tube: 无效播放地址 @ " + playUrl);
    }
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
