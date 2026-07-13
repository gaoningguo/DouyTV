/**
 * XXXTik 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 站点形态 (2026-07 实测,经 127.0.0.1:7897 代理匿名验证):
 *  - xxxtik.com 是 Angular SPA(前端 static bundle 逆向出真实 API)。
 *  - API host: https://xxxtik-api-iw98m.ondigitalocean.app (DigitalOcean App,匿名开放)
 *  - 媒体 CDN base: https://p5rn.com/cdn/production/media/0312/
 *      * 视频(HLS): {CDN}{uid}/master.m3u8   —— 每条 post 有 uid,含 redgifs 转存的也走这里
 *      * 缩略图:    {CDN}{uid}/thumbnail.webp  —— 匿名 200,不需要 Referer
 *
 * 已验证端点 (均 HTTP 200,匿名):
 *  - 推荐流: GET /post/feed/by-key?key=241d2f51-693a-486b-8f1e-185bb719b175&cursor=<offset>
 *            → { data:{ posts:[...] }, meta:{ key } }  (每页 50,cursor 为行偏移)
 *  - 最新:   GET /post/new?limit=20&cursor=<lastId>       → [post,...]  (cursor=上页末条 id)
 *  - 最热:   GET /post/top/<period>?limit=20&cursor=<lastId>  period ∈ {all,week,month}
 *  - 标签:   GET /post/tag/<name>?cursor=<lastId>        → [post,...]  (cursor=上页末条 id)
 *  - 标签表: GET /tag/options                            → [{uuid,name},...]
 *  - 搜索:   GET /search?query=<kw>                      → [{name,count,type:'tag'|'profile'}]
 *            (返回联想词,不是视频;取最匹配的 tag 再走 /post/tag/<name>)
 *
 * 播放链实测 (匿名,经代理):
 *  - master.m3u8            → 200  #EXTM3U  (Content-Type application/octet-stream,body 以 #EXTM3U 起)
 *  - 子清单 1080-2M.m3u8    → 200  #EXTM3U
 *  - 分片 *.ts              → 200  video/mp2t (~1.8MB)
 *  - thumbnail.webp         → 200  image/webp (无 Referer 亦可)
 *
 * 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 * 国内直连被墙,请在「设置 → 代理」配代理。
 */
