/**
 * X.com (Twitter) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 直连 X(twitter),不经任何第三方聚合站 —— 数据源就是 X 官方对外的
 *    【syndication(embed 内嵌)】端点,匿名可读,无需登录/guest token。
 *  - 【为什么不做全站浏览/首页流】X 早已关闭匿名 guest token,首页时间线、
 *    全站搜索都必须登录态 cookie(auth_token + ct0),脆弱且违反 ToS。
 *    唯一稳定的匿名【列表】入口是 syndication 的「指定账号最近推文」:
 *      GET https://syndication.twitter.com/srv/timeline-profile/screen-name/<handle>
 *      → 返回一个内嵌 <script id="__NEXT_DATA__"> 的 HTML 页,里面是该账号最近
 *        ~20 条推文对象(与 tweet-result 同构:含 mediaDetails/video_info/entities)。
 *    故本脚本是【关注账号聚合器】:用户在「设置 → 脚本配置」里配 handles 清单,
 *    「最新」= 把所有 handle 的最近推文聚合按时间倒序,单个 handle 也各成一个分类。
 *  - 【搜索】= 把关键词当账号名直接查该账号时间线(支持带不带 @);
 *    因为匿名没有全站搜索接口,这是最贴近"搜索"语义的可用行为。
 *  - 【翻页】syndication 时间线匿名【不给游标】,每账号只有最近一页(~20 条)。
 *    聚合流第 1 页即全部;单账号亦只有一页。
 *  - 【播放】列表项里已内联 video_info.variants(多档 mp4 + m3u8),直接取最高码率 mp4。
 *    万一某条没内联全,resolvePlayUrl 回退走 tweet-result?id=<statusId>(react-tweet 同款,
 *    无需登录)按 id 重新取直链。twimg 直链无 token 不过期。
 *  - 【twimg 403 修复】video.twimg.com CDN 【拒绝非 twitter 的 Referer】(带别的站 → 403),
 *    resolvePlayUrl 必须用 Referer: https://x.com/;封面 pbs.twimg.com 带 UA 即可。
 *  - 国内直连 X / twimg 被墙 → 「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都走它。
 *  - X 走 Cloudflare/强 h2,ureq(HTTP/1.1 + rustls 默认指纹)易被拦 → 全站请求 http2:true。
 *
 * 配置项 (config):
 *  - handles: 逗号/空格/换行分隔的账号名清单(可带 @)。缺省给几个公开视频账号做演示,
 *             正式使用请自行替换为想追的账号。
 *  - base:    覆盖 syndication 基址(一般不用动)。
 *  - ua:      覆盖 User-Agent。
 *
 * 实测端点形态 (react-tweet / X embed 公开契约):
 *  - LIST:    GET syndication.twitter.com/srv/timeline-profile/screen-name/<h>
 *             → HTML 内 <script id="__NEXT_DATA__" type="application/json">{...}</script>,
 *               props.pageProps.timeline.entries[].content.tweet(或递归可搜到的 tweet 对象)。
 *  - RESOLVE: GET cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>&lang=en
 *             token = ((id/1e15)*π).toString(36) 去掉全部 0 与小数点(react-tweet 同款)。
 */
