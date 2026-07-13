/**
 * Sky.Porn 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Sky.Porn 是 Bluesky (bsky.app) 视频聚合站,内容全是 Bluesky 公开视频。
 *    站点是 Nuxt SSR,但对外暴露了干净的 JSON API,不用抠 DOM。
 *  - 视频流走 bsky 官方 CDN (video.cdn.bsky.app/hls/<did>/<cid>/playlist.m3u8),
 *    竖屏 HLS master (360×640 / 720×1280),天生适合竖屏刷流。
 *  - CDN 不校验 Referer / UA,但【直连被墙 / 触发 Cloudflare 质询】——
 *    请务必在「设置 → 代理」里配好代理,scriptFetch 与播放代理会自动走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测):
 *  - 列表: GET /api/feed?type=videos&niche=<slug>&q=<kw>&cursor=<c>&limit=<n>
 *          → { items: [{ media, records }], cursor }
 *          type=videos 服务端只返回视频; cursor 为 base64 游标, 顺序翻页。
 *  - 分类: GET /api/niches → { <n>: [{ slug, name, emoji, mediaCount }] } 或数组
 *  - 详情: GET /api/media/<hashId> → { media, records }
 *  - media: { mediaType:'video', url:'...playlist.m3u8', thumbnail, hashId, niches }
 *  - records[0]: { text, tags, author:{ handle, displayName, avatar } }
 */
