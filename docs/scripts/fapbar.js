/**
 * Fap.Bar 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - fap.bar 主域 302 跳到 cams.fap.bar —— 这是一个【Stripchat 白标】成人直播站
 *    (后端 X-Backend: oscar-wl-ssr / sc-wl-fw,CDN 全走 doppiocdn.com + strpst.com,
 *     前端 bundle 在 assets.chapturist.com)。所以它没有点播短视频,只有【真人直播间】,
 *    每个「视频」= 一个当前在播的 model,detail 只有一集(直播流),resolvePlayUrl
 *    返回该主播的 HLS master。
 *  - 直播流走 Stripchat 的 Mouflon DRM:master 顶部有 12 行
 *    `#EXT-X-MOUFLON:PSCH:v2:{pkey}`,variant 段名被加扰(`#EXT-X-MOUFLON:URI:` +
 *    `media.mp4` 占位)。DouyTV 的 Rust 代理层(src-tauri/src/mouflon.rs + lib.rs)
 *    会自动识别 doppiocdn host、给 master 注入 pkey、并用用户在「设置 → Stripchat Keys」
 *    里填的 `pkey:pdkey` 对解扰段名。**没有 pdkey 只会拿到真流的加扰列表但播不出画面
 *    (黑屏)** —— 这与站内既有 Stripchat 支持完全一致,脚本侧只负责给出干净的 master URL。
 *  - 国内直连被墙 + 数据中心 IP 可能被 CDN 限,请在「设置 → 代理」配好代理;
 *    scriptFetch 与 dyproxy 拉流都会走它。经代理 127.0.0.1:7897 全程匿名可用。
 *  - 代理出口带地域偏置(实测走日本出口 → 列表默认 girls/japanese 块,天然亚洲优先)。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07-13 逆向 + curl 经 127.0.0.1:7897 代理实测,全程匿名):
 *  - 列表: GET /api/front/v2/models?limit=48&offset=<n>&primaryTag=<girls|couples|trans|men>
 *      → { blocks:[{ id, url, models:[model...] }], totalCount, ... }
 *      响应恒为「分块」结构(countryGenderModels / mostPopularModels / topStreamsModels 等);
 *      topStreamsModels 每块 12 条、按 offset 干净翻页(off 0/48/120/240 零重叠);
 *      mostPopularModels 每次重排(offset 重叠高)。故 recommend 把所有块摊平 + 按 id 去重
 *      + 会话级 seen-set 双保险,offset=(page-1)*48 推进。filterGroupTags(具名 tag)被服务端
 *      忽略,但 primaryTag(girls/couples/trans/men)有效,故分类只用 primaryTag。
 *      实测: primaryTag=girls → 200, totalCount 2000, 首条 streamName=217827286。
 *  - 搜索: GET /api/front/v5/models/search/group/all?query=<kw>&primaryTag=girls&limit=<n>&offset=<n>
 *      → { groups:{ username:{models,totalCount}, topic:{...}, tipMenu:{...}, ... } }
 *      主结果在 groups.username(totalCount 8631),另取 topic/tipMenu 合并去重。
 *      primaryTag 必填(缺失 400)。offset 翻 username 组。实测 query=lucy → 200,
 *      username.totalCount=8631, 首条 lucy-sexbebe。搜索结果的 model 【不带 streamName】,
 *      靠 resolvePlayUrl 现拉。
 *  - 解流名: GET /api/front/v2/models/username/<username>/cam
 *      → { cam:{ isCamAvailable, streamName, ... }, user:{...} }
 *      streamName 是数字(如 217827286),【不是】URL 用户名。实测 200,isCamAvailable true。
 *  - 播放: master = https://edge-hls.doppiocdn.com/hls/<streamName>/master/<streamName>_auto.m3u8
 *      实测 200 application/vnd.apple.mpegurl,含 12 个 #EXT-X-MOUFLON:PSCH:v2 pkey +
 *      3 档 variant(720p/480p/240p,指向 media-hls.doppiocdn.com)。
 *      variant 带 ?pkey=&psch=v2 → 200 返回【真实直播】Mouflon 加扰段(不带 pkey 会 302 到
 *      cpa/v2/stream.m3u8 广告 VOD)。init.mp4(MAP URI,未加扰)→ 206 Content-Type: video/mp4。
 *
 * 播放验证结论:
 *  - master / variant(带 pkey,真流非广告)/ init.mp4(206 video/mp4)三级均【匿名 curl 通过】。
 *  - 单个媒体分片名被 Mouflon 加扰,解扰需【轮换的 pdkey】(用户在「设置 → Stripchat Keys」
 *    提供),由 App 的 Rust 代理层完成 —— 与站内既有 Stripchat 播放路径同源。脚本只出干净 master。
 */
