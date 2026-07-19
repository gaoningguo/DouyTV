/**
 * Slushy 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Slushy (https://www.slushy.com) 是订阅制粉丝站(类 OnlyFans),但【探索流匿名可看】——
 *    首页竖屏推荐流不登录即可拉,免费(access/type == "free")帖子直接可播。
 *  - 数据走独立 API 域名 api.slushy.com(NestJS 后端)。推荐流是
 *      POST /feed?anonymousId=<uuid>
 *        Header: x-anonymous-id: <同一个 uuid>        ← 必须与 query 里的 anonymousId 一致
 *        Body:   { recommendationVersion: "V2", recipe: "trendingNow" | "userPersonalization" }
 *      → { body:[ { creator, post } ], metadata?, recommendationId }
 *    【关键】anonymousId 必须【同时】出现在 query 与 x-anonymous-id 头里,缺一个 → 400
 *    "user id is required"。UA 也必须是真实浏览器 UA(缺 UA → 403 html)。
 *  - 视频直链在 post.media[i].mediaUrls.{movie,lowMovie}(HLS m3u8,CloudFront 签名),
 *    poster 在 mediaUrls.poster。实测匿名 200 application/vnd.apple.mpegurl,CORS 全开。
 *    签名 URL 带 Expires(约几小时),故 needResolve:true —— detail 重新拉一批换新链。
 *  - 推荐流是【会话内轮换的池】(两次调用约 2/3 重叠),【无可靠游标翻页】,故翻页用
 *    会话级 seen-set 累积去重(与 fap.bar / pornhub-shorties 同款)。
 *  - 国内直连被墙,请在「设置 → 代理」配代理;scriptFetch 与 dyproxy 拉流都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 列表: POST /feed?anonymousId=<uuid>  Header x-anonymous-id + Body {recommendationVersion:"V2",recipe}
 *          recipe ∈ trendingNow | userPersonalization。→ { body:[ {creator,post} ] }。
 *  - post: { id, type:"free", caption, media:[{ type:"video", mediaUrls:{movie,poster,...} }],
 *            hashtags:[...], price, postContentType, spicy }
 *  - 播放实测: HEAD/GET mediaUrls.movie → 200 application/vnd.apple.mpegurl(CloudFront 签名 HLS)。
 *  - 站内无匿名搜索端点 —— 搜索回落为在已拉的推荐池里按 caption / hashtag / 作者本地过滤。
 */