return {
  meta: {
    name: "Sky.Porn",
    author: "DouyTV",
    version: "0.1.0",
    description: "Sky.Porn / Bluesky 视频聚合(成人内容,需代理 + 年龄确认)",
  },

  /** 站点基址,可用脚本 config.base 覆盖(万一换域名)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://sky.porn";
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
    const h = {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      Referer: this._base(ctx) + "/",
    };
    h.Accept = json
      ? "application/json, text/plain, */*"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    return h;
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Sky.Porn HTTP " + res.status + " @ " + url);
    return res.json();
  },

  async getSources(ctx) {
    // 浏览入口 + 真实分类。分类里【亚洲相关】排在最前(照站点内容偏好)。
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let niches = [];
    try {
      niches = await this._fetchNiches(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Sky.Porn 分类抓取失败:", String(e));
    }
    // 亚洲相关(rank<99)在前、其余在后; 各自内部保持原顺序(站点已按热度排)。
    const asian = [];
    const other = [];
    for (const n of niches) {
      (this._asianRank(n.slug + " " + n.name) < 99 ? asian : other).push(n);
    }
    const item = (n, group) => ({
      id: "niche:" + n.slug,
      name: (n.emoji ? n.emoji + " " : "") + n.name,
      group,
    });
    for (const n of asian) sources.push(item(n, "亚洲"));
    for (const n of other) sources.push(item(n, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    const query = {};
    let sk = "latest";
    if (id.indexOf("niche:") === 0) {
      query.niche = id.slice("niche:".length);
      sk = id;
    }
    return this._feed(ctx, p, sk, query);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    return this._feed(ctx, p, "q:" + keyword, { q: keyword });
  },

  /**
   * 通用列表拉取 —— /api/feed?type=videos。
   * cursor 顺序翻页: page 1 不带 cursor,page>1 读上一页缓存的 cursor。
   * 拿到响应后把 response.cursor 存为「下一页」的游标(TTL 30 分钟)。
   * sk 为缓存分区键(区分不同分类 / 搜索词)。
   */
  async _feed(ctx, page, sk, extraQuery) {
    const query = { type: "videos", limit: 30 };
    for (const key in extraQuery) {
      if (extraQuery[key] != null && extraQuery[key] !== "") {
        query[key] = extraQuery[key];
      }
    }

    if (page > 1) {
      let cursor;
      try {
        cursor = await ctx.cache.get("cursor:" + sk + ":" + page);
      } catch (e) {
        /* ignore */
      }
      // 缺游标(缓存过期 / 非顺序翻页)—— 无法定位该页,返回空且不再加载。
      if (!cursor) {
        return { list: [], page, pageCount: page, total: 0 };
      }
      query.cursor = cursor;
    }

    const data = await this._getJson(ctx, "/api/feed", query);
    const items = (data && Array.isArray(data.items) && data.items) || [];
    const list = [];
    for (const it of items) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }

    // 把下一页游标缓存起来(顺序翻页依赖它)。
    const next = data && data.cursor;
    if (next) {
      try {
        await ctx.cache.set("cursor:" + sk + ":" + (page + 1), next, 1800);
      } catch (e) {
        /* ignore */
      }
    }

    // 有下一页游标 & 本页非空才认为还有更多。
    const hasMore = !!next && list.length > 0;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * feed / media item → ScriptVodItem。只接受视频(mediaType==='video')。
   * 同时把解析结果缓存到 media:<hashId>,供 detail 命中(免二次请求)。
   */
  _toVod(it) {
    const media = it && it.media;
    if (!media || media.mediaType !== "video") return null;
    const hashId = media.hashId;
    const url = media.url; // playlist.m3u8
    if (!hashId || !url) return null;

    const rec = (it.records && it.records[0]) || {};
    const author = rec.author || {};
    const title =
      this._cleanTitle(rec.text) ||
      (author.displayName || author.handle || "").trim() ||
      hashId;
    const poster = media.thumbnail || undefined;
    const niches = Array.isArray(media.niches) ? media.niches : [];
    const typeName = niches.length ? niches[0].name : undefined;

    // 缓存 hashId → { url, title, poster, ... } 给 detail 用(TTL 2h)。
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[hashId] = {
      url,
      title,
      poster,
      author: (author.displayName || author.handle || "").trim(),
      desc: (rec.text || "").trim(),
      typeName,
    };

    return {
      id: hashId,
      title,
      poster,
      desc: (author.displayName || author.handle || "").trim(),
      type_name: typeName,
      vod_remarks: author.handle || undefined,
    };
  },

  async detail(ctx, { id, sourceId }) {
    // 先查缓存(recommend / search 已解析过),miss 才请求 /api/media。
    let info;
    try {
      info = await ctx.cache.get("media:" + id);
    } catch (e) {
      /* ignore */
    }
    // recommend 里同步塞的内存缓存(同一次会话翻页最快)。
    if (!info && this._pendingCache && this._pendingCache[id]) {
      info = this._pendingCache[id];
      try {
        await ctx.cache.set("media:" + id, info, 7200);
      } catch (e) {
        /* ignore */
      }
    }

    if (!info) {
      const data = await this._getJson(ctx, "/api/media/" + encodeURIComponent(id));
      const media = data && data.media;
      if (!media || !media.url) {
        throw new Error("Sky.Porn: 未找到该视频(可能已删除)@ " + id);
      }
      const rec = (data.records && data.records[0]) || {};
      const author = rec.author || {};
      const niches = Array.isArray(media.niches) ? media.niches : [];
      info = {
        url: media.url,
        title:
          this._cleanTitle(rec.text) ||
          (author.displayName || author.handle || "").trim() ||
          id,
        poster: media.thumbnail || undefined,
        author: (author.displayName || author.handle || "").trim(),
        desc: (rec.text || "").trim(),
        typeName: niches.length ? niches[0].name : undefined,
      };
      try {
        await ctx.cache.set("media:" + id, info, 7200);
      } catch (e) {
        /* ignore */
      }
    }

    return {
      id,
      title: info.title,
      poster: info.poster,
      year: "",
      desc: info.desc || info.author || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "sky",
          sourceName: "Sky.Porn",
          // playUrl 直接放 m3u8; resolvePlayUrl 只负责补 type/UA,不再发请求。
          episodes: [{ playUrl: info.url, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已经是 bsky HLS master。CDN 不校验 Referer/UA,但设个像样 UA 以防万一。
    // 直连被墙 → 播放走用户全局代理(App 侧 wrapWithProxy 自动处理)。
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

  /**
   * 抓 /api/niches 分类清单。返回可能是数组或 { <n>: [...] } 形态,都兼容。
   * 归一为 [{ slug, name, emoji, mediaCount }],缓存一天。
   */
  async _fetchNiches(ctx) {
    const CK = "niches:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }

    const data = await this._getJson(ctx, "/api/niches");
    let raw = [];
    if (Array.isArray(data)) {
      raw = data;
    } else if (data && typeof data === "object") {
      // { "20": [...] } 或 { niches: [...] } 之类 —— 取第一个数组值。
      for (const key in data) {
        if (Array.isArray(data[key])) {
          raw = data[key];
          break;
        }
      }
    }

    const out = [];
    const seen = {};
    for (const n of raw) {
      if (!n || !n.slug) continue;
      const slug = String(n.slug);
      if (seen[slug]) continue;
      seen[slug] = true;
      out.push({
        slug,
        name: (n.name || slug).toString().trim(),
        emoji: n.emoji || "",
        mediaCount: n.mediaCount || 0,
      });
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
   * 清洗 Bluesky 帖子文本作标题:
   *  - 按行拆,取第一条【去掉 hashtag / URL 后仍有内容】的行
   *  - 行内去掉 #tag、http(s) 链接、多余空白
   *  - 截断到 80 字符
   * 全是 hashtag / 链接(如 "#nsfw #booty")时返回空,交上层回落到作者名。
   */
  _cleanTitle(text) {
    if (!text || typeof text !== "string") return "";
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const cleaned = line
        .replace(/https?:\/\/\S+/g, " ") // 去链接
        .replace(/#[^\s#]+/g, " ") // 去 hashtag
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned && cleaned.length >= 2) {
        return cleaned.length > 80 ? cleaned.slice(0, 80).trim() + "…" : cleaned;
      }
    }
    return "";
  },
};
