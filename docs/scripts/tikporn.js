/**
 * Tik.Porn 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Tik.Porn 是竖屏成人短视频站,前端 Next.js(SSR + 客户端 axios),
 *    Cloudflare 只做 CDN(返回 200,不挂托管质询),API 干净返回 JSON。
 *  - 数据 API 全挂在 https://apiv2.tik.porn(不是 tik.porn/api;后者的
 *    /api/getrecomm 是【直播 cam】代理,与点播视频无关,别用)。
 *  - 视频流走 https://video-cdn.tik.porn,每条 item 服务端直接给
 *    【已签名】的 hls_url(master.m3u8)/ mp4_url / poster_url(带 md5+expires,
 *    约 1 小时过期)。CDN 靠 URL 内签名鉴权,不校验 Referer/UA。
 *  - 【签名过期对策】列表/详情里的签名 URL 会过期,故 playUrl 只存 video_id,
 *    resolvePlayUrl 再用 /getvideosinfo 现拉一条【新鲜签名】的 hls_url 播放。
 *  - 直连(不走代理)可能被墙 / 触发 CF —— 请在「设置 → 代理」配好代理,
 *    scriptFetch 与 dyproxy 拉流都会走它。App 侧有 CF 求解器兜底(此站通常用不上)。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07-12 逆向 + 命令行实测,全程匿名可用):
 *  - 游客令牌: POST /auth/guest → { accesstoken:"<JWT>" }。user_type=GUEST,
 *    有效期约 24h。/getnextvideos 需要它(Authorization: Bearer <token>),
 *    /search 与 /getvideosinfo 匿名即可(不带令牌也 200)。
 *  - 推荐流: POST /getnextvideos(JSON 体,需 Bearer)
 *      body: { amount, filter:[已看过的 video_id...], sfw_mode:0,
 *              forcerand:false, first_chunk:<page===1>, recomm_id:<上页 recommId 或 null> }
 *      → { code:200, data:[item...], extradata:{ recommId } }
 *      同一 Bearer 会话下逐次调用返回【不重复】的新视频(服务端按 token 记录已看);
 *      再把已看 id 累积进 filter 双保险。翻页无固定游标,靠会话推进。
 *  - 搜索: GET /search?search_term=<kw>&index=search&search_type=video&limit=<n>&offset=<n>
 *      → { code:200, data:{ content:[item...], pagination:{ has_more, current_page, ... } } }
 *      offset 翻页(offset = (page-1)*limit)。search_type 必须是 "video"
 *      (复数 "videos" / "all" 返空)。匿名可用。
 *  - 详情/重解析: GET /getvideosinfo?videoids[]=<id>(注意是数组括号写法 videoids%5B%5D=)
 *      → { code:200, data:[item] }。每次都给【新鲜签名】的 hls_url/mp4_url。匿名可用。
 *  - item 关键字段(推荐/搜索/详情三处同构,经服务端拼装):
 *      { video_id, action_name, duration, view_count, like_count,
 *        pornstars:[{name}], creator_display_name?,
 *        hls_url:"...master.m3u8", mpd_url, mp4_url, poster_url, thumbnail_url }
 *
 * 实测证据:
 *  - LIST: POST /getnextvideos → HTTP 200, data 长度 10, 首条 video_id=1672938。
 *          GET /search?search_term=teen&search_type=video → 200, content 非空, total=2192。
 *  - PLAY: HEAD mp4_url → 200 Content-Type: video/mp4。
 *          GET hls_url → 首行 "#EXTM3U" + 多档 #EXT-X-STREAM-INF(360x626 等竖屏)。
 */
