/**
 * FikFap 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - FikFap (https://fikfap.com) 是 TikTok 式的竖屏成人短视频站,内容为用户/合作方
 *    上传的竖屏短片。前端是纯静态 SPA(index-*.js 打包在 fikfap.com 主站,受 Cloudflare
 *    托管但可直接取到);真正的数据全走独立 API 域名 api.fikfap.com。
 *  - 视频流走 bunny.net CDN 的 HLS master
 *    (vz-5d293dac-178.b-cdn.net/bcdn_token=.../<videoId>/playlist.m3u8),
 *    分辨率 359x640 ~ 1078x1920 竖屏多档,天生适合竖屏刷流。编码是 VP9+AAC。
 *  - 【匿名可用】api.fikfap.com 不要求登录,只要求两个请求头:
 *        Authorization-Anonymous: <随机 UUID>   (前端本地生成的匿名 id,非真凭证)
 *        IsLoggedIn: false
 *    Bundle 实测: 匿名 token 就是 crypto.randomUUID() 生成的一个 UUID,写进
 *    localStorage["UserAnonymousAuth"],随请求带上。无需 Cognito 登录。
 *  - CDN 链接带签名 token,含 token_countries=<出口国> 与 expires=<时间戳>:
 *        · token 与请求 API 时的出口 IP 所在国绑定(如 token_countries=JP),
 *          播放必须走同一出口国的代理,否则 CDN 403。
 *        · expires 约 24h;过期需重新拉 posts/<id> 换新链(detail 已做)。
 *    因此:务必在「设置 → 代理」配好代理,列表/详情/播放走同一代理,出口国才一致。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,均匿名可用):
 *  - 主 feed:  GET /posts?sort=new&amount=21&afterId=<lastPostId>
 *              &useDistinctUserIds=true&minimumScore=-20
 *              → 直接返回 [post, ...] 数组(顶层就是数组,无包裹)。
 *              sort ∈ new|top|trending|random。翻页: page1 不带 afterId;
 *              page>1 带上一页最后一条 postId(结果按 postId 递减)。
 *  - 标签 feed: GET /hashtags/label/<label>/posts?sort=trending&amount=21&afterId=<id>
 *              → 同样返回 [post, ...] 数组。
 *  - 标签清单: GET /discoveries/hashtags → [{ label, description, countPosts, thumbnailPost }]
 *  - 搜索:    GET /search?q=<kw>
 *              → { posts:[...], users, hashtags, livestreams, collections }
 *              posts 为一次性结果(约 10 条),无游标翻页。
 *  - 单帖:    GET /posts/<postId> → 单个 post 对象(detail 换新链用)。
 *  - post 关键字段:
 *        postId          数字主键
 *        label           标题文案
 *        videoStreamUrl  HLS master playlist.m3u8(带签名 token,直接可播)
 *        thumbnailStreamUrl 竖屏封面 jpg
 *        author.username / author.thumbnailUrl 作者
 *        likesCount / viewsCount / score 互动数
 */