return {
  meta: {
    name: "XXXTik",
    author: "DouyTV",
    version: "0.1.0",
    description: "XXXTik 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  // 前端 bundle 内固定的 feed key
  _FEED_KEY: "241d2f51-693a-486b-8f1e-185bb719b175",

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("api");
    return (typeof b === "string" && b) || "https://xxxtik-api-iw98m.ondigitalocean.app";
  },

  _media(ctx) {
    const m = ctx.config && ctx.config.get && ctx.config.get("media");
    return (typeof m === "string" && m) || "https://p5rn.com/cdn/production/media/0312/";
  },

  _site(ctx) {
    const s = ctx.config && ctx.config.get && ctx.config.get("site");
    return (typeof s === "string" && s) || "https://xxxtik.com";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx) {
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "application/json, text/plain, */*",
      Origin: this._site(ctx),
      Referer: this._site(ctx) + "/",
    };
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("XXXTik HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /* ───────────────────────── getSources ───────────────────────── */

  async getSources(ctx) {
    const sources = [
      { id: "feed", name: "推荐", group: "浏览" },
      { id: "new", name: "最新", group: "浏览" },
      { id: "top:week", name: "本周最热", group: "浏览" },
      { id: "top:month", name: "本月最热", group: "浏览" },
      { id: "top:all", name: "全部最热", group: "浏览" },
    ];
    let tags = [];
    try {
      tags = await this._fetchTags(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("XXXTik 标签抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const t of tags) {
      (this._asianRank(t.name) < 99 ? asian : other).push(t);
    }
    const item = (t, group) => ({ id: "tag:" + t.name, name: t.name, group });
    for (const t of asian) sources.push(item(t, "亚洲"));
    for (const t of other) sources.push(item(t, "标签"));
    return sources;
  },

  async _fetchTags(ctx) {
    const CK = "xxxtik:tags:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const data = await this._getJson(ctx, "/tag/options", {});
    const out = [];
    const seen = {};
    for (const t of Array.isArray(data) ? data : []) {
      const name = t && String(t.name || "").trim();
      if (!name || seen[name]) continue;
      seen[name] = true;
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

  /* ───────────────────────── recommend ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "feed";

    if (id === "feed") return this._feedByKey(ctx, p);
    if (id === "new") return this._idCursorFeed(ctx, p, "new", "/post/new", {});
    if (id.indexOf("top:") === 0) {
      const period = id.slice("top:".length) || "week";
      return this._idCursorFeed(ctx, p, "top:" + period, "/post/top/" + period, {});
    }
    if (id.indexOf("tag:") === 0) {
      const name = id.slice("tag:".length);
      return this._idCursorFeed(
        ctx,
        p,
        "tag:" + name,
        "/post/tag/" + encodeURIComponent(name),
        {}
      );
    }
    // 默认回退到推荐流
    return this._feedByKey(ctx, p);
  },

  /**
   * 推荐流 /post/feed/by-key —— cursor 为行偏移,每页 50。
   */
  async _feedByKey(ctx, page) {
    const PER = 50;
    const cursor = (page - 1) * PER;
    let data;
    try {
      data = await this._getJson(ctx, "/post/feed/by-key", {
        key: this._FEED_KEY,
        cursor,
      });
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    const posts =
      (data && data.data && Array.isArray(data.data.posts) && data.data.posts) ||
      (Array.isArray(data) ? data : []);
    const list = [];
    for (const post of posts) {
      const vod = this._toVod(ctx, post);
      if (vod) list.push(vod);
    }
    const hasMore = posts.length >= PER;
    return { list, page, pageCount: hasMore ? page + 1 : page, total: list.length };
  },

  /**
   * 末条 id 游标翻页(new / top / tag)。
   * page 1 不带 cursor;page>1 读上一页缓存的末条 id。
   */
  async _idCursorFeed(ctx, page, cacheKey, path, extraQuery) {
    const query = Object.assign({ limit: 20 }, extraQuery || {});
    if (page > 1) {
      let cursor;
      try {
        cursor = await ctx.cache.get("xxxtik:cursor:" + cacheKey + ":" + page);
      } catch (e) {
        /* ignore */
      }
      if (cursor == null || cursor === "") {
        return { list: [], page, pageCount: page, total: 0 };
      }
      query.cursor = cursor;
    }
    let data;
    try {
      data = await this._getJson(ctx, path, query);
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    const posts = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.posts) && data.posts) || [];
    const list = [];
    for (const post of posts) {
      const vod = this._toVod(ctx, post);
      if (vod) list.push(vod);
    }
    const hasMore = posts.length > 0;
    if (hasMore) {
      const last = posts[posts.length - 1];
      const nextCursor = last && (last.id != null ? last.id : last.uid);
      if (nextCursor != null) {
        try {
          await ctx.cache.set(
            "xxxtik:cursor:" + cacheKey + ":" + (page + 1),
            nextCursor,
            1800
          );
        } catch (e) {
          /* ignore */
        }
      }
    }
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /* ───────────────────────── search ───────────────────────── */

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };

    // 第一页先解析出最匹配的 tag 名(/search 返回联想词而非视频),缓存供翻页复用
    let tagName;
    const tagCK = "xxxtik:searchtag:" + kw.toLowerCase();
    try {
      tagName = await ctx.cache.get(tagCK);
    } catch (e) {
      /* ignore */
    }
    if (!tagName) {
      tagName = await this._resolveSearchTag(ctx, kw);
      if (tagName) {
        try {
          await ctx.cache.set(tagCK, tagName, 1800);
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (!tagName) return { list: [], page: p, pageCount: p, total: 0 };

    return this._idCursorFeed(
      ctx,
      p,
      "search:" + tagName,
      "/post/tag/" + encodeURIComponent(tagName),
      {}
    );
  },

  /** 用 /search 联想 → 优先选 tag 类型且名字最接近关键词的,否则回退关键词本身。 */
  async _resolveSearchTag(ctx, kw) {
    let data;
    try {
      data = await this._getJson(ctx, "/search", { query: kw });
    } catch (e) {
      data = null;
    }
    const arr = Array.isArray(data) ? data : [];
    const tags = arr.filter((x) => x && x.type === "tag" && x.name);
    if (tags.length) {
      const lower = kw.toLowerCase();
      // 完全匹配优先,其次按贴数(count)多的
      let exact = tags.find((t) => String(t.name).toLowerCase() === lower);
      if (exact) return exact.name;
      tags.sort((a, b) => (b.count || 0) - (a.count || 0));
      return tags[0].name;
    }
    // 联想没有 tag:直接把关键词当标签名试
    return kw;
  },

  /* ───────────────────────── detail ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    // 没命中缓存也能纯靠 uid 重建播放链(id 本身就是 uid)
    if (!info) {
      const url = this._videoUrl(ctx, { uid: id });
      info = {
        url,
        title: id,
        poster: this._thumbUrl(ctx, { uid: id }),
        typeName: undefined,
        desc: "",
      };
    }
    return {
      id,
      title: info.title || id,
      poster: info.poster || "",
      year: "",
      desc: info.desc || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "xxxtik",
          sourceName: "XXXTik",
          episodes: [{ playUrl: info.url, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  /* ───────────────────────── resolvePlayUrl ───────────────────────── */

  async resolvePlayUrl(ctx, { playUrl }) {
    return {
      url: playUrl,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._site(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /**
   * post → ScriptVodItem。id 用 uid(播放/详情都靠 uid 重建链接)。
   * 顺便塞内存缓存供 detail 命中。
   */
  _toVod(ctx, post) {
    if (!post) return null;
    const uid = post.uid;
    const url = this._videoUrl(ctx, post);
    if (!url) return null;
    const key = uid || String(post.id || "");
    if (!key) return null;

    const title =
      this._decode(post.description || "") ||
      (post.author && this._decode(post.author.name || "")) ||
      key;
    const typeName = this._firstTagName(post);
    const poster = this._thumbUrl(ctx, post);

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[key] = {
      url,
      title,
      poster,
      typeName,
      desc: this._decode(post.description || ""),
    };

    return {
      id: key,
      title,
      poster,
      type_name: typeName,
      vod_remarks: this._remarks(post),
    };
  },

  /** 视频直链:有 uid 走 CDN master.m3u8;否则 redgifs 直链兜底。 */
  _videoUrl(ctx, post) {
    if (!post) return "";
    if (post.uid) return this._media(ctx) + post.uid + "/master.m3u8";
    if (post.redgifs && post.redGifsVideoUrl) return post.redGifsVideoUrl;
    return "";
  },

  /** 缩略图:有 uid 走 CDN webp;否则 redgifs 缩略图兜底。 */
  _thumbUrl(ctx, post) {
    if (!post) return "";
    if (post.uid) return this._media(ctx) + post.uid + "/thumbnail.webp";
    if (post.redgifs && post.redGifsThumbnailUrl) return post.redGifsThumbnailUrl;
    return "";
  },

  _firstTagName(post) {
    try {
      const tags = post.tags;
      if (Array.isArray(tags) && tags.length && tags[0].name) {
        return this._decode(String(tags[0].name)).replace(/^#/, "") || undefined;
      }
    } catch (e) {
      /* ignore */
    }
    return undefined;
  },

  _remarks(post) {
    const bits = [];
    if (post.likes) bits.push("♥ " + this._compact(post.likes));
    if (post.views) bits.push("▶ " + this._compact(post.views));
    return bits.length ? bits.join("  ") : undefined;
  },

  _compact(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  },

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
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
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&hellip;/g, "…")
      .replace(/&nbsp;/g, " ")
      .trim();
  },
};
