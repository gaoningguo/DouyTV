/**
 * OGFAP 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 站点形态 (2026-07 实测,经 127.0.0.1:7897 代理匿名验证):
 *  - ogfap.com 是竖屏成人短视频站,前端 Astro v3 (SSR 首屏 + Svelte 岛屿组件),
 *    数据全走独立 API 子域 https://apin.ogfap.com(不挂 Cloudflare 托管质询,匿名 200)。
 *  - 视频/封面走无签名 CDN https://xcdn.tv/cdn/production/,路径只由 post.uid 决定,
 *    不校验 Referer / UA / token —— 直接拼 URL 即可播:
 *      封面   https://xcdn.tv/cdn/production/media/0312/<uid>/thumbnail.webp
 *      HLS    https://xcdn.tv/cdn/production/media/0312/<uid>/master.m3u8
 *      预览   https://xcdn.tv/cdn/production/media/0312/<uid>/preview.mp4
 *    (以上 media/0312 前缀源自站点 bundle isBrowser.js 的硬编码常量)
 *  - 部分 post 的 redgifs=true —— 这类不在 xcdn.tv,而在 thumbs*.redgifs.com,
 *    国内经代理拉流被 RST(TLS 000),无法匿名验证,故【直接过滤掉】,只发能播的 xcdn 项。
 *
 * API 形态 (逆向自 /_astro/api-const.js,base=https://apin.ogfap.com):
 *  - 推荐(Hot): GET /v2/post/feed-by-key?key=GA&limit=<n>&cursor=<lastId?>
 *      → { posts:[...], key:"GA" }。cursor 传上一页末条 id 翻页。
 *  - 最新:      GET /v2/post/new?limit=<n>&cursor=<lastId?>       → { posts:[...] }
 *  - 最热:      GET /v2/post/top?limit=<n>&cursor=<lastId?>       → { posts:[...] }
 *  - 按标签:    GET /v2/post/by-tag?tag=<name>&limit=<n>&cursor=<lastId?> → { posts:[...] }
 *                (by-tag 按 id 游标顺序翻页;另有 by-tag-random 每次随机、不接受游标,不用)
 *  - 按作者:    GET /v2/post/by-username?name=<name>&limit=<n>&cursor=<lastId?> → { posts:[...] }
 *  - 搜索建议:  GET /search?query=<kw> → [{ name, count, type:"tag"|"profile" }]
 *                (无「按关键词直出视频」的端点;搜索时取首个 type==="tag" 建议,再走 by-tag)
 *  - post 关键字段: { id, uid, description, format:"XV1"|"XV2", width, height,
 *                     redgifs, redGifsVideoUrl, author:{name}, tags:[{name}], likes, reactions }
 *
 * 实测证据 (curl -x http://127.0.0.1:7897):
 *  - LIST: GET /v2/post/feed-by-key?key=GA → 200 application/json, posts 非空;
 *          /v2/post/new → 200;/v2/post/by-tag?tag=asian → 200,cursor 翻页 id 递减不重复;
 *          /search?query=japanese → 200,返回 [{name:"japanese",count:932,type:"tag"},...]。
 *  - PLAY: GET .../media/0312/m_ayqx/master.m3u8 → 200,body 首行 #EXTM3U + 多档 STREAM-INF(1920x1080/1080x1920 竖屏);
 *          子清单 360-380K.m3u8 → 正常 #EXTINF + .ts;
 *          HEAD .../preview.mp4 → 200 video/mp4;thumbnail.webp → 200 image/webp。
 *          xcdn.tv 不带任何 header 亦 200(无防盗链)。
 *
 * 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 */
