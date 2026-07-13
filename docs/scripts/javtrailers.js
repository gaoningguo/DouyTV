/**
 * JavTrailers Shorts 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - JavTrailers Shorts (javtrailers.com/shorts) 是 JAV 预告/片段的竖屏短视频流
 *    (TikTok 风格),Nuxt 3 SSR + Cloudflare,内容全是日本 AV 片段。
 *  - 站点有干净的内部 JSON API(同域 /api/shorts),不用抠 DOM。API 需要一个
 *    固定的 Authorization token(写死在前端 runtime config 的 public.AUTH_TOKEN 里,
 *    对所有匿名访客一样),否则 Cloudflare/后端拒绝。这里内置该 token,可用
 *    config.authToken 覆盖(万一站点轮换)。
 *  - 视频直链 = ${apiStream}/${bid}/playlist.m3u8 —— apiStream 是 BunnyCDN
 *    (vz-c20a9510-a5e.b-cdn.net),竖屏 HLS,实测匿名 200
 *    application/vnd.apple.mpegurl,CORS 全开,不校验 Referer/UA。
 *    (注意:sort=trailer 那档的 playUrl 是外部 DMM 预告 csuid,不是 BunnyCDN 的
 *    playlist,这里只用 for-you / new 两档,保证都是可匿名播放的 BunnyCDN HLS。)
 *  - 国内直连被墙 + Cloudflare 质询,请在「设置 → 代理」配代理;CF 质询由 App
 *    的 open_cf_challenge 在 _ua 一致时自动过。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 列表: GET /api/shorts?page=<n>&sort=<for-you|new>&excludemodels=
 *          Header: Authorization: <AUTH_TOKEN>, userCountry: none
 *          → { success, message, shorts: [ { bid, cryptoId, creator:{username},
 *              videoContentId, thumbnail, duration, startTime, slug, tags } ] }
 *          page 从 1 起,顺序翻页;返回空 shorts 即到底。
 *  - 站点没有 shorts 专用搜索端点,所以这里搜索 = 拉 fed 前若干页本地按
 *    标题/番号(videoContentId)/作者过滤。
 *  - 播放实测: HEAD https://vz-c20a9510-a5e.b-cdn.net/<bid>/playlist.m3u8
 *              → 200 application/vnd.apple.mpegurl(BunnyCDN,CORS 全开)
 */
