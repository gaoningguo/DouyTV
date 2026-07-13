/**
 * BBCRec 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - bbcrec.com 是竖屏成人短视频聚合站(前端 Astro v3 SSR + Svidr/Swiper 岛,
 *    后端独立 JSON API 在 api.bbcrec.com,NestJS 风格,匿名可读)。
 *  - 关键发现: 页面里 <meta itemprop="contentUrl"> 与首屏 astro-island 里
 *    露出的都是 gif.mp4 —— 那是 *预览*(muted/loop 的 gif 版)。真正的完整视频是
 *    HLS: 播放器组件用 isBrowser.js 里的 URL 构造器 `master.m3u8`。三种资源同 uid:
 *       poster  = https://xcdn.tv/cdn/storage/production/bbcrec/post/<uid>/poster.webp
 *       gif预览 = https://xcdn.tv/cdn/storage/production/bbcrec/post/<uid>/gif.mp4
 *       完整版  = https://xcdn.tv/cdn/storage/production/bbcrec/post/<uid>/master.m3u8  ← 用这个
 *  - CDN(xcdn.tv)不校验 Referer/UA,匿名 200 HLS,分片 206 video/mp2t 可 seek。
 *  - 国内直连被墙/被 CF 拦,请在「设置 → 代理」配代理,scriptFetch 与播放代理会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 基址:    https://api.bbcrec.com
 *  - 最新:    GET /post/new?limit=24[&cursor=<lastPostId>]     → { posts:[...] }
 *  - 热门:    GET /post/top?limit=24[&cursor=<lastPostId>]     → { posts:[...] }
 *  - Feed:    GET /post/feed-by-key?limit=24[&cursor=<id>]     → { posts:[...], key }
 *  - 分类:    GET /post/by-tag-random?tag=<slug>&limit=24      → { total, posts, related }
 *             (服务端随机返回,非顺序翻页 —— 翻页=再随机取一批并去重)
 *  - 搜索:    GET /search?query=<kw>&limit=24&skip=<n>
 *             → { type, total, findResult, posts:[...], collections, tags, authors }
 *  - 详情:    GET /post/by-uid/<uid>                           → { post:{...} }
 *  - 顺序翻页游标: cursor = 上一页最后一条 post 的 id(new/top/feed-by-key)。
 *  - 每条 post: { id, uid, path, title, tags:[{name,title}], author:{name,path},
 *                 width, height, views, duration, createdAt, source, mediaType }
 *  - 实测: HEAD .../post/<uid>/master.m3u8 → 200 #EXTM3U(master, 引 1080-2M.m3u8),
 *          分片 .../1080-2M0.ts → 206 video/mp2t(无 Referer 也 200/206)。
 */