return {
  meta: {
    name: "Slushy",
    author: "DouyTV",
    version: "0.1.0",
    description: "Slushy 探索流竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** API 基址,可用脚本 config.api 覆盖(万一换域名)。 */
  _api(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("api");
    return (typeof b === "string" && b) || "https://api.slushy.com";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  /**
   * 每设备一个稳定的匿名 uuid。优先取 config.anonId 固定;否则本地拼一个 UUIDv4 复用。
   * 必须【同时】用在 ?anonymousId= 与 x-anonymous-id 头里(缺一 → 400)。
   */
  _anonId(ctx) {
    const cfg = ctx.config && ctx.config.get && ctx.config.get("anonId");
    if (typeof cfg === "string" && cfg) return cfg;
    if (this._cachedAnonId) return this._cachedAnonId;
    const hex = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
      else if (i === 14) s += "4";
      else if (i === 19) s += hex[Math.floor(Math.random() * 4) + 8];
      else s += hex[Math.floor(Math.random() * 16)];
    }
    this._cachedAnonId = s;
    return s;
  },

  _headers(ctx) {
    return {
      "User-Agent": this._ua(ctx),
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/json",
      Origin: "https://www.slushy.com",
      Referer: "https://www.slushy.com/",
      "x-anonymous-id": this._anonId(ctx),
    };
  },

  /** POST /feed 拉一批 —— recipe ∈ trendingNow | userPersonalization。返回 body 数组。 */
  async _fetchFeed(ctx, recipe) {
    const anon = this._anonId(ctx);
    const url = ctx.utils.buildUrl(this._api(ctx) + "/feed", { anonymousId: anon });
    const res = await ctx.request.post(url, {
      headers: this._headers(ctx),
      json: { recommendationVersion: "V2", recipe },
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Slushy HTTP " + res.status + " @ " + url);
    const data = await res.json();
    return (data && Array.isArray(data.body) && data.body) || [];
  },

  async getSources() {
    return [
      { id: "trendingNow", name: "热门", group: "浏览" },
      { id: "userPersonalization", name: "推荐", group: "浏览" },
    ];
  },

  /**
   * 推荐流:无游标,池会话内轮换。用 seen-set 累积去重推进翻页。
   * page===1 视为新会话清空 seen(缓存 30 分钟)。
   */
  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const recipe = sourceId === "userPersonalization" ? "userPersonalization" : "trendingNow";

    const SEEN = "slushy:seen:" + recipe;
    let seen = {};
    try {
      const s = await ctx.cache.get(SEEN);
      if (s && typeof s === "object") seen = s;
    } catch (e) {
      /* ignore */
    }
    if (p <= 1) seen = {};

    let body;
    try {
      body = await this._fetchFeed(ctx, recipe);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Slushy 列表失败:", String(e));
      return { list: [], page: p, pageCount: p, total: 0 };
    }

    const list = [];
    for (const entry of body) {
      const vod = this._toVod(entry);
      if (!vod) continue;
      if (seen[vod.id]) continue; // 池轮换,跨页去重
      seen[vod.id] = 1;
      list.push(vod);
    }

    try {
      await ctx.cache.set(SEEN, seen, 1800);
    } catch (e) {
      /* ignore */
    }

    // 池仍在返新内容就继续翻(拿到去重后条目即认为还有更多)。
    const hasMore = list.length > 0;
    return { list, page: p, pageCount: hasMore ? p + 1 : p, total: list.length };
  },

  /**
   * 无匿名搜索端点。拉 trendingNow 若干批,在池里按 caption / hashtag / 作者本地过滤。
   */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    if (p > 1) return { list: [], page: p, pageCount: p, total: 0 };

    const list = [];
    const seen = {};
    // 池轮换,多拉几批提高命中率。
    for (let i = 0; i < 4; i++) {
      let body;
      try {
        body = await this._fetchFeed(ctx, "trendingNow");
      } catch (e) {
        break;
      }
      for (const entry of body) {
        const vod = this._toVod(entry);
        if (!vod || seen[vod.id]) continue;
        seen[vod.id] = 1;
        if (vod._hay.indexOf(kw) >= 0) {
          delete vod._hay;
          list.push(vod);
        }
      }
    }
    return { list, page: p, pageCount: p, total: list.length };
  },

  /**
   * feed entry → ScriptVodItem。只收 free 视频帖。id = post.id。
   * 把播放/封面缓存进 _pendingCache 供 detail 命中(链会过期,detail 仍会重拉)。
   */
  _toVod(entry) {
    const post = entry && entry.post;
    if (!post || !post.id) return null;
    // 只收免费帖(付费帖 mediaUrls.movie 会给 teaser / 403)。
    if (post.type && String(post.type).toLowerCase() !== "free") return null;

    const media = Array.isArray(post.media) ? post.media : [];
    const vid = media.find((m) => m && m.type === "video" && m.mediaUrls);
    if (!vid) return null;
    const urls = vid.mediaUrls || {};
    const movie = urls.movie || urls.lowMovie;
    if (!movie) return null;

    const creator = entry.creator || {};
    const author = (creator.displayName || creator.handle || "").trim();
    const title = this._cleanTitle(post.caption) || author || String(post.id);
    const poster = urls.poster || urls.thumb || undefined;
    const tags = Array.isArray(post.hashtags) ? post.hashtags : [];

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[String(post.id)] = {
      movie,
      poster,
      title,
      author,
      desc: (post.caption || "").trim(),
    };

    const vod = {
      id: String(post.id),
      title,
      poster,
      // CloudFront 签名 HLS 封面,走 dyproxy 代理带 Referer 更稳。
      poster_headers: poster
        ? { "User-Agent": "Mozilla/5.0", Referer: "https://www.slushy.com/" }
        : undefined,
      desc: author ? "@" + author : undefined,
      type_name: tags.length ? tags[0] : undefined,
      vod_remarks: this._fmtViews(post),
    };
    vod._hay = (
      (post.caption || "") + " " + tags.join(" ") + " " + author
    ).toLowerCase();
    return vod;
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    // 缓存的签名链可能过期 —— 重新拉一批推荐流找同一 post,拿 fresh 链。
    if (!info || !info.movie) {
      try {
        const body = await this._fetchFeed(ctx, "trendingNow");
        for (const entry of body) {
          const post = entry && entry.post;
          if (post && String(post.id) === String(id)) {
            this._toVod(entry); // 顺带刷新 _pendingCache
            info = this._pendingCache[id];
            break;
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
    if (!info) throw new Error("Slushy: 未找到该视频(可能已下架 / 链过期,请回列表重进)@ " + id);

    return {
      id: String(id),
      title: info.title,
      poster: info.poster,
      poster_headers: info.poster
        ? { "User-Agent": this._ua(ctx), Referer: "https://www.slushy.com/" }
        : undefined,
      year: "",
      desc: info.desc || (info.author ? "@" + info.author : ""),
      playbacks: [
        {
          sourceId: sourceId || "slushy",
          sourceName: "Slushy",
          episodes: [{ playUrl: info.movie, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 CloudFront 签名 HLS master(mediaUrls.movie)。
    return {
      url: playUrl,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: "https://www.slushy.com/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _fmtViews(post) {
    const c = post && post.counts;
    const v = c && (c.views || c.likes);
    if (!v) return undefined;
    const n = Number(v) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  },

  /** 清洗 caption 作标题:去 hashtag / URL,截断 80 字符;全是标签则返空。 */
  _cleanTitle(text) {
    if (!text || typeof text !== "string") return "";
    const cleaned = text
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/#[^\s#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 2) {
      return cleaned.length > 80 ? cleaned.slice(0, 80).trim() + "…" : cleaned;
    }
    return "";
  },
};