return {
  meta: {
    name: "OGFAP",
    author: "DouyTV",
    version: "0.1.0",
    description: "OGFAP 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /* ── 基址(可 config 覆盖,万一换域名)── */
  _apiBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("apiBase");
    return (typeof b === "string" && b) || "https://apin.ogfap.com";
  },
  _siteBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("siteBase");
    return (typeof b === "string" && b) || "https://ogfap.com";
  },
  _cdnBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("cdnBase");
    return (typeof b === "string" && b) || "https://xcdn.tv/cdn/production";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx, extra) {
    const h = {
      "User-Agent": this._ua(ctx),
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: this._siteBase(ctx),
      Referer: this._siteBase(ctx) + "/",
    };
    if (extra) for (const k in extra) h[k] = extra[k];
    return h;
  },

  async _getJson(ctx, base, path, query) {
    const url = ctx.utils.buildUrl((base || this._apiBase(ctx)) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 25000,
    });
    if (!res.ok) throw new Error("OGFAP HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /* ── CDN URL 拼装(路径由 uid 决定,无签名)── */
  _hls(ctx, uid) {
    return this._cdnBase(ctx) + "/media/0312/" + uid + "/master.m3u8";
  },
  _mp4(ctx, uid) {
    return this._cdnBase(ctx) + "/media/0312/" + uid + "/preview.mp4";
  },
  _thumb(ctx, uid) {
    return this._cdnBase(ctx) + "/media/0312/" + uid + "/thumbnail.webp";
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  /** 站点高频标签(亚洲相关排最前,照用户偏好)。可用 config.categories(逗号分隔)覆盖。 */
  _categories(ctx) {
    const custom = ctx.config && ctx.config.get && ctx.config.get("categories");
    if (typeof custom === "string" && custom.trim()) {
      return custom.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [
      // 亚洲区(靠前)
      "asian", "japanese", "korean", "chinese", "indian", "hijab", "desi",
      // 常见分类 / 动作
      "amateur", "teen", "milf", "pov", "blowjob", "deepthroat", "pussy",
      "tits", "big-tits", "ass", "anal", "creampie", "cumshot", "lesbian",
      "threesome", "missionary", "doggystyle", "blonde", "latina", "ebony",
      "cosplay", "onlyfans", "feet",
    ];
  },

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|china|taiwan|hong\s*kong/i.test(s)) return 0;
    if (/japan|japanese|jav|hijab/i.test(s)) return 1;
    if (/korean|korea/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|vietnam|indian/i.test(s)) return 3;
    return 99;
  },

  async getSources(ctx) {
    const sources = [
      { id: "feed", name: "推荐", group: "浏览" },
      { id: "new", name: "最新", group: "浏览" },
      { id: "top", name: "最热", group: "浏览" },
    ];
    const cats = this._categories(ctx).slice();
    const asian = [];
    const other = [];
    for (const c of cats) (this._asianRank(c) < 99 ? asian : other).push(c);
    for (const c of asian) sources.push({ id: "tag:" + c, name: c, group: "亚洲" });
    for (const c of other) sources.push({ id: "tag:" + c, name: c, group: "标签" });
    return sources;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "feed";
    // 分类源 id 形如 "tag:<name>"
    if (id.indexOf("tag:") === 0) {
      return this._byTag(ctx, id.slice(4), p, "tag:" + id);
    }
    if (id === "new") return this._list(ctx, "/v2/post/new", {}, p, "list:new");
    if (id === "top") return this._list(ctx, "/v2/post/top", {}, p, "list:top");
    // 默认推荐(Hot)
    return this._list(ctx, "/v2/post/feed-by-key", { key: "GA" }, p, "list:feed");
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    // 站点无「关键词直出视频」端点:先取搜索建议里首个 tag,再走 by-tag。
    const tag = await this._resolveTag(ctx, kw);
    if (!tag) return { list: [], page: p, pageCount: p, total: 0 };
    return this._byTag(ctx, tag, p, "search:" + kw);
  },

  /** /search?query=<kw> → [{name,count,type}];取首个 type==="tag",无则退化用原词。 */
  async _resolveTag(ctx, kw) {
    const CK = "tag:resolve:" + kw.toLowerCase();
    try {
      const c = await ctx.cache.get(CK);
      if (c) return c;
    } catch (e) {
      /* ignore */
    }
    let tag = kw.toLowerCase().replace(/\s+/g, "-");
    try {
      const data = await this._getJson(ctx, this._siteBase(ctx), "/search", {
        query: kw,
      });
      // 注意:搜索建议端点在站点主域(ogfap.com/search),非 api 子域。
      const arr = Array.isArray(data) ? data : [];
      const hit = arr.find((x) => x && x.type === "tag" && x.name);
      if (hit) tag = hit.name;
    } catch (e) {
      // 主域搜索失败就退化用规整后的关键词直接当 tag。
      try { ctx.log && ctx.log.warn && ctx.log.warn("OGFAP 搜索建议失败: " + (e && e.message)); } catch (_) {}
    }
    try { await ctx.cache.set(CK, tag, 3600); } catch (e) { /* ignore */ }
    return tag;
  },

  /**
   * 通用列表(feed/new/top):cursor = 上一页末条 id。为支持随页翻,缓存每页游标。
   * 首页(page<=1)清空游标从头开始。
   */
  async _list(ctx, path, baseQuery, page, sk) {
    const limit = 20;
    const cursor = await this._cursorFor(ctx, sk, page);
    const q = Object.assign({ limit }, baseQuery || {});
    if (cursor != null) q.cursor = cursor;
    const data = await this._getJson(ctx, this._apiBase(ctx), path, q);
    return this._finishPage(ctx, data, page, sk, limit);
  },

  /** by-tag:cursor 顺序翻页(id 递减)。 */
  async _byTag(ctx, tag, page, sk) {
    const limit = 20;
    const cursor = await this._cursorFor(ctx, sk, page);
    const q = { tag, limit };
    if (cursor != null) q.cursor = cursor;
    const data = await this._getJson(ctx, this._apiBase(ctx), "/v2/post/by-tag", q);
    return this._finishPage(ctx, data, page, sk, limit);
  },

  /**
   * 取指定页的起始 cursor。游标是「上一页最后一条 post id」。
   * 逐页缓存 cursor:page N 的 cursor = page N-1 末条 id。首页无 cursor。
   */
  async _cursorFor(ctx, sk, page) {
    if (page <= 1) return null;
    try {
      const c = await ctx.cache.get("cursor:" + sk + ":" + page);
      if (c != null) return c;
    } catch (e) {
      /* ignore */
    }
    return null; // 无缓存(用户跳页):退回首页数据,避免乱翻。
  },

  /** 归一化一页 posts,记录下一页 cursor,返回 {list,page,pageCount,total}。 */
  _finishPage(ctx, data, page, sk, limit) {
    const posts =
      (data && Array.isArray(data.posts) && data.posts) ||
      (Array.isArray(data) ? data : []);
    const list = [];
    let lastId = null;
    for (const post of posts) {
      lastId = post && post.id != null ? post.id : lastId;
      const vod = this._postToVod(ctx, post);
      if (vod) list.push(vod);
    }
    // 记录下一页游标(= 本页最后一条原始 id,含被过滤的 redgifs,保证翻页连续)。
    if (lastId != null) {
      try { ctx.cache.set("cursor:" + sk + ":" + (page + 1), lastId, 1800); } catch (e) {}
    }
    const hasMore = posts.length >= limit;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    // id 就是 uid。优先用列表缓存的元信息,miss 则用最小可播信息兜底。
    let info;
    try {
      info = await ctx.cache.get("item:" + id);
    } catch (e) {
      /* ignore */
    }
    if (!info && this._pendingCache && this._pendingCache[id]) {
      info = this._pendingCache[id];
    }
    if (!info) info = { title: "OGFAP " + id, poster: this._thumb(ctx, id), desc: "" };

    return {
      id: String(id),
      title: info.title,
      poster: info.poster,
      year: "",
      desc: info.desc || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "feed",
          sourceName: "OGFAP",
          // playUrl 直接放 uid;resolvePlayUrl 拼无签名 CDN URL。
          episodes: [{ playUrl: String(id), needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const uid = String(playUrl).trim();
    if (!uid) throw new Error("OGFAP: 空 playUrl");
    // xcdn.tv 无签名、无防盗链。优先 HLS(多档竖屏),兜底 preview.mp4。
    return {
      url: this._hls(ctx, uid),
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._siteBase(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 归一化 ───────────────────────── */

  /**
   * post → ScriptVodItem。
   * 只接受 xcdn.tv 可播项(有 uid 且非 redgifs);redgifs 项走别家 CDN 且代理拉不通,过滤掉。
   */
  _postToVod(ctx, post) {
    if (!post || !post.uid) return null;
    if (post.redgifs) return null; // redgifs.com CDN 经代理被 RST,无法匿名验证,丢弃。

    const uid = post.uid;
    const author = (post.author && post.author.name) || "";
    const desc = (post.description || "").toString().trim();
    const tags = Array.isArray(post.tags)
      ? post.tags.map((t) => t && t.name).filter(Boolean)
      : [];

    let title = desc || (author ? "@" + author : "") || ("OGFAP " + uid);
    if (title.length > 80) title = title.slice(0, 80).trim() + "…";

    const typeName = tags.length ? tags[0] : undefined;
    const poster = this._thumb(ctx, uid);
    const remarks = author ? "@" + author : undefined;

    const meta = { title, poster, desc: author ? "@" + author : "", typeName };
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[uid] = meta;
    try { ctx.cache.set("item:" + uid, meta, 7200); } catch (e) {}

    return {
      id: String(uid),
      title,
      poster,
      // 封面 xcdn.tv 无防盗链,但仍带 header 走代理更稳(封面 CDN 可能地域受限)。
      poster_headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._siteBase(ctx) + "/",
      },
      desc: author ? "@" + author : undefined,
      type_name: typeName,
      vod_remarks: remarks,
    };
  },
};