return {
  meta: {
    name: "X.com",
    author: "DouyTV",
    version: "0.1.0",
    description: "X(Twitter)关注账号竖屏短视频聚合(匿名 syndication,需代理)",
  },

  /** syndication 基址(HTML 时间线页)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://syndication.twitter.com";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  /** 用户配置的账号清单(缺省几个公开视频账号做演示)。返回去 @ 去空的小写 handle 数组。 */
  _handles(ctx) {
    const raw = ctx.config && ctx.config.get && ctx.config.get("handles");
    let list = [];
    if (Array.isArray(raw)) list = raw.slice();
    else if (typeof raw === "string" && raw.trim()) list = raw.split(/[\s,;]+/);
    if (!list.length) {
      // 缺省 NSFW 演示账号 —— 均为真实存在的公开成人向账号(经 syndication 端点验证):
      //   pornhub / PornhubModels 实测返回完整时间线(含 amplify_video 直链)。
      // 【重要局限】syndication 匿名只暴露每账号最近 ~20 条推文、无翻页,且视频是否出现
      //   取决于这些账号近期发的是视频还是图文/预告 —— 故聚合流内容随账号动态变化,
      //   某次刷新可能视频寥寥。正式使用请在「脚本配置 → handles」自行增补想追的账号。
      list = ["pornhub", "PornhubModels", "Brazzers", "Vixen_com"];
    }
    const out = [];
    const seen = {};
    for (const h of list) {
      // 每个条目都过 _parseHandle —— 支持 "@name" / "name" / 完整 x.com 链接。
      const clean = this._parseHandle(String(h || ""));
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(clean);
    }
    return out;
  },

  _headers(ctx, json) {
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      // syndication / twimg 只认 twitter 系的来源;别用本站。
      Referer: "https://platform.twitter.com/",
      Accept: json
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    for (const h of this._handles(ctx)) {
      sources.push({ id: "h:" + h, name: "@" + h, group: "关注" });
    }
    return sources;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    if (id.indexOf("h:") === 0) {
      // 单账号:只有匿名一页,page>1 直接空(告诉 App 到底)。
      if (p > 1) return { list: [], page: p, pageCount: p, total: 0 };
      const tweets = await this._timeline(ctx, id.slice(2));
      return this._pack(tweets, p);
    }
    // 聚合「最新」:所有 handle 的最近推文并集,按时间倒序。匿名无游标 → 第 1 页即全部。
    if (p > 1) return { list: [], page: p, pageCount: p, total: 0 };
    const handles = this._handles(ctx);
    const all = [];
    const seen = {};
    for (const h of handles) {
      let tweets = [];
      try {
        tweets = await this._timeline(ctx, h);
      } catch (e) {
        ctx.log && ctx.log.warn && ctx.log.warn("X.com 时间线失败 @" + h + ":", String(e));
        continue;
      }
      for (const t of tweets) {
        if (t && t.id && !seen[t.id]) {
          seen[t.id] = true;
          all.push(t);
        }
      }
    }
    all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return this._pack(all, p);
  },

  /**
   * 搜索 = 把关键词当账号名查该账号时间线(匿名无全站搜索)。
   * 支持 "@handle" / "handle" / 完整 x.com 链接里的用户名。
   */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    if (p > 1) return { list: [], page: p, pageCount: p, total: 0 };
    const handle = this._parseHandle(kw);
    if (!handle) return { list: [], page: p, pageCount: p, total: 0 };
    let tweets = [];
    try {
      tweets = await this._timeline(ctx, handle);
    } catch (e) {
      return { list: [], page: p, pageCount: p, total: 0 };
    }
    return this._pack(tweets, p);
  },

  /** tweets[] → ScriptSearchResult(全部单页,无翻页)。 */
  _pack(tweets, page) {
    const list = [];
    for (const t of tweets) {
      const vod = this._toVod(t);
      if (vod) list.push(vod);
    }
    return { list, page, pageCount: page, total: list.length };
  },

  /** 每次拉时间线最多用 tweet-result 补齐多少条媒体(限流保护)。 */
  _HYDRATE_MAX: 12,

  /* ───────────────────────── syndication 时间线抓取 ───────────────────────── */

  /**
   * 用 tweet-result 单条接口补齐某条推文的媒体(时间线载荷不含媒体,见 _timeline 注释)。
   *   GET cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>&lang=en
   * 返回:
   *   { url, type, poster }  —— 该推有视频
   *   undefined              —— 该推没视频 / 已删(正常跳过,不影响其它条)
   *   null                   —— 被限流(429)或网络故障 → 调用方应停止本轮补齐
   * 单条结果长缓存 7 天(媒体地址无时效 token,不会变)。
   */
  async _hydrate(ctx, statusId) {
    const id = String(statusId || "").replace(/[^0-9]/g, "");
    if (!id) return undefined;
    const CK = "xcom:tw:" + id;
    try {
      const c = await ctx.cache.get(CK);
      if (c) return c.url ? c : undefined; // 空对象 = 已知无视频
    } catch (e) {
      /* ignore */
    }

    const url = ctx.utils.buildUrl(
      "https://cdn.syndication.twimg.com/tweet-result",
      { id, token: this._syndToken(id), lang: "en" }
    );
    let res;
    try {
      res = await ctx.request.get(url, {
        headers: this._headers(ctx, true),
        timeout: 20000,
        http2: true,
      });
    } catch (e) {
      return null; // 网络故障 —— 让调用方停下,别把整页拖垮
    }
    // 429 = 限流:必须停,继续打只会更糟(实测连续请求就会触发)。
    if (res.status === 429) {
      ctx.log && ctx.log.warn && ctx.log.warn("X.com: syndication 限流(429),本轮停止补齐媒体");
      return null;
    }
    if (!res.ok) {
      // 404 = 原帖已删/受限 —— 记一个空壳,避免下次重复打。
      try {
        await ctx.cache.set(CK, {}, 86400);
      } catch (e) {
        /* ignore */
      }
      return undefined;
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return undefined;
    }
    const v = this._pickVideo(data);
    const val = v && v.url ? { url: v.url, type: v.type, poster: v.poster || "" } : {};
    try {
      await ctx.cache.set(CK, val, 7 * 86400);
    } catch (e) {
      /* ignore */
    }
    return val.url ? val : undefined;
  },

  /**
   * 抓 <handle> 的 syndication 时间线页,解 __NEXT_DATA__ → 归一化 tweet 数组
   * (只保留带视频的,按 ts 倒序)。缓存 5 分钟避免频繁打点。
   */
  async _timeline(ctx, handle) {
    const h = String(handle || "").replace(/^@+/, "").replace(/[^\w]/g, "");
    if (!h) return [];
    const CK = "xcom:tl:" + h.toLowerCase();
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }

    const url =
      this._base(ctx) +
      "/srv/timeline-profile/screen-name/" +
      encodeURIComponent(h) +
      "?showReplies=false";
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, false),
      timeout: 20000,
      http2: true,
    });
    if (!res.ok) throw new Error("X.com 时间线 HTTP " + res.status + " @ " + h);
    const html = await res.text();

    const json = this._extractNextData(html);
    if (!json) return [];
    const rawTweets = this._collectTweets(json);

    // 【关键:时间线载荷不含媒体】实测(2026-08)timeline-profile 返回的 tweet 对象
    // 被剥掉了全部媒体字段 —— 126KB 载荷里 video_info / mediaDetails / variants
    // 出现次数均为 0,entities.media 恒为 []。只有 text / 计数 / user 等元信息。
    // 所以不能在时间线上直接筛"带视频的",否则一条都留不下(列表全空)。
    //
    // 补齐办法:时间线给了 id_str,再逐条打 tweet-result(单条接口【带全套
    // mediaDetails + video_info.variants】,与 pektino/xhs18 兜底同一个接口)。
    // 该接口限流凶(连续请求即 429),故:
    //   · 每个 handle 每次只补前 HYDRATE_MAX 条(按时间倒序,先补最新的)
    //   · 单条结果长缓存(媒体不会变),下次直接命中,不再打接口
    //   · 一旦遇到 429/失败就停止本轮补齐(已补到的照常返回,不整体失败)
    const cand = [];
    const seenId = {};
    for (const rt of rawTweets) {
      const t = this._normalizeTweet(rt, h);
      if (!t || !t.id) continue;
      if (seenId[t.id]) continue;
      seenId[t.id] = true;
      cand.push(t);
    }
    cand.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    const out = [];
    let budget = this._HYDRATE_MAX;
    for (const t of cand) {
      // 时间线偶尔仍带媒体(不同版本/不同账号)—— 有就直接用,不花配额。
      if (t.video && t.video.url) {
        out.push(t);
        continue;
      }
      if (budget <= 0) continue;
      const hy = await this._hydrate(ctx, t.id);
      if (hy === null) break; // 限流/网络故障 → 停止本轮补齐
      budget--;
      if (hy && hy.url) {
        t.video = { url: hy.url, type: hy.type };
        if (!t.poster && hy.poster) t.poster = hy.poster;
        out.push(t);
      }
    }

    if (out.length) {
      try {
        await ctx.cache.set(CK, out, 300);
      } catch (e) {
        /* ignore */
      }
    }
    return out;
  },

  /** 从 HTML 抠 <script id="__NEXT_DATA__"> 的 JSON。 */
  _extractNextData(html) {
    if (!html || typeof html !== "string") return null;
    const m = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      return null;
    }
  },

  /**
   * 从 __NEXT_DATA__ 里收集 tweet 对象。首选官方结构
   * props.pageProps.timeline.entries[].content.tweet;拿不到就【递归扫描】
   * 整棵 JSON,把带 id_str 且含媒体特征的对象都当 tweet 收上来(抗结构漂移)。
   */
  _collectTweets(json) {
    const out = [];
    const entries =
      json &&
      json.props &&
      json.props.pageProps &&
      json.props.pageProps.timeline &&
      json.props.pageProps.timeline.entries;
    if (Array.isArray(entries)) {
      for (const e of entries) {
        const t = e && e.content && (e.content.tweet || e.content.tweetPreview);
        if (t) out.push(t);
      }
    }
    if (out.length) return out;

    // 兜底:递归找 tweet-like 对象。
    const acc = [];
    const seen = new Set();
    const looksTweet = (o) =>
      o &&
      typeof o === "object" &&
      (o.id_str || o.id) &&
      (o.mediaDetails ||
        o.video ||
        o.extended_entities ||
        o.entities ||
        o.full_text ||
        o.text);
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 8) return;
      if (looksTweet(node)) {
        const key = String(node.id_str || node.id);
        if (!seen.has(key)) {
          seen.add(key);
          acc.push(node);
        }
        // 不 return —— 引用推文等可能嵌套,继续下探
      }
      if (Array.isArray(node)) {
        for (const v of node) walk(v, depth + 1);
      } else {
        for (const k in node) walk(node[k], depth + 1);
      }
    };
    walk(json, 0);
    return acc;
  },

  /**
   * 原始 tweet 对象 → 归一化 { id, title, poster, author, desc, ts, video:{url,type} }。
   * 无视频返回 null 的 video 字段(上层据此过滤)。
   */
  _normalizeTweet(rt, handle) {
    if (!rt || typeof rt !== "object") return null;
    const id = String(rt.id_str || rt.id || "");
    if (!id || !/^\d+$/.test(id)) return null;
    const text = this._clean(rt.full_text || rt.text || "");
    const author =
      (rt.user && (rt.user.name || rt.user.screen_name)) ||
      (rt.core && rt.core.user_results && rt.core.user_results.result &&
        rt.core.user_results.result.legacy &&
        (rt.core.user_results.result.legacy.name ||
          rt.core.user_results.result.legacy.screen_name)) ||
      handle ||
      "";
    const ts = this._parseTs(rt.created_at || rt.createdAt);
    const video = this._pickVideo(rt);
    return {
      id,
      title: text ? text.split(/\n/)[0].slice(0, 40).trim() || id : id,
      poster: (video && video.poster) || this._anyPoster(rt) || "",
      author,
      desc: text,
      ts,
      video: video && video.url ? { url: video.url, type: video.type } : null,
    };
  },

  /** 归一化 tweet → ScriptVodItem,顺便缓存播放信息供 detail/resolve 命中。 */
  _toVod(t) {
    if (!t || !t.id || !t.video || !t.video.url) return null;
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[t.id] = {
      url: t.video.url,
      type: t.video.type,
      poster: t.poster,
      title: t.title,
      author: t.author,
      desc: t.desc,
    };
    return {
      id: t.id,
      title: t.title || t.id,
      poster: t.poster || undefined,
      type_name: t.author || undefined,
      desc: t.desc || undefined,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const info = (this._pendingCache && this._pendingCache[id]) || {};
    // 直链无 token 不过期 → 命中就直接给;miss 用 "id:<statusId>" 让 resolve 去 tweet-result 现取。
    const playUrl = info.url ? info.url : "id:" + id;
    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.author || undefined,
      playbacks: [
        {
          sourceId: sourceId || "xcom",
          sourceName: "X.com",
          episodes: [
            {
              playUrl,
              needResolve: true,
              title: "完整版",
              type: info.type === "hls" ? "hls" : "mp4",
            },
          ],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "").trim();

    // "id:<statusId>" → 缓存 miss,走 tweet-result 按 id 现取直链(react-tweet 同款,免登录)。
    if (url.indexOf("id:") === 0) {
      const info = this._pendingCache && this._pendingCache[url.slice(3)];
      if (info && info.url) {
        url = info.url;
      } else {
        const mp4 = await this._syndicationMp4(ctx, url.slice(3));
        if (!mp4) throw new Error("X.com: 无法解析播放地址 @ " + playUrl);
        url = mp4;
      }
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("X.com: 无效播放地址 @ " + playUrl);
    }

    const isHls = /\.m3u8(\?|$)/i.test(url);
    return {
      url,
      type: isHls ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        // video.twimg.com 拒绝非 twitter 的 Referer(带别的站 → 403),用 x.com。
        Referer: /\btwimg\.com/i.test(url) ? "https://x.com/" : "https://x.com/",
      },
    };
  },

  /**
   * X 公开 syndication 接口按 statusId 取该推文最高码率 mp4(resolve 兜底)。
   *   GET cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>&lang=en
   * token = ((id/1e15)*π).toString(36) 去掉全部 0 与小数点(react-tweet 同款)。
   * 删帖 / 无视频 / 受限帖返 404 或无 video 字段 → 返回空串。
   */
  async _syndicationMp4(ctx, statusId) {
    const id = String(statusId).replace(/[^0-9]/g, "");
    if (!id) return "";
    const url = ctx.utils.buildUrl(
      "https://cdn.syndication.twimg.com/tweet-result",
      { id, token: this._syndToken(id), lang: "en" }
    );
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 20000,
      http2: true,
    });
    if (!res.ok) return "";
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return "";
    }
    const v = this._pickVideo(data);
    return (v && v.url) || "";
  },

  /** react-tweet 的 token:((id/1e15)*π).toString(36),去掉全部 0 和小数点。 */
  _syndToken(id) {
    const n = Number(id) / 1e15;
    return (n * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, "");
  },

  /* ───────────────────────── 媒体解析 ───────────────────────── */

  /**
   * 从 tweet 对象抽一条视频直链 + 封面。扫描全部可能的 variants 挂点:
   *   mediaDetails[].video_info.variants / extended_entities.media[].video_info.variants /
   *   video.variants(tweet-result 精简结构)。挑 bitrate 最高的 mp4,无 mp4 退 m3u8。
   * 返回 { url, type:'mp4'|'hls', poster } 或 null。
   */
  _pickVideo(rt) {
    if (!rt || typeof rt !== "object") return null;
    const pools = [];
    let poster = "";

    const pushFromMedia = (arr) => {
      for (const m of arr || []) {
        if (!m) continue;
        if (m.media_url_https && !poster) poster = m.media_url_https;
        const vs = m.video_info && m.video_info.variants;
        if (Array.isArray(vs)) pools.push(vs);
      }
    };
    pushFromMedia(Array.isArray(rt.mediaDetails) ? rt.mediaDetails : []);
    pushFromMedia(
      rt.extended_entities && Array.isArray(rt.extended_entities.media)
        ? rt.extended_entities.media
        : []
    );
    if (rt.video && Array.isArray(rt.video.variants)) {
      pools.push(rt.video.variants);
      if (rt.video.poster && !poster) poster = rt.video.poster;
    }

    let bestMp4 = null;
    let bestRate = -1;
    let hls = "";
    for (const variants of pools) {
      for (const v of variants) {
        if (!v || !v.url) continue;
        const type = String(v.content_type || v.type || "");
        const isMp4 = /mp4/i.test(type) || /\.mp4(\?|$)/i.test(v.url);
        const isHls = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(v.url);
        if (isMp4) {
          const rate = Number(v.bitrate || v.bit_rate || 0) || 0;
          if (rate > bestRate) {
            bestRate = rate;
            bestMp4 = v.url;
          }
        } else if (isHls && !hls) {
          hls = v.url;
        }
      }
    }
    const url = bestMp4 || hls;
    if (!url) return null;
    return { url, type: bestMp4 ? "mp4" : "hls", poster };
  },

  /** 兜底封面:任意 media 的 media_url_https,或用户头像。 */
  _anyPoster(rt) {
    const md = Array.isArray(rt.mediaDetails) ? rt.mediaDetails : [];
    for (const m of md) if (m && m.media_url_https) return m.media_url_https;
    const ee =
      rt.extended_entities && Array.isArray(rt.extended_entities.media)
        ? rt.extended_entities.media
        : [];
    for (const m of ee) if (m && m.media_url_https) return m.media_url_https;
    return (rt.user && (rt.user.profile_image_url_https || "")) || "";
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /**
   * 从关键词/链接里解出账号名(handle)。
   *  - 完整链接 x.com/<handle>[/...] → 取用户名(排除 i/ home/ search/ explore 等保留路径)。
   *  - "@name" / "name" → 去 @ 取用户名部分(遇到 / ? 空白即止)。
   *  - 纯链接但无有效用户名(如 x.com/i/web/status/123)→ 返回 ""(别 crude-strip 成垃圾)。
   */
  _parseHandle(kw) {
    const s = String(kw || "").trim();
    if (!s) return "";
    // 完整链接: x.com/<handle>[/...]
    if (/(?:twitter|x)\.com\//i.test(s)) {
      const m = s.match(
        /(?:twitter|x)\.com\/(?!i\/|home\b|search\b|explore\b|hashtag\/|messages\b)(@?[A-Za-z0-9_]{1,15})/i
      );
      return m ? m[1].replace(/^@+/, "") : "";
    }
    // 裸账号名 / @账号名:取首个 handle 片段(用户名仅 [A-Za-z0-9_],≤15)。
    const bare = s.replace(/^@+/, "");
    const m2 = bare.match(/^([A-Za-z0-9_]{1,15})/);
    return m2 ? m2[1] : "";
  },

  /** created_at(Twitter 格式 "Wed Oct 10 20:19:24 +0000 2018")→ 毫秒时间戳。 */
  _parseTs(v) {
    if (!v) return 0;
    const t = Date.parse(v);
    return isFinite(t) ? t : 0;
  },

  /** 清正文:去 URL、去 #话题堆、去 t.co 短链残留,压空白。 */
  _clean(s) {
    if (!s || typeof s !== "string") return "";
    return s
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/#[^\s#]+/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },
};