return {
  meta: {
    name: "JavTrailers Shorts",
    author: "DouyTV",
    version: "0.1.0",
    description: "JavTrailers 竖屏 JAV 片段(成人内容,需代理 + 年龄确认)",
  },

  /** 站点/API 基址,可用脚本 config.base 覆盖。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://javtrailers.com";
  },

  /** BunnyCDN 流基址,可用脚本 config.stream 覆盖(万一换 pull zone)。 */
  _stream(ctx) {
    const s = ctx.config && ctx.config.get && ctx.config.get("stream");
    return (typeof s === "string" && s) || "https://vz-c20a9510-a5e.b-cdn.net";
  },

  /** 前端 runtime config 里写死的匿名 Authorization token,可用 config.authToken 覆盖。 */
  _authToken(ctx) {
    const t = ctx.config && ctx.config.get && ctx.config.get("authToken");
    if (typeof t === "string" && t) return t;
    return "AELAbPQCh_fifd93wMvf_kxMD_fqkUAVf@BVgb2!md@TNW8bUEopFExyGCoKRcZX";
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
      Referer: this._base(ctx) + "/shorts",
      Authorization: this._authToken(ctx),
      userCountry: "none",
    };
  },

  async _getShorts(ctx, page, sort) {
    const url = ctx.utils.buildUrl(this._base(ctx) + "/api/shorts", {
      page,
      sort,
      excludemodels: "",
    });
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
      // Nuxt + Cloudflare 站:ureq(HTTP/1.1)的 TLS 指纹会被 CF 质询,
      // 走 reqwest h2 客户端(浏览器式 ALPN)才稳(与 xfree 同款处理)。
      http2: true,
    });
    if (!res.ok) throw new Error("JavTrailers HTTP " + res.status + " @ " + url);
    const data = res.json ? await res.json() : null;
    return (data && Array.isArray(data.shorts) && data.shorts) || [];
  },

  async getSources(ctx) {
    // shorts 只有 for-you / new 两档可匿名播放(trailer 档是外部 DMM 预告,跳过)。
    return [
      { id: "for-you", name: "推荐", group: "浏览" },
      { id: "new", name: "最新", group: "浏览" },
    ];
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const sort = sourceId === "new" ? "new" : "for-you";
    let shorts;
    try {
      shorts = await this._getShorts(ctx, p, sort);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("JavTrailers 列表失败:", String(e));
      return { list: [], page: p, pageCount: p, total: 0 };
    }
    const list = [];
    for (const it of shorts) {
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }
    const hasMore = shorts.length > 0;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  /**
   * 站点 shorts 无专用搜索端点。拉 for-you 前若干页,按标题/番号/作者本地过滤。
   * 每个 App 分页对应站点 3 页,提高命中率。
   */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };

    const PAGES = 3;
    const list = [];
    let hasMore = false;
    for (let i = 0; i < PAGES; i++) {
      const sitePage = (p - 1) * PAGES + i + 1;
      let shorts;
      try {
        shorts = await this._getShorts(ctx, sitePage, "for-you");
      } catch (e) {
        break;
      }
      if (shorts.length > 0) hasMore = true;
      else break;
      for (const it of shorts) {
        if (this._matchKeyword(it, kw)) {
          const vod = this._toVod(ctx, it);
          if (vod) list.push(vod);
        }
      }
    }
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  _matchKeyword(it, kw) {
    const creator = (it.creator && it.creator.username) || "";
    const tags = Array.isArray(it.tags) ? it.tags.join(" ") : "";
    const hay = (
      (it.videoContentId || "") +
      " " +
      creator +
      " " +
      tags +
      " " +
      (it.slug || "")
    ).toLowerCase();
    return hay.indexOf(kw) >= 0;
  },

  /**
   * short → ScriptVodItem。id 用 bid(播放直链和详情都靠它)。
   * 番号(videoContentId)当标题主体,作者/时长塞 remarks。
   */
  _toVod(ctx, it) {
    if (!it || !it.bid) return null;
    const bid = String(it.bid);
    const code = (it.videoContentId || "").toUpperCase();
    const creator = (it.creator && it.creator.username) || "";
    const title = code || creator || bid;
    const poster = this._poster(ctx, bid);

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[bid] = {
      bid,
      title,
      poster,
      creator,
      code,
      duration: it.duration || "",
    };

    return {
      id: bid,
      title,
      poster: poster || undefined,
      poster_headers: this._posterHeaders(ctx),
      type_name: creator || undefined,
      vod_remarks: this._remarks(it),
    };
  },

  /**
   * 封面:API 里的 thumbnail 指向 cloudflarestream,实测 404(死链)。
   * 真正能出图的是视频所在的 BunnyCDN pull zone:{apiStream}/{bid}/thumbnail.jpg
   * (与 playlist.m3u8 同源,实测 200 image/jpeg;和播放一样需要 Referer)。
   */
  _poster(ctx, bid) {
    if (!bid) return "";
    return this._stream(ctx) + "/" + bid + "/thumbnail.jpg";
  },

  /**
   * 封面请求头:BunnyCDN 缩略图不带 Referer 会 403(和播放同款防盗链)。
   * 脚本把这组 header 通过 poster_headers 交给 App,App 的 PosterImage 会用
   * wrapWithProxy 走 dyproxy 代理带上它们(并透传激活代理),封面才出得来。
   */
  _posterHeaders(ctx) {
    return {
      "User-Agent": this._ua(ctx),
      Referer: this._base(ctx) + "/shorts",
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      // 内存 miss:重扫 for-you 前几页找这个 bid(站点无单条 shorts 端点)。
      for (let pg = 1; pg <= 5 && !info; pg++) {
        let shorts;
        try {
          shorts = await this._getShorts(ctx, pg, "for-you");
        } catch (e) {
          break;
        }
        if (!shorts.length) break;
        for (const it of shorts) {
          if (String(it.bid) === String(id)) {
            const creator = (it.creator && it.creator.username) || "";
            info = {
              bid: String(it.bid),
              title: (it.videoContentId || "").toUpperCase() || creator || id,
              poster: it.thumbnail || "",
              creator,
              code: (it.videoContentId || "").toUpperCase(),
              duration: it.duration || "",
            };
            break;
          }
        }
      }
    }
    if (!info) {
      // 兜底:bid 本身就够拼播放链,直接用它构造最小详情。
      info = { bid: String(id), title: String(id), poster: "", creator: "", code: "", duration: "" };
    }

    const playUrl = this._stream(ctx) + "/" + info.bid + "/playlist.m3u8";
    return {
      id,
      title: info.title,
      // API 的 cloudflarestream 缩略图已 404,统一用 BunnyCDN 的 thumbnail.jpg。
      poster: this._poster(ctx, info.bid) || info.poster || undefined,
      poster_headers: this._posterHeaders(ctx),
      year: "",
      desc: info.creator ? "@" + info.creator : "",
      type_name: info.creator || undefined,
      playbacks: [
        {
          sourceId: sourceId || "javtrailers",
          sourceName: "JavTrailers",
          episodes: [{ playUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 BunnyCDN HLS master。CORS 全开、不校验 Referer/UA。
    return {
      url: playUrl,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/shorts",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _remarks(it) {
    const bits = [];
    const dur = (it.duration || "").replace(/^00:/, ""); // "00:00:55" → "00:55"
    if (dur && /\d/.test(dur)) bits.push(dur);
    const creator = (it.creator && it.creator.username) || "";
    if (creator) bits.push("@" + creator);
    return bits.length ? bits.join(" · ") : undefined;
  },
};