return {
  meta: {
    name: "FikFap",
    author: "DouyTV",
    version: "0.1.0",
    description: "FikFap 竖屏短视频(成人内容,需代理 + 年龄确认;CDN token 绑出口国)",
  },

  /** API 基址,可用脚本 config.base 覆盖(万一换域名)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://api.fikfap.com";
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
   * 匿名 id:前端是每设备随机 UUID。这里生成一次并复用(整脚本生命周期稳定即可)。
   * 优先取 config.anonId,方便用户固定;否则本地拼一个 UUID。
   */
  _anonId(ctx) {
    const cfg = ctx.config && ctx.config.get && ctx.config.get("anonId");
    if (typeof cfg === "string" && cfg) return cfg;
    if (this._cachedAnonId) return this._cachedAnonId;
    // 简易 UUIDv4(不依赖 crypto,够用作匿名标识)。
    const hex = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
      else if (i === 14) s += "4";
      else if (i === 19) s += hex[(Math.floor(Math.random() * 4) + 8)];
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
      Origin: "https://fikfap.com",
      Referer: "https://fikfap.com/",
      "Authorization-Anonymous": this._anonId(ctx),
      IsLoggedIn: "false",
    };
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("FikFap HTTP " + res.status + " @ " + url);
    return res.json();
  },

  async getSources(ctx) {
    // 浏览入口 —— 三种排序 + 真实热门标签。
    const sources = [
      { id: "new", name: "最新", group: "浏览" },
      { id: "top", name: "热门", group: "浏览" },
      { id: "trending", name: "趋势", group: "浏览" },
      { id: "random", name: "随机", group: "浏览" },
    ];
    let tags = [];
    try {
      tags = await this._fetchHashtags(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("FikFap 标签抓取失败:", String(e));
    }
    // 亚洲相关标签排前,其余按热度(countPosts)原序在后。
    const asian = [];
    const other = [];
    for (const t of tags) {
      (this._asianRank(t.label + " " + (t.description || "")) < 99 ? asian : other).push(t);
    }
    const item = (t, group) => ({
      id: "hashtag:" + t.label,
      name: "#" + t.label,
      group,
    });
    for (const t of asian) sources.push(item(t, "亚洲"));
    for (const t of other) sources.push(item(t, "标签"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "new";
    if (id.indexOf("hashtag:") === 0) {
      const label = id.slice("hashtag:".length);
      return this._feed(
        ctx,
        p,
        "tag:" + label,
        "/hashtags/label/" + encodeURIComponent(label) + "/posts",
        { sort: "trending" }
      );
    }
    // 排序 feed。最新沿用站点默认参数(去重作者 + 过滤低分)。
    const query = { sort: id };
    if (id === "new") {
      query.useDistinctUserIds = "true";
      query.minimumScore = "-20";
    }
    return this._feed(ctx, p, "sort:" + id, "/posts", query);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    // /search 无游标翻页,只有一批结果 —— 只在第 1 页返回,其余页为空。
    if (p > 1) return { list: [], page: p, pageCount: p, total: 0 };
    let data;
    try {
      data = await this._getJson(ctx, "/search", { q: keyword });
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("FikFap 搜索失败:", String(e));
      return { list: [], page: p, pageCount: p, total: 0 };
    }
    const posts = (data && Array.isArray(data.posts) && data.posts) || [];
    const list = [];
    for (const post of posts) {
      const vod = this._toVod(post);
      if (vod) list.push(vod);
    }
    return { list, page: p, pageCount: p, total: list.length };
  },

  /**
   * 通用列表拉取 —— afterId 游标翻页。
   * 结果按 postId 递减;page1 不带 afterId,page>1 带上一页最后一条 postId。
   * 拿到本页后把「最后一条 postId」缓存成下一页的 afterId(TTL 30 分钟)。
   * sk 为缓存分区键(区分不同排序 / 标签)。
   */
  async _feed(ctx, page, sk, path, extraQuery) {
    const query = { amount: 21 };
    for (const key in extraQuery) {
      if (extraQuery[key] != null && extraQuery[key] !== "") {
        query[key] = extraQuery[key];
      }
    }

    if (page > 1) {
      let afterId;
      try {
        afterId = await ctx.cache.get("after:" + sk + ":" + page);
      } catch (e) {
        /* ignore */
      }
      // 缺游标(缓存过期 / 非顺序翻页)—— 无法定位该页,返回空且不再加载。
      if (!afterId) {
        return { list: [], page, pageCount: page, total: 0 };
      }
      query.afterId = afterId;
    }

    const data = await this._getJson(ctx, path, query);
    // 主 feed / 标签 feed 顶层直接是数组。
    const posts = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.posts) && data.posts) || [];
    const list = [];
    let lastId;
    for (const post of posts) {
      const vod = this._toVod(post);
      if (vod) {
        list.push(vod);
        lastId = post.postId;
      }
    }

    // 缓存下一页游标(顺序翻页依赖它)。
    if (lastId != null) {
      try {
        await ctx.cache.set("after:" + sk + ":" + (page + 1), String(lastId), 1800);
      } catch (e) {
        /* ignore */
      }
    }

    // 满页(拿到 amount 条)才认为还有更多。
    const hasMore = posts.length >= (query.amount || 21) && list.length > 0;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * post → ScriptVodItem。只接受已就绪且有流地址的视频。
   * 同时把解析结果缓存到 post:<postId>,供 detail 命中(免二次请求)。
   */
  _toVod(post) {
    if (!post || post.postId == null) return null;
    const url = post.videoStreamUrl;
    if (!url) return null;

    const author = post.author || {};
    const title = this._cleanTitle(post.label) || author.username || String(post.postId);
    const poster = post.thumbnailStreamUrl || (author && author.thumbnailUrl) || undefined;
    const remarks = this._remarks(post);

    // 缓存 postId → { url, title, poster, ... } 给 detail 用(TTL 2h)。
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[post.postId] = {
      url,
      title,
      poster,
      author: author.username || "",
      desc: (author.description || "").trim(),
    };

    return {
      id: String(post.postId),
      title,
      poster,
      poster_headers: this._posterHeaders(),
      desc: author.username ? "@" + author.username : undefined,
      type_name: undefined,
      vod_remarks: remarks,
    };
  },

  /**
   * 封面请求头:thumbnailStreamUrl 是签名的 BunnyCDN 链,不带 Referer 会 403
   * (和 videoStreamUrl 同款防盗链),且 token 还带 token_countries 地域锁 ——
   * 必须走 dyproxy 代理透传出口。脚本把这组 header 交给 App,PosterImage 会用
   * wrapWithProxy 带上它们 + 激活代理,封面才出得来。
   */
  _posterHeaders() {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Referer: "https://fikfap.com/",
    };
  },

  async detail(ctx, { id, sourceId }) {
    // 先查内存/持久缓存(recommend / search 已解析过),尽量免二次请求。
    let info;
    if (this._pendingCache && this._pendingCache[id]) {
      info = this._pendingCache[id];
    }
    if (!info) {
      try {
        info = await ctx.cache.get("post:" + id);
      } catch (e) {
        /* ignore */
      }
    }

    // 缓存的链接可能已过期(expires ~24h)—— detail 总是重新拉一次拿 fresh token,
    // 保证进播放页时链接可用。
    let fresh;
    try {
      const data = await this._getJson(ctx, "/posts/" + encodeURIComponent(id));
      const post = Array.isArray(data) ? data[0] : data;
      if (post && post.videoStreamUrl) {
        const author = post.author || {};
        fresh = {
          url: post.videoStreamUrl,
          title: this._cleanTitle(post.label) || author.username || String(id),
          poster: post.thumbnailStreamUrl || (author && author.thumbnailUrl) || undefined,
          author: author.username || "",
          desc: (author.description || "").trim(),
        };
      }
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("FikFap 详情刷新失败,回落缓存:", String(e));
    }

    if (fresh) info = fresh;
    if (!info) throw new Error("FikFap: 未找到该视频(可能已删除)@ " + id);

    try {
      await ctx.cache.set("post:" + id, info, 7200);
    } catch (e) {
      /* ignore */
    }

    return {
      id: String(id),
      title: info.title,
      poster: info.poster,
      poster_headers: this._posterHeaders(),
      year: "",
      desc: info.desc || (info.author ? "@" + info.author : ""),
      type_name: undefined,
      playbacks: [
        {
          sourceId: sourceId || "fikfap",
          sourceName: "FikFap",
          // playUrl 直接放 m3u8;resolvePlayUrl 只补 type/headers,不再发请求。
          episodes: [{ playUrl: info.url, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 bunny CDN 的 HLS master(带签名 token)。
    // token 绑出口国 + 有效期;播放走用户全局代理(需与拉取时同一出口国)。
    return {
      url: playUrl,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Origin: "https://fikfap.com",
        Referer: "https://fikfap.com/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /**
   * 抓 /discoveries/hashtags 热门标签清单。
   * 归一为 [{ label, description, countPosts }],按 countPosts 降序,缓存一天。
   */
  async _fetchHashtags(ctx) {
    const CK = "hashtags:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }

    const data = await this._getJson(ctx, "/discoveries/hashtags");
    let raw = [];
    if (Array.isArray(data)) {
      raw = data;
    } else if (data && typeof data === "object") {
      for (const key in data) {
        if (Array.isArray(data[key])) {
          raw = data[key];
          break;
        }
      }
    }

    const out = [];
    const seen = {};
    for (const h of raw) {
      if (!h || !h.label) continue;
      const label = String(h.label);
      if (seen[label]) continue;
      seen[label] = true;
      out.push({
        label,
        description: (h.description || "").toString().trim(),
        countPosts: h.countPosts || 0,
      });
    }
    out.sort((a, b) => (b.countPosts || 0) - (a.countPosts || 0));

    if (out.length) {
      try {
        await ctx.cache.set(CK, out, 86400);
      } catch (e) {
        /* ignore */
      }
    }
    return out;
  },

  /** 拼互动数备注(点赞 / 播放),给列表卡片右下角。 */
  _remarks(post) {
    const parts = [];
    const fmt = (n) => {
      if (n == null || isNaN(n)) return null;
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
      return String(n);
    };
    const likes = fmt(post.likesCount);
    const views = fmt(post.viewsCount);
    if (likes) parts.push("♥ " + likes);
    if (views) parts.push("▶ " + views);
    return parts.length ? parts.join("  ") : undefined;
  },

  /**
   * 亚洲优先级: 中文/台/港 → 日 → 韩 → 其它亚洲 → 非亚洲(99)。数字越小越靠前。
   * 用于 getSources 分区排序。
   */
  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },

  /**
   * 清洗帖子标题文案:去掉多余空白与首尾符号,截断到 80 字符。
   * 空则返回空,交上层回落到作者名 / postId。
   */
  _cleanTitle(text) {
    if (!text || typeof text !== "string") return "";
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    return cleaned.length > 80 ? cleaned.slice(0, 80).trim() + "…" : cleaned;
  },
};