return {
  meta: {
    name: "Tik.Porn",
    author: "DouyTV",
    version: "0.1.0",
    description: "Tik.Porn 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /* ── 基址(可 config 覆盖,万一换域名)── */
  _apiBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("apiBase");
    return (typeof b === "string" && b) || "https://apiv2.tik.porn";
  },
  _siteBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("siteBase");
    return (typeof b === "string" && b) || "https://tik.porn";
  },

  /**
   * 固定浏览器 UA。此站不强校验 UA,但带上与浏览器一致更稳(万一 CF 收紧)。
   * 可用 config.ua 覆盖。
   */
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

  /**
   * 拿游客 JWT(Bearer)。/getnextvideos 必须带它;缓存复用,TTL 20h(令牌约 24h)。
   * /auth/guest 是 POST,匿名可调,响应体 { accesstoken }。
   */
  async _guestToken(ctx) {
    const CK = "guest:token";
    try {
      const t = await ctx.cache.get(CK);
      if (t && typeof t === "string") return t;
    } catch (e) {
      /* ignore */
    }
    const url = this._apiBase(ctx) + "/auth/guest";
    const res = await ctx.request.post(url, {
      headers: this._headers(ctx),
      json: {},
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Tik.Porn 游客令牌 HTTP " + res.status);
    const data = await res.json();
    const token = data && (data.accesstoken || data.access_token);
    if (!token) throw new Error("Tik.Porn 游客令牌缺失");
    try {
      await ctx.cache.set(CK, token, 72000);
    } catch (e) {
      /* ignore */
    }
    return token;
  },

  async _getJson(ctx, path, query, extraHeaders) {
    const url = ctx.utils.buildUrl(this._apiBase(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, extraHeaders),
      timeout: 25000,
    });
    if (!res.ok) throw new Error("Tik.Porn HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  /**
   * 静态分类清单 —— 站点没有「按 tag 拉视频列表」的独立端点,分类统一走 /search
   * (search_term = 分类词)。故这里列的是站点高频【标签 / 动作 / 搜索词】,
   * 【亚洲相关】排最前(照用户偏好)。可用 config.categories(逗号分隔)覆盖。
   */
  _categories(ctx) {
    const custom = ctx.config && ctx.config.get && ctx.config.get("categories");
    if (typeof custom === "string" && custom.trim()) {
      return custom
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [
      // 亚洲区(靠前)
      "Asian", "Japanese", "Chinese", "Korean", "Indian", "Thai", "Hijab", "Desi",
      // 常见分类 / 动作
      "Amateur", "Teen", "MILF", "POV", "Blowjob", "Deepthroat", "Twerk",
      "Striptease", "Anal", "Creampie", "Cumshot", "Lesbian", "Solo", "Squirt",
      "Threesome", "BigAss", "BigTits", "SmallTits", "Ebony", "Latina",
      "Cosplay", "Onlyfans", "Feet", "Stockings", "Riding", "Doggystyle",
    ];
  },

  /** 亚洲优先级:中文/台港 → 日 → 韩 → 其它亚洲 → 非亚洲(99)。数字越小越靠前。 */
  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|hong\s*kong|中文|中国|台湾|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|hijab|里番/i.test(s)) return 1;
    if (/korean|korea|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|vietnam|indian/i.test(s)) return 3;
    return 99;
  },

  async getSources(ctx) {
    const sources = [{ id: "feed", name: "推荐", group: "浏览" }];
    const cats = this._categories(ctx).slice();
    // 亚洲相关在前、其余在后;各自保持原顺序。
    const asian = [];
    const other = [];
    for (const c of cats) {
      (this._asianRank(c) < 99 ? asian : other).push(c);
    }
    for (const c of asian) sources.push({ id: "q:" + c, name: c, group: "亚洲" });
    for (const c of other) sources.push({ id: "q:" + c, name: c, group: "分类" });
    return sources;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "feed";
    // 分类源 id 形如 "q:<词>" —— 走搜索。
    if (id.indexOf("q:") === 0) {
      return this._search(ctx, id.slice(2), p, "cat:" + id);
    }
    return this._feed(ctx, p);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    return this._search(ctx, keyword, p, "q:" + keyword);
  },

  /**
   * 推荐流 —— POST /getnextvideos(需 Bearer)。
   * 无固定游标:同一游客会话逐次调用返回不重复视频;再把已看 id 累积进 filter 双保险。
   * page 只用于「是否 first_chunk」与「是否还有更多」判断,不做真正的随机寻址。
   */
  async _feed(ctx, page) {
    const token = await this._guestToken(ctx);

    // 累积「已看」id(避免翻页重复)。缓存 30 分钟。
    const SEEN = "feed:seen";
    let seen = [];
    try {
      const s = await ctx.cache.get(SEEN);
      if (Array.isArray(s)) seen = s;
    } catch (e) {
      /* ignore */
    }
    if (page <= 1) seen = []; // 回到第一页视为新会话,清空已看。

    let recommId = null;
    try {
      recommId = (await ctx.cache.get("feed:recommId")) || null;
    } catch (e) {
      /* ignore */
    }
    if (page <= 1) recommId = null;

    const url = this._apiBase(ctx) + "/getnextvideos";
    const res = await ctx.request.post(url, {
      headers: this._headers(ctx, { Authorization: "Bearer " + token }),
      json: {
        amount: 20,
        filter: seen.slice(-300), // 只带最近的,别让请求体无限膨胀
        sfw_mode: 0,
        forcerand: false,
        first_chunk: page <= 1,
        recomm_id: recommId,
      },
      timeout: 25000,
    });
    if (!res.ok) throw new Error("Tik.Porn 推荐流 HTTP " + res.status);
    const data = await res.json();
    const items = (data && Array.isArray(data.data) && data.data) || [];
    const list = [];
    for (const it of items) {
      const vod = this._itemToVod(ctx, it);
      if (vod) {
        list.push(vod);
        seen.push(vod.id);
      }
    }

    // 记录下一页所需状态。
    const nextRid = (data && data.extradata && data.extradata.recommId) || recommId;
    try {
      await ctx.cache.set(SEEN, seen, 1800);
      if (nextRid) await ctx.cache.set("feed:recommId", nextRid, 1800);
    } catch (e) {
      /* ignore */
    }

    const hasMore = list.length > 0; // 推荐流理论上无限,拿到东西就还有下一页。
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * 搜索 / 分类 —— GET /search,offset 翻页(offset=(page-1)*limit)。匿名可用。
   * search_type 固定 "video"(单数);sk 为缓存分区键(此处仅占位,offset 无需缓存)。
   */
  async _search(ctx, keyword, page, sk) {
    const limit = 30;
    const offset = (page - 1) * limit;
    const data = await this._getJson(ctx, "/search", {
      search_term: keyword,
      index: "search",
      search_type: "video",
      limit,
      offset,
    });
    const content =
      (data && data.data && Array.isArray(data.data.content) && data.data.content) ||
      [];
    const list = [];
    for (const it of content) {
      const vod = this._itemToVod(ctx, it);
      if (vod) list.push(vod);
    }
    const pg = (data && data.data && data.data.pagination) || {};
    const hasMore = !!pg.has_more && list.length > 0;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: pg.total || list.length,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    // 优先用列表/搜索时缓存的元信息(标题/封面),miss 才 /getvideosinfo 现拉。
    let info;
    try {
      info = await ctx.cache.get("item:" + id);
    } catch (e) {
      /* ignore */
    }
    if (!info && this._pendingCache && this._pendingCache[id]) {
      info = this._pendingCache[id];
    }
    if (!info) {
      const item = await this._fetchVideoInfo(ctx, id);
      if (!item) throw new Error("Tik.Porn: 未找到该视频(可能已删除)@ " + id);
      info = this._itemMeta(item);
    }

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
          sourceName: "Tik.Porn",
          // playUrl 只放 video_id;resolvePlayUrl 再现拉【新鲜签名】的 hls,避免过期。
          episodes: [{ playUrl: String(id), needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 是 video_id。现拉一条新鲜签名的 hls_url(签名带 expires,约 1h,现拉最稳)。
    const id = String(playUrl).replace(/[^0-9]/g, "");
    const item = await this._fetchVideoInfo(ctx, id);
    const hls = item && (item.hls_url || item.master_url);
    const mp4 = item && item.mp4_url;
    if (hls) {
      return {
        url: hls,
        type: "hls",
        headers: {
          "User-Agent": this._ua(ctx),
          Referer: this._siteBase(ctx) + "/",
        },
      };
    }
    if (mp4) {
      return {
        url: mp4,
        type: "mp4",
        headers: {
          "User-Agent": this._ua(ctx),
          Referer: this._siteBase(ctx) + "/",
        },
      };
    }
    throw new Error("Tik.Porn: 无法解析播放地址 @ " + playUrl);
  },

  /** GET /getvideosinfo?videoids[]=<id> → item(新鲜签名 URL)。匿名可用。 */
  async _fetchVideoInfo(ctx, id) {
    // buildUrl 不支持数组,手动拼 videoids[]= 括号写法(实测普通重复 key 会 500)。
    const url =
      this._apiBase(ctx) +
      "/getvideosinfo?videoids%5B%5D=" +
      encodeURIComponent(String(id));
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Tik.Porn 视频信息 HTTP " + res.status + " @ " + id);
    const data = await res.json();
    const arr = (data && Array.isArray(data.data) && data.data) || [];
    return arr[0] || null;
  },

  /* ───────────────────────── 归一化 ───────────────────────── */

  /**
   * item → ScriptVodItem。只接受能拿到 video_id + 播放地址(hls/mp4)的项。
   * 同时把元信息缓存到 item:<id>,供 detail 命中(免二次请求)。
   */
  _itemToVod(ctx, item) {
    if (!item) return null;
    const id = item.video_id != null ? item.video_id : item.id;
    if (id == null) return null;
    const hasPlayable = !!(item.hls_url || item.mp4_url || item.master_url);
    if (!hasPlayable) return null;

    const meta = this._itemMeta(item);

    // 缓存元信息给 detail 用(TTL 2h)。播放地址会过期,detail 不存 URL,只存元信息。
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = meta;
    try {
      ctx.cache.set("item:" + id, meta, 7200);
    } catch (e) {
      /* ignore */
    }

    return {
      id: String(id),
      title: meta.title,
      poster: meta.poster,
      desc: meta.desc || undefined,
      type_name: meta.typeName,
      vod_remarks: meta.remarks || undefined,
    };
  },

  /** item → 归一化元信息 { title, poster, desc, typeName, remarks }。 */
  _itemMeta(item) {
    const stars = Array.isArray(item.pornstars) ? item.pornstars : [];
    const starNames = stars
      .map((s) => (s && (s.name || s.slug)) || "")
      .filter(Boolean);
    const creator =
      (item.creator_display_name || item.creator_name || "").toString().trim();
    const action = (item.action_name || "").toString().trim();

    // 标题:演员名 - 动作 / 动作 / 上传者 / 兜底 video_id。
    let title = "";
    if (starNames.length && action) title = starNames.join(", ") + " - " + action;
    else if (starNames.length) title = starNames.join(", ");
    else if (creator && action) title = creator + " - " + action;
    else title = action || creator || "视频 " + (item.video_id || item.id || "");
    if (title.length > 80) title = title.slice(0, 80).trim() + "…";

    const poster = item.poster_url || item.thumbnail_url || item.poster || undefined;

    return {
      title,
      poster,
      desc: creator || (starNames.length ? starNames.join(", ") : ""),
      typeName: action || undefined,
      remarks: this._fmtDuration(item.duration),
    };
  },

  /** 秒 → m:ss。API 里 duration 单位是【秒】(46 = 0:46)。 */
  _fmtDuration(d) {
    let sec = Number(d);
    if (!sec || sec <= 0) return "";
    sec = Math.round(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  },
};