return {
  meta: {
    name: "Fap.Bar",
    author: "DouyTV",
    version: "0.1.0",
    description:
      "Fap.Bar 真人直播(Stripchat 白标,成人内容;需代理 + Stripchat Keys pdkey + 年龄确认)",
  },

  /* ───────────────────────── 基址 / 请求头 ───────────────────────── */

  _apiBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("apiBase");
    return (typeof b === "string" && b) || "https://cams.fap.bar";
  },
  _siteBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("siteBase");
    return (typeof b === "string" && b) || "https://cams.fap.bar";
  },
  // 直播流 CDN(Stripchat 用 doppiocdn.{com,net,org} 轮换;默认 .com,App 代理层按 host 识别)。
  _hlsHost(ctx) {
    const h = ctx.config && ctx.config.get && ctx.config.get("hlsHost");
    return (typeof h === "string" && h) || "edge-hls.doppiocdn.com";
  },
  // 相对封面(previewUrlThumbSmall / avatarUrl)前缀。
  _imgBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("imgBase");
    return (typeof b === "string" && b) || "https://static-cdn.strpst.com";
  },

  // fap.bar 之前对某些 UA/Accept 返 406,故固定真实浏览器 UA + Accept 头。可用 config.ua 覆盖。
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

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._apiBase(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 25000,
    });
    if (!res.ok) throw new Error("Fap.Bar HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  /**
   * 站点只有 primaryTag 这一个【真正生效】的服务端过滤维度(具名 tag / country 均被忽略)。
   * girls 因代理地域偏置天然亚洲优先,故排最前。
   */
  async getSources() {
    return [
      { id: "girls", name: "女主播(亚洲优先)", group: "直播" },
      { id: "couples", name: "情侣", group: "直播" },
      { id: "trans", name: "变性", group: "直播" },
      { id: "men", name: "男主播", group: "直播" },
      // 影集 / VOD —— /videos 页 SSR 内嵌视频列表(Mouflon 加扰,与直播同款 pdkey)。
      // 站点该页无深翻页参数,只有排序变体,故 VOD 只提供三种排序入口。
      { id: "vod:new", name: "影集 · 最新", group: "影集" },
      { id: "vod:likes", name: "影集 · 最赞", group: "影集" },
      { id: "vod:trending", name: "影集 · 热门", group: "影集" },
    ];
  },

  /** 亚洲优先排序:中日韩港台等靠前(数字越小越靠前)。 */
  _asianRank(country) {
    const c = String(country || "").toLowerCase();
    if (c === "cn" || c === "tw" || c === "hk" || c === "mo") return 0;
    if (c === "jp") return 1;
    if (c === "kr") return 2;
    if (["th", "vn", "ph", "id", "my", "sg", "in", "kz"].indexOf(c) >= 0) return 3;
    return 99;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "girls";
    // 影集 / VOD 分支:走 /videos SSR。该页不深翻页,只 page 1 返一屏(约 48 条)。
    if (id.indexOf("vod:") === 0) {
      return this._vodFeed(ctx, p, id.slice("vod:".length));
    }
    return this._feed(ctx, p, id);
  },

  /**
   * VOD 列表。站点会在不提示的情况下更换 front API 版本，因此先从
   * /videos 页面和前端 bundle 找真实 endpoint，再验证 JSON 结构并缓存。
   * 当前实测真实接口为 /api/front/feed/guest/trending，参数 type=video，
   * 返回 { posts:[{ video:{ videoUrl, coverUrl, ... } }], nextPageParams }。
   */
  async _vodFeed(ctx, page, sort) {
    const limit = 24;
    const offset = (page - 1) * limit;
    const sortBy =
      sort === "likes" ? "mostLiked" : sort === "trending" ? "trending" : "mostRecent";
    const result = await this._fetchVodPage(ctx, {
      limit,
      offset,
      sortBy,
      type: "video",
      primaryTag: "girls",
    });
    const data = result && result.data;
    const videos = this._extractVodRows(data);
    if (!videos.length && page === 1) {
      ctx.log && ctx.log.warn && ctx.log.warn("Fap.Bar VOD: 未找到可用点播接口或列表为空");
    }
    const list = [];
    for (const v of videos) {
      const vod = this._vodToItem(ctx, v);
      if (vod) list.push(vod);
    }
    const count = this._extractVodCount(data);
    const hasMore = videos.length >= limit && (count ? offset + limit < count : true);
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: count || list.length,
    };
  },

  /**
   * 探测新版点播 API。候选接口只在响应能解析出视频数组时才会被缓存，
   * 所以 404/HTML/错误 JSON 不会污染后续请求。
   */
  async _fetchVodPage(ctx, query) {
    const cacheKey = "fapbar:vod-api-path:v2";
    const paths = [];
    try {
      const cached = ctx.cache && (await ctx.cache.get(cacheKey));
      if (typeof cached === "string" && cached) paths.push(cached);
    } catch (e) {
      /* ignore cache miss */
    }

    // 常见版本作为低成本兜底，真实地址优先由 bundle 探测补入。
    const fallback = [
      "/api/front/feed/guest/trending",
      "/api/front/v5/videos",
      "/api/front/v4/videos",
      "/api/front/v2/videos",
      "/api/front/v1/videos",
      "/api/front/videos",
      "/api/videos",
      "/api/front/v3/videos",
    ];
    for (const p of fallback) if (paths.indexOf(p) < 0) paths.push(p);

    const queryVariants = [
      query,
      {
        limit: query.limit,
        offset: query.offset,
        type: query.type || "video",
        primaryTag: query.primaryTag || "girls",
        sort: query.sortBy,
      },
      {
        limit: query.limit,
        offset: query.offset,
        type: query.type || "video",
        primaryTag: query.primaryTag || "girls",
        order: query.sortBy,
      },
    ];
    const tryPaths = async (candidatePaths) => {
      for (const path of candidatePaths) {
        for (const q of queryVariants) {
          try {
            const url = /^https?:\/\//i.test(path)
              ? ctx.utils.buildUrl(path, q)
              : ctx.utils.buildUrl(this._apiBase(ctx) + path, q);
            const res = await ctx.request.get(url, {
              headers: this._headers(ctx),
              timeout: 20000,
            });
            if (!res.ok) continue;
            const body = await res.json();
            if (!this._extractVodRows(body).length && !this._hasVodArray(body)) continue;
            try {
              if (ctx.cache) await ctx.cache.set(cacheKey, path, 21600);
            } catch (e) {
              /* ignore cache write */
            }
            return { data: body, path };
          } catch (e) {
            // Try the next path/query shape; a stale endpoint must not abort live feeds.
          }
        }
      }
      return null;
    };

    const apiResult = await tryPaths(paths);
    if (apiResult) return apiResult;

    // Only download page bundles when the known endpoint family failed.
    const discovered = await this._discoverVodApiPaths(ctx);
    const discoveredResult = await tryPaths(discovered);
    if (discoveredResult) return discoveredResult;

    // Last resort for deployments that still server-render the first page.
    try {
      const res = await ctx.request.get(this._siteBase(ctx) + "/videos", {
        headers: this._headers(ctx, { Accept: "text/html,application/xhtml+xml" }),
        timeout: 20000,
      });
      if (res.ok) {
        const html = await res.text();
        const rows = this._parsePreloadedFeedPosts(html);
        const ssrRows = rows.length ? rows : this._parseSsrVideos(html);
        if (ssrRows.length) return { data: { videos: ssrRows, count: ssrRows.length } };
      }
    } catch (e) {
      /* ignore SSR fallback failure */
    }
    return null;
  },

  /** Find endpoint literals in the page and its loaded JavaScript bundles. */
  async _discoverVodApiPaths(ctx) {
    const found = [];
    const add = (value) => {
      if (!value) return;
      let p = String(value).replace(/\\u002f/g, "/");
      const m = p.match(/(?:https?:\/\/[^/]+)?(\/api\/[^"'`\\s]+videos[^"'`\\s]*)/i);
      if (!m) return;
      p = m[1].replace(/[),;]+$/, "");
      if (found.indexOf(p) < 0) found.push(p);
    };
    let html = "";
    try {
      const res = await ctx.request.get(this._siteBase(ctx) + "/videos", {
        headers: this._headers(ctx, { Accept: "text/html,application/xhtml+xml" }),
        timeout: 20000,
      });
      if (!res.ok) return found;
      html = await res.text();
      const literalRe = /(?:https?:\/\/[^"'`\\s]+|\/api\/[^"'`\\s]+videos[^"'`\\s]*)/gi;
      let match;
      while ((match = literalRe.exec(html))) add(match[0]);
    } catch (e) {
      return found;
    }

    const scripts = [];
    const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
    let sm;
    while ((sm = scriptRe.exec(html)) && scripts.length < 12) {
      scripts.push(ctx.utils.joinUrl(this._siteBase(ctx), sm[1]));
    }
    for (const src of scripts) {
      try {
        const res = await ctx.request.get(src, {
          headers: this._headers(ctx, { Accept: "application/javascript,text/javascript,*/*" }),
          timeout: 20000,
        });
        if (!res.ok) continue;
        const js = await res.text();
        const re = /(?:https?:\/\/[^"'`\\s]+|\/api\/[^"'`\\s]+videos[^"'`\\s]*)/gi;
        let match;
        while ((match = re.exec(js))) add(match[0]);
      } catch (e) {
        /* one bundle failing must not stop discovery */
      }
    }
    return found;
  },

  _extractVodRows(body) {
    const candidates = [
      body,
      body && body.data,
      body && body.result,
      body && body.data && body.data.data,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
      if (!c || typeof c !== "object") continue;
      for (const key of ["videos", "items", "results", "content", "list"]) {
        if (Array.isArray(c[key])) return c[key];
      }
      if (Array.isArray(c.posts)) {
        return c.posts
          .map((post) => {
            const video = post && (post.video || post.media);
            if (!video || typeof video !== "object") return null;
            return Object.assign({}, video, {
              modelId: video.modelId || video.userId || (post.model && post.model.id),
              modelUsername:
                (post.model && (post.model.username || post.model.name)) ||
                video.modelUsername ||
                video.username,
              likesCount: video.likes != null ? video.likes : post.likes,
              thumb: video.thumb || video.coverUrl || video.cover_url,
            });
          })
          .filter(Boolean);
      }
    }
    return [];
  },

  _extractVodCount(body) {
    const candidates = [body, body && body.data, body && body.result, body && body.data && body.data.pagination];
    for (const c of candidates) {
      if (!c || typeof c !== "object") continue;
      for (const key of ["count", "total", "totalCount", "total_count"]) {
        if (Number.isFinite(Number(c[key]))) return Number(c[key]);
      }
    }
    return 0;
  },

  _hasVodArray(body) {
    const candidates = [
      body,
      body && body.data,
      body && body.result,
      body && body.data && body.data.data,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return true;
      if (!c || typeof c !== "object") continue;
      for (const key of ["videos", "items", "results", "content", "list"]) {
        if (Array.isArray(c[key])) return true;
      }
      if (Array.isArray(c.posts)) return true;
    }
    return false;
  },

  /**
   * 从 /videos 页 SSR 抠出 `"videos":[ ... ]` 数组(括号配平,跳过字符串内的括号)。
   * 失败返空数组。
   */
  _parseSsrVideos(html) {
    if (!html || typeof html !== "string") return [];
    const key = '"videos":[';
    const at = html.indexOf(key);
    if (at < 0) return [];
    const start = at + key.length - 1; // 指向 '['
    let depth = 0;
    let inStr = false;
    let quote = "";
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === quote) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        quote = c;
        continue;
      }
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) {
          const json = html.slice(start, i + 1);
          try {
            const arr = JSON.parse(json);
            return Array.isArray(arr) ? arr : [];
          } catch (e) {
            return [];
          }
        }
      }
    }
    return [];
  },

  /** Parse the current SSR state: window.__PRELOADED_STATE__.feed.posts[].video. */
  _parsePreloadedFeedPosts(html) {
    if (!html || typeof html !== "string") return [];
    const key = "window.__PRELOADED_STATE__ = ";
    const at = html.indexOf(key);
    if (at < 0) return [];
    const start = at + key.length;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            const state = JSON.parse(html.slice(start, i + 1));
            const posts = state && state.feed && state.feed.posts;
            return Array.isArray(posts)
              ? posts.map((post) => post && post.video).filter(Boolean)
              : [];
          } catch (e) {
            return [];
          }
        }
      }
    }
    return [];
  },

  /**
   * feed/video 对象 → ScriptVodItem。跳过无 videoUrl / 付费项。
   * videoUrl 已是签名 Mouflon HLS master,直接作 playUrl(App Rust 层解扰)。
   */
  _vodToItem(ctx, v) {
    if (!v) return null;
    const idValue = v.id != null ? v.id : v.videoId != null ? v.videoId : v.video_id;
    if (idValue == null) return null;
    const media = v.media && typeof v.media === "object" ? v.media : v;
    const url =
      media.videoUrl ||
      media.video_url ||
      media.hlsUrl ||
      media.hls_url ||
      media.playUrl ||
      media.play_url ||
      media.url;
    if (!url || typeof url !== "string") return null;
    const cost = v.price != null ? v.price : v.cost;
    if ((cost && Number(cost) > 0) || (v.accessMode === "paid" && !v.isPurchased)) {
      return null; // 付费影集匿名放不出,跳过
    }
    const id = "vod_" + idValue;
    const username = v.userUsername || v.username || v.modelUsername || v.model_username;
    const title = (v.title || v.name || username || String(idValue)).toString().trim();
    const remarks = [];
    if (v.duration || v.durationSeconds) {
      const s = Number(v.duration || v.durationSeconds) || 0;
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      remarks.push(mm + ":" + (ss < 10 ? "0" : "") + ss);
    }
    const likes = v.likesCount != null ? v.likesCount : v.likes != null ? v.likes : v.like_count;
    if (likes) remarks.push("likes " + likes);
    const poster =
      v.thumb ||
      v.thumbnail ||
      v.thumbnailUrl ||
      v.thumbnail_url ||
      v.coverUrl ||
      v.cover_url ||
      v.poster;

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      title,
      poster: poster || undefined,
      desc: (v.description || v.desc || "").trim(),
      videoUrl: url,
      modelId: v.modelId || v.userId || undefined,
      isVod: true,
    };

    return {
      id,
      title,
      poster: poster || undefined,
      poster_headers: poster
        ? { "User-Agent": this._ua(ctx), Referer: this._siteBase(ctx) + "/" }
        : undefined,
      desc: username ? "@" + username : undefined,
      vod_remarks: remarks.length ? remarks.join(" · ") : undefined,
    };
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    return this._search(ctx, keyword, p);
  },

  /**
   * 列表 —— GET /api/front/v2/models,把响应里所有 block 的 models 摊平 + 按 id 去重,
   * 再减去会话级 seen-set(避免翻页重复;mostPopularModels 会重排)。offset=(page-1)*48。
   */
  async _feed(ctx, page, tag) {
    const limit = 48;
    const offset = (page - 1) * limit;
    const data = await this._getJson(ctx, "/api/front/v2/models", {
      limit,
      offset,
      primaryTag: tag,
    });

    // 会话级已见 id(page===1 视为新会话清空)。缓存 30 分钟。
    const SEEN = "feed:seen:" + tag;
    let seen = {};
    try {
      const s = await ctx.cache.get(SEEN);
      if (s && typeof s === "object") seen = s;
    } catch (e) {
      /* ignore */
    }
    if (page <= 1) seen = {};

    const blocks = (data && Array.isArray(data.blocks) && data.blocks) || [];
    const merged = [];
    const localSeen = {};
    for (const b of blocks) {
      const models = (b && Array.isArray(b.models) && b.models) || [];
      for (const m of models) {
        const id = m && (m.id != null ? m.id : m.username);
        if (id == null) continue;
        const key = String(id);
        if (localSeen[key] || seen[key]) continue;
        localSeen[key] = 1;
        merged.push(m);
      }
    }

    // 亚洲优先 + 在播优先。
    merged.sort((a, b) => {
      const ra = this._asianRank(a.country);
      const rb = this._asianRank(b.country);
      if (ra !== rb) return ra - rb;
      const la = a.isLive ? 0 : 1;
      const lb = b.isLive ? 0 : 1;
      if (la !== lb) return la - lb;
      return (b.viewersCount || 0) - (a.viewersCount || 0);
    });

    const list = [];
    for (const m of merged) {
      const vod = this._itemToVod(ctx, m);
      if (vod) {
        list.push(vod);
        seen[vod.id] = 1;
      }
    }

    try {
      await ctx.cache.set(SEEN, seen, 1800);
    } catch (e) {
      /* ignore */
    }

    const total = (data && data.totalCount) || 0;
    const hasMore = list.length > 0 && offset + limit < total;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: total || list.length,
    };
  },

  /**
   * 搜索 —— GET /api/front/v5/models/search/group/all(primaryTag 必填)。
   * 合并 username / topic / tipMenu 三组 models,按 id 去重。offset 翻 username 组。
   */
  async _search(ctx, keyword, page) {
    const limit = 30;
    const offset = (page - 1) * limit;
    const data = await this._getJson(ctx, "/api/front/v5/models/search/group/all", {
      query: keyword,
      primaryTag: "girls",
      limit,
      offset,
    });
    const groups = (data && data.groups) || {};
    const pick = ["username", "topic", "tipMenu", "interest", "activity"];
    const seen = {};
    const list = [];
    let total = 0;
    for (const g of pick) {
      const grp = groups[g];
      if (!grp) continue;
      if (g === "username" && grp.totalCount) total = grp.totalCount;
      const models = (Array.isArray(grp.models) && grp.models) || [];
      for (const m of models) {
        const id = m && (m.id != null ? m.id : m.username);
        if (id == null || seen[id]) continue;
        seen[id] = 1;
        const vod = this._itemToVod(ctx, m);
        if (vod) list.push(vod);
      }
    }
    // 亚洲 + 在播优先。
    list.sort((a, b) => (a._rank || 99) - (b._rank || 99));
    for (const it of list) delete it._rank;

    const hasMore = list.length > 0 && offset + limit < (total || 0);
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: total || list.length,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    // VOD(影集)条目:id 形如 "vod_<videoId>",播放链已在列表阶段缓存(签名 master)。
    if (String(id).indexOf("vod_") === 0) {
      let info = (this._pendingCache && this._pendingCache[id]) || null;
      if (!info) {
        try {
          info = await ctx.cache.get("item:" + id);
        } catch (e) {
          /* ignore */
        }
      }
      if (!info) {
        // 冷启动直接进详情:重扫 VOD 快照找这个 id。
        try {
          const result = await this._fetchVodPage(ctx, {
            limit: 24,
            offset: 0,
            sortBy: "mostRecent",
            type: "video",
            primaryTag: "girls",
          });
          this._extractVodRows(result && result.data).forEach((v) => this._vodToItem(ctx, v));
          info = (this._pendingCache && this._pendingCache[id]) || null;
        } catch (e) {
          /* ignore */
        }
      }
      if (!info || !info.videoUrl) {
        throw new Error("Fap.Bar: 未找到该影集(可能已下架 / 链过期,请回列表重进)@ " + id);
      }
      return {
        id: String(id),
        title: info.title || String(id),
        poster: info.poster,
        poster_headers: info.poster
          ? { "User-Agent": this._ua(ctx), Referer: this._siteBase(ctx) + "/" }
          : undefined,
        year: "",
        desc: info.desc || "",
        type_name: info.typeName,
        playbacks: [
          {
            sourceId: sourceId || "vod",
            sourceName: "Fap.Bar",
            // 只传稳定的 id;resolvePlayUrl 会用 v2 详情接口重新签名,避免旧 URL 过期。
            episodes: [
              {
                playUrl: info.modelId
                  ? "fapvod:" + id + ":" + info.modelId
                  : info.videoUrl,
                needResolve: true,
                title: "完整版",
              },
            ],
            episodes_titles: ["完整版"],
          },
        ],
      };
    }

    // id 就是 username。优先用列表缓存的元信息,miss 才现拉 cam 端点。
    const username = String(id);
    let info;
    try {
      info = await ctx.cache.get("item:" + username);
    } catch (e) {
      /* ignore */
    }
    if (!info && this._pendingCache && this._pendingCache[username]) {
      info = this._pendingCache[username];
    }
    if (!info) {
      const cam = await this._fetchCam(ctx, username);
      info = {
        title: username,
        poster: undefined,
        desc: cam && cam.isCamAvailable ? "直播中" : "当前离线",
        typeName: undefined,
        remarks: cam && cam.isCamAvailable ? "LIVE" : "离线",
      };
    }

    return {
      id: username,
      title: info.title || username,
      poster: info.poster,
      year: "",
      desc: info.desc || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "girls",
          sourceName: "Fap.Bar",
          // playUrl 存 username;resolvePlayUrl 现拉 streamName 再拼 master(流名会变/可能离线)。
          episodes: [{ playUrl: username, needResolve: true, title: "直播" }],
          episodes_titles: ["直播"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // VOD:用稳定 id 现拉新签名,不要复用列表阶段可能已过期的 URL。
    if (/^fapvod:/i.test(String(playUrl))) {
      const parts = String(playUrl).split(":");
      const id = parts[1] && parts[1].replace(/^vod_/, "");
      const modelId = parts[2];
      if (id && modelId) {
        try {
          const fresh = await this._fetchVodInfo(ctx, modelId, id);
          const freshUrl = fresh && fresh.videoUrl;
          if (freshUrl) {
            return {
              url: freshUrl,
              type: "hls",
              headers: {
                "User-Agent": this._ua(ctx),
                Referer: this._siteBase(ctx) + "/",
              },
            };
          }
        } catch (e) {
          ctx.log && ctx.log.warn && ctx.log.warn("Fap.Bar VOD 签名刷新失败:", String(e));
        }
      }
      throw new Error("Fap.Bar: 未能刷新影集播放签名 @ " + playUrl);
    }

    // 兼容旧缓存:playUrl 已是 strpst.com 签名 HLS master,直接透传。
    if (/^https?:\/\//i.test(String(playUrl)) && /strpst\.com|doppiocdn/i.test(String(playUrl))) {
      return {
        url: String(playUrl),
        type: "hls",
        headers: {
          "User-Agent": this._ua(ctx),
          Referer: this._siteBase(ctx) + "/",
        },
      };
    }

    const username = String(playUrl).trim();
    const cam = await this._fetchCam(ctx, username);
    if (!cam) throw new Error("Fap.Bar: 未找到该主播 @ " + username);
    if (cam.isCamAvailable === false) {
      throw new Error("Fap.Bar: 该主播当前离线,无法播放 @ " + username);
    }
    const streamName = cam.streamName;
    if (!streamName) throw new Error("Fap.Bar: 未拿到 streamName @ " + username);

    // master;App 的 Rust 代理层识别 doppiocdn host → 注入 pkey + Mouflon 段名解扰。
    const master =
      "https://" +
      this._hlsHost(ctx) +
      "/hls/" +
      streamName +
      "/master/" +
      streamName +
      "_auto.m3u8";
    return {
      url: master,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._siteBase(ctx) + "/",
      },
    };
  },

  /** GET /api/front/v2/users/<modelId>/videos/<videoId> → { video }。 */
  async _fetchVodInfo(ctx, modelId, videoId) {
    const url =
      this._apiBase(ctx) +
      "/api/front/v2/users/" +
      encodeURIComponent(String(modelId)) +
      "/videos/" +
      encodeURIComponent(String(videoId));
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Fap.Bar VOD detail HTTP " + res.status);
    const data = await res.json();
    return (data && data.video) || data || null;
  },

  /** GET /api/front/v2/models/username/<username>/cam → cam({ isCamAvailable, streamName })。 */
  async _fetchCam(ctx, username) {
    const url =
      this._apiBase(ctx) +
      "/api/front/v2/models/username/" +
      encodeURIComponent(username) +
      "/cam";
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Fap.Bar cam HTTP " + res.status + " @ " + username);
    const data = await res.json();
    const cam = (data && data.cam) || null;
    if (cam && cam.streamName == null && data.streamName != null) {
      cam.streamName = data.streamName;
    }
    return cam;
  },

  /* ───────────────────────── 归一化 ───────────────────────── */

  /** 相对封面 → 绝对(带 CDN 前缀);已是绝对 URL 直接用。 */
  _posterUrl(ctx, m) {
    const raw =
      m.previewUrlThumbSmall ||
      m.previewUrl ||
      m.previewUrlThumbBig ||
      m.avatarUrl ||
      "";
    if (!raw) return undefined;
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = this._imgBase(ctx);
    return base + (raw.charAt(0) === "/" ? "" : "/") + raw;
  },

  /**
   * model → ScriptVodItem。id = username(detail/resolve 都按用户名走)。
   * 顺带把元信息缓存到 item:<username>,供 detail 命中免二次请求。
   */
  _itemToVod(ctx, m) {
    if (!m || !m.username) return null;
    const username = String(m.username);
    const country = (m.country || "").toString().toUpperCase();
    const topic = (m.groupShowTopic || m.topic || "").toString().trim();
    const live = !!m.isLive || m.status === "public";

    let title = username;
    if (topic) {
      const t = topic.length > 40 ? topic.slice(0, 40).trim() + "…" : topic;
      title = username + " · " + t;
    }

    const remarksParts = [];
    remarksParts.push(live ? "LIVE" : "离线");
    if (country) remarksParts.push(country);
    if (m.viewersCount) remarksParts.push(m.viewersCount + "人");
    if (m.isHd) remarksParts.push("HD");
    const remarks = remarksParts.join(" · ");

    const poster = this._posterUrl(ctx, m);
    const meta = {
      title,
      poster,
      desc: live ? "直播中" : "当前离线",
      typeName: country || undefined,
      remarks,
    };

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[username] = meta;
    try {
      ctx.cache.set("item:" + username, meta, 3600);
    } catch (e) {
      /* ignore */
    }

    return {
      id: username,
      title: meta.title,
      // 封面 CDN 需带 UA/Referer 走代理(直连地域受限),app 用 poster_headers + 代理加载。
      poster: meta.poster,
      poster_headers: meta.poster
        ? {
            "User-Agent": this._ua(ctx),
            Referer: this._siteBase(ctx) + "/",
          }
        : undefined,
      desc: meta.desc || undefined,
      type_name: meta.typeName,
      vod_remarks: meta.remarks || undefined,
      // 内部排序用(search 消费后删除)。
      _rank: this._asianRank(country) * 10 + (live ? 0 : 5),
    };
  },
};