return {
  meta: {
    name: "BBCRec",
    author: "DouyTV",
    version: "0.1.0",
    description: "BBCRec 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** 前端站点基址(用于 Referer)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://bbcrec.com";
  },

  /** JSON API 基址,可用脚本 config.api 覆盖(万一换域名)。 */
  _api(ctx) {
    const a = ctx.config && ctx.config.get && ctx.config.get("api");
    return (typeof a === "string" && a) || "https://api.bbcrec.com";
  },

  /** 视频/缩略图 CDN 基址。 */
  _cdn(ctx) {
    const c = ctx.config && ctx.config.get && ctx.config.get("cdn");
    return (
      (typeof c === "string" && c) ||
      "https://xcdn.tv/cdn/storage/production/bbcrec"
    );
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
      Origin: this._base(ctx),
      Referer: this._base(ctx) + "/",
    };
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._api(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("BBCRec HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /** 站点标签清单(全站单一 interracial 领域,静态即可)。 */
  _tags() {
    return [
      { slug: "amateur", name: "Amateur" },
      { slug: "teen", name: "Teen" },
      { slug: "onlyfans", name: "OnlyFans" },
      { slug: "interracial", name: "Interracial" },
      { slug: "bcc", name: "BBC" },
      { slug: "bbc-slut", name: "BBC Slut" },
      { slug: "big-dick", name: "Big Dick" },
      { slug: "big-ass", name: "Big Ass" },
      { slug: "ass", name: "Ass" },
      { slug: "blonde", name: "Blonde" },
      { slug: "snowbunnies", name: "Snowbunny" },
      { slug: "blowjob", name: "Blowjob" },
      { slug: "cumshot", name: "Cumshot" },
      { slug: "cheating", name: "Cheating" },
      { slug: "hotwife", name: "Hotwife" },
      { slug: "cuckold", name: "Cuckold" },
      { slug: "blacked", name: "Blacked" },
      { slug: "homemade", name: "Homemade" },
      { slug: "rough", name: "Rough" },
    ];
  },

  async getSources(ctx) {
    const sources = [
      { id: "new", name: "最新", group: "浏览" },
      { id: "top", name: "热门", group: "浏览" },
    ];
    const tags = this._tags();
    const asian = [];
    const other = [];
    for (const t of tags) {
      (this._asianRank(t.slug + " " + t.name) < 99 ? asian : other).push(t);
    }
    const item = (t, group) => ({ id: "tag:" + t.slug, name: t.name, group });
    for (const t of asian) sources.push(item(t, "亚洲"));
    for (const t of other) sources.push(item(t, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "new";
    if (id.indexOf("tag:") === 0) {
      return this._tagFeed(ctx, p, id.slice("tag:".length));
    }
    const key = id === "top" ? "top" : "new";
    return this._cursorFeed(ctx, p, key);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    const limit = 24;
    let data;
    try {
      data = await this._getJson(ctx, "/search", {
        query: kw,
        limit,
        skip: (p - 1) * limit,
      });
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("BBCRec 搜索失败:", String(e));
      return { list: [], page: p, pageCount: p, total: 0 };
    }
    const arr = (data && Array.isArray(data.posts) && data.posts) || [];
    const total = (data && typeof data.total === "number" && data.total) || 0;
    const list = [];
    for (const it of arr) {
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }
    const hasMore = arr.length >= limit && p * limit < total;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: total || list.length,
    };
  },

  /**
   * 顺序游标翻页(new / top / feed-by-key)。
   * cursor = 上一页最后一条 post 的 id;第 1 页不带 cursor,
   * 拿到结果后把「本页最后一条 id」缓存为下一页的 cursor(TTL 30 分钟)。
   */
  async _cursorFeed(ctx, page, key) {
    const limit = 24;
    const path = key === "top" ? "/post/top" : "/post/new";
    const query = { limit };
    if (page > 1) {
      let cursor;
      try {
        cursor = await ctx.cache.get("cursor:" + key + ":" + page);
      } catch (e) {
        /* ignore */
      }
      if (cursor == null || cursor === "") {
        // 没有上一页留下的游标(直接跳页),无从续接 —— 视为无更多。
        return { list: [], page, pageCount: page, total: 0 };
      }
      query.cursor = cursor;
    }
    let data;
    try {
      data = await this._getJson(ctx, path, query);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("BBCRec 列表失败:", String(e));
      return { list: [], page, pageCount: page, total: 0 };
    }
    const arr = (data && Array.isArray(data.posts) && data.posts) || [];
    const list = [];
    for (const it of arr) {
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }
    const hasMore = arr.length >= limit;
    if (hasMore) {
      const last = arr[arr.length - 1];
      const nextCursor = last && last.id;
      if (nextCursor != null) {
        try {
          await ctx.cache.set("cursor:" + key + ":" + (page + 1), nextCursor, 1800);
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

  /**
   * 分类流。by-tag-random 是服务端随机返回(非顺序游标),
   * 翻页就是再随机取一批,用缓存 seen 去重,连续几页都能出新内容;
   * 空返回视为终止。
   */
  async _tagFeed(ctx, page, slug) {
    const limit = 24;
    let data;
    try {
      data = await this._getJson(ctx, "/post/by-tag-random", {
        tag: slug,
        limit,
      });
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("BBCRec 分类失败:", String(e));
      return { list: [], page, pageCount: page, total: 0 };
    }
    const arr = (data && Array.isArray(data.posts) && data.posts) || [];
    const total = (data && typeof data.total === "number" && data.total) || 0;
    const seenKey = "tagseen:" + slug;
    let seen = {};
    if (page > 1) {
      try {
        seen = (await ctx.cache.get(seenKey)) || {};
      } catch (e) {
        seen = {};
      }
    }
    const list = [];
    for (const it of arr) {
      if (!it || !it.uid) continue;
      if (seen[it.uid]) continue;
      seen[it.uid] = 1;
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }
    try {
      await ctx.cache.set(seenKey, seen, 1800);
    } catch (e) {
      /* ignore */
    }
    // 随机源:只要标签总量比已看到的多,就还能继续翻(再随机取)。
    const hasMore = arr.length > 0 && Object.keys(seen).length < (total || 1e9);
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: total || list.length,
    };
  },

  /**
   * post → ScriptVodItem。id 用 uid(详情/播放都靠它拼 CDN 路径)。
   * 顺便把标题/封面塞内存缓存,detail 命中可免二次请求。
   */
  _toVod(ctx, it) {
    if (!it || !it.uid) return null;
    const uid = String(it.uid);
    const title = (it.title || uid).trim();
    const cdn = this._cdn(ctx);
    const poster = cdn + "/post/" + uid + "/poster.webp";
    const typeName =
      Array.isArray(it.tags) && it.tags.length
        ? this._tagLabel(it.tags[0])
        : undefined;

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[uid] = {
      title,
      poster,
      typeName,
      desc: (it.description || "").trim(),
      year: this._year(it.createdAt),
    };

    const views = typeof it.views === "number" ? it.views : null;
    const dur = typeof it.duration === "number" ? it.duration : null;
    let remarks;
    if (dur) remarks = this._fmtDuration(dur);
    if (views != null) remarks = (remarks ? remarks + " · " : "") + views + " 次播放";

    return {
      id: uid,
      title,
      poster,
      type_name: typeName,
      vod_remarks: remarks,
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      let data;
      try {
        data = await this._getJson(ctx, "/post/by-uid/" + encodeURIComponent(id));
      } catch (e) {
        throw new Error("BBCRec: 详情请求失败 @ " + id + " : " + String(e));
      }
      const post = data && data.post;
      if (!post || !post.uid) {
        throw new Error("BBCRec: 未找到该视频(可能已删除)@ " + id);
      }
      const cdn = this._cdn(ctx);
      info = {
        title: (post.title || id).trim(),
        poster: cdn + "/post/" + post.uid + "/poster.webp",
        typeName:
          Array.isArray(post.tags) && post.tags.length
            ? this._tagLabel(post.tags[0])
            : undefined,
        desc: (post.description || "").trim(),
        year: this._year(post.createdAt),
      };
    }
    const cdn = this._cdn(ctx);
    const playUrl = cdn + "/post/" + id + "/master.m3u8";
    return {
      id,
      title: info.title,
      poster: info.poster,
      year: info.year || "",
      desc: info.desc || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "bbcrec",
          sourceName: "BBCRec",
          episodes: [{ playUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 CDN 上的 master.m3u8。CDN 不校验 Referer/UA,给个像样 UA 即可。
    return {
      url: playUrl,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _tagLabel(t) {
    if (!t) return undefined;
    const name = (t.name || "").replace(/-/g, " ").trim();
    if (!name) return undefined;
    return name.replace(/\b\w/g, (c) => c.toUpperCase());
  },

  _year(iso) {
    if (!iso || typeof iso !== "string") return "";
    const m = iso.match(/^(\d{4})/);
    return m ? m[1] : "";
  },

  _fmtDuration(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + (r < 10 ? "0" + r : r);
  },

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },
};
