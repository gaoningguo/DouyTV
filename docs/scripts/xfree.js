/**
 * xfree.com 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - xfree.com 是 Nuxt(Vue)竖屏短视频站。
 *  - 【关键 1】API 挂在 www.xfree.com/api/...,【不是】 api.xfree.com。
 *    api.xfree.com 无条件 302 跳回 www 首页(与 HTTP 版本无关,h1.1/h2 都跳),
 *    早期误判为「h1.1 被 302、须强制 h2」,实为打错了主机。走 www 后 h2 非必需,
 *    http2:true 保留无害(见 _getJson)。实测 www API 直接回 JSON,当前不触发 CF。
 *  - 【关键 2】API 若挂 Cloudflare 托管质询(managed challenge),触发时返回
 *    403 + cf-mitigated: challenge —— scriptFetch 会自动弹「人机验证」窗口
 *    (与本请求同 UA + 同代理),用户过一次质询、关窗后 cf_clearance 进 jar,
 *    之后所有 API / dyproxy 拉流请求自动带上,直到 cookie 过期再弹一次。
 *    脚本层【不用】写任何 CF 处理,只要每个请求带【固定的浏览器 UA】即可
 *    (cf_clearance 绑 UA,必须与验证窗口字节级一致 —— 用 _ua() 统一)。
 *  - 【关键 3】直连(不走代理)访问 www/cdn 会被墙,请在「设置 → 代理」配好代理;
 *    scriptFetch、CF 验证窗口、dyproxy 拉流都会走同一个代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 逆向 + 实测):
 *  - 列表: GET www.xfree.com/api/rs/homepage?limit=<n>
 *          → { ok:true, body:{ posts:[...], recommId? } }
 *          翻页用 GET /api/rs/next/?type=post&recommId=<上一页 recommId>
 *  - 搜索: GET /api/2/search/combo?limit=<n>&search=<kw> → { ok, body:{ posts, ... } }
 *  - 详情: GET /api/post/<id> → { ok, body:{ post } } 或 { ok, body:{...post} }
 *  - post: { id, title, user:{username,name}, media:{ name(uuid), mimeType, width,
 *            height, status, duration, sound, listingSuffix? } }
 *  - 视频直链(逆向 $getCDNurl):
 *      https://cdn.xfree.com/xfree-prod/<n0>/<n1>/<n2>/<name>/converted.mp4
 *      (n0/n1/n2 = uuid 前三个字符)。mp4 直链,走 dyproxy 播放(CF cookie 自动透传)。
 *  - 缩略图: https://thumbs.xfree.com/listing/medium_retina/<name>_<suffix>.jpg
 *
 * ⚠️ 未在命令行闭环验证的一环:正片 converted.mp4 能否直拉(CF 锁住命令行,
 *    拿不到真实正片 media name)。首次在 app 内过 CF 后,若播放 404,多半是
 *    CDN 文件名不是 converted.mp4 —— 备选见 _videoUrl() 的 fallback 注释。
 */
return {
  meta: {
    name: "xfree",
    author: "DouyTV",
    version: "0.1.0",
    description: "xfree.com 竖屏短视频(成人内容,需代理 + 首次过 CF 人机验证)",
  },

  /* ── 基址(可 config 覆盖,万一换域名)── */
  _apiBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("apiBase");
    // API 挂在 www.xfree.com/api/... —— 不是 api.xfree.com。后者【无条件】302
    // 跳回 www 首页(与 HTTP 版本无关,h1.1/h2 都跳),实测走 www 直接回 JSON。
    return (typeof b === "string" && b) || "https://www.xfree.com";
  },
  _cdnBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("cdnBase");
    return (typeof b === "string" && b) || "https://cdn.xfree.com/xfree-prod/";
  },
  _thumbBase(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("thumbBase");
    return (typeof b === "string" && b) || "https://thumbs.xfree.com/";
  },

  /**
   * 固定浏览器 UA —— cf_clearance 绑 UA,必须与 CF 验证窗口一致。
   * scriptFetch 从 headers["User-Agent"] 取这个 UA 传给验证窗口,所以【每个
   * 请求都要带同一个】。可用 config.ua 覆盖(换机后与浏览器实际 UA 对齐)。
   */
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
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.xfree.com",
      Referer: "https://www.xfree.com/",
      // API 校验这几个头(实测缺失也能过,带上与浏览器一致更稳)。
      apiversion: "1.0",
      "app-version": "xf1.41.8",
      country: "JP",
      language: "en-US",
    };
  },

  /**
   * 统一 GET JSON。带 http2:true(经代理走 Rust reqwest h2;www API 实测 h1.1
   * 也能通,保留 h2 更贴近浏览器)。碰到 CF 质询时 scriptFetch 自动弹窗 + 重试,
   * 这里拿到的已是过质询后的响应。响应壳统一 { statusCode:2, body:{...} }。
   */
  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._apiBase(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      http2: true,
      timeout: 25000,
    });
    if (!res.ok) {
      throw new Error("xfree HTTP " + res.status + " @ " + url);
    }
    return res.json();
  },

  /** 从 API 响应里挖出 posts 数组(容忍多种包裹形态)。 */
  _extractPosts(data) {
    if (!data) return [];
    const body = data.body || data.data || data;
    if (!body) return [];
    if (Array.isArray(body.posts)) return body.posts;
    if (Array.isArray(body.items)) return body.items;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body)) return body;
    return [];
  },

  /** 从响应里挖 recommId(Recombee 推荐引擎翻页游标),多种字段名兜底。 */
  _extractRecommId(data) {
    if (!data) return null;
    const body = data.body || data.data || data;
    return (
      (body && (body.recommId || body.recommendationId || body.nextCursor)) ||
      data.recommId ||
      null
    );
  },

  /**
   * 静态英文分类兜底 —— 取自实测 /api/tag/tophits 响应里的高频英文标签。
   * 【为什么要静态】tophits 挂在 www(CF 后),首次进 app 还没 cf_clearance 时
   * 拉它必 403;若 getSources 纯靠网络,分类列表就会永远只剩「推荐」。先无条件
   * 铺静态分类,用户点任意分类 → 触发 /api/rs/tag 拉流 → 撞 CF 弹窗 → 过验后正常。
   * /api/rs/tag 用【小写英文标签】,故这里只列英文(中文标签无 tagEn 拉流会 400)。
   */
  _staticTags() {
    return [
      "Anal", "Fucking", "Blowjob", "Solo", "Cumshot", "Facial", "Squirt",
      "Threesome", "Deepthroat", "Gangbang", "Handjob", "Fingering", "Rough",
      "Doggystyle", "Cowgirl", "RidingDildo", "RidingDick", "TittyFuck",
      "Amateurs", "Beautiful", "Brunette", "Blonde", "Redhead", "BigAss",
      "BigCock", "SmallTits", "BigNaturalTits", "Pussy", "Ass", "Asshole",
      "Hairy", "Shaved", "Tattoo", "Glasses", "Petite", "Mature", "BBW",
      "Ebony", "Latina", "Asian", "Japanese", "Indian", "Arab", "Interracial",
      "Onlyfans", "Cosplay", "PublicFlashing", "FlashingTits", "Ahegao",
      "Lingerie", "Stockings", "Oiled", "Pissing", "AnalCreampie", "Swallow",
    ];
  },

  async getSources(ctx) {
    // 首页推荐 + 热门分类。分类流走 /api/rs/tag?tag=<小写英文标签>(逆向 store 得)。
    // 先铺【静态英文分类】(见 _staticTags:CF 未过时也有分类可点),再尝试用
    // tophits 网络结果【补充】静态里没有的英文标签(拿不到就静默,不阻断)。
    const sources = [{ id: "homepage", name: "推荐", group: "浏览" }];
    const seen = {};
    for (const tag of this._staticTags()) {
      const key = tag.toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      sources.push({ id: "tag:" + tag, name: tag, group: "分类" });
    }
    try {
      const data = await this._getJson(ctx, "/api/tag/tophits", {
        minUsage: 90,
        lgbt: 1,
      });
      const body = (data && data.body) || [];
      const arr = Array.isArray(body) ? body : [];
      for (const it of arr) {
        const td = it && it.tagDetail;
        const tag = td && td.tag;
        // 只要纯 ASCII 英文标签(/api/rs/tag 用英文小写)。跳过中文 / 空 / 已有。
        if (!tag || /[^\x00-\x7F]/.test(tag)) continue;
        const key = tag.toLowerCase();
        if (seen[key]) continue;
        seen[key] = 1;
        sources.push({ id: "tag:" + tag, name: tag, group: "分类" });
      }
    } catch (e) {
      /* tophits 拿不到(如 CF 未过)就用静态兜底,不阻断 */
    }
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const sk = sourceId || "homepage";

    let data;
    if (p <= 1) {
      if (sk.indexOf("tag:") === 0) {
        // 分类流:/api/rs/tag?tag=<小写英文标签>&lgbt&device&limit。
        data = await this._getJson(ctx, "/api/rs/tag", {
          tag: sk.slice(4).toLowerCase(),
          lgbt: 1,
          device: "desktop",
          limit: 30,
        });
      } else {
        data = await this._getJson(ctx, "/api/rs/homepage", {
          lgbt: 1,
          device: "desktop",
          limit: 30,
        });
      }
    } else {
      // 翻页:读上一页缓存的 recommId,走 /api/rs/next。
      let recommId;
      try {
        recommId = await ctx.cache.get("recommId:" + sk + ":" + p);
      } catch (e) {
        /* ignore */
      }
      if (!recommId) {
        // 无游标(缓存过期 / 非顺序翻页)—— 无法定位该页。
        return { list: [], page: p, pageCount: p, total: 0 };
      }
      data = await this._getJson(ctx, "/api/rs/next/", {
        type: "post",
        recommId,
        limit: 30,
      });
    }

    const posts = this._extractPosts(data);
    const list = this._postsToVods(ctx, posts);

    // 缓存下一页 recommId(顺序翻页依赖它)。
    const next = this._extractRecommId(data);
    if (next) {
      try {
        await ctx.cache.set("recommId:" + sk + ":" + (p + 1), next, 1800);
      } catch (e) {
        /* ignore */
      }
    }

    const hasMore = !!next && list.length > 0;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    // 真实端点(实测):GET /api/2/search?search=<kw>&lgbt=1&limit=<n>&ns=1
    // → { body:{ posts, users, playlists, tags } }。注意【无 recommId】,
    // 故无标准翻页 —— 只第一页有结果,page>=2 返空(与 API 行为一致)。
    let data;
    if (p <= 1) {
      data = await this._getJson(ctx, "/api/2/search", {
        search: keyword,
        lgbt: 1,
        limit: 50,
        ns: 1,
      });
    } else {
      let recommId;
      try {
        recommId = await ctx.cache.get("recommId:q:" + keyword + ":" + p);
      } catch (e) {
        /* ignore */
      }
      if (!recommId) return { list: [], page: p, pageCount: p, total: 0 };
      data = await this._getJson(ctx, "/api/rs/next/", {
        type: "post",
        recommId,
        limit: 30,
      });
    }

    const posts = this._extractPosts(data);
    const list = this._postsToVods(ctx, posts);
    const next = this._extractRecommId(data);
    if (next) {
      try {
        await ctx.cache.set("recommId:q:" + keyword + ":" + (p + 1), next, 1800);
      } catch (e) {
        /* ignore */
      }
    }
    const hasMore = !!next && list.length > 0;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  async detail(ctx, { id, sourceId }) {
    // 先查缓存(recommend / search 已解析过 media),miss 才请求 /api/post。
    let info;
    try {
      info = await ctx.cache.get("post:" + id);
    } catch (e) {
      /* ignore */
    }
    if (!info && this._pendingCache && this._pendingCache[id]) {
      info = this._pendingCache[id];
      try {
        await ctx.cache.set("post:" + id, info, 7200);
      } catch (e) {
        /* ignore */
      }
    }

    if (!info) {
      const data = await this._getJson(ctx, "/api/post/" + encodeURIComponent(id));
      const body = (data && (data.body || data.data)) || {};
      const post = body.post || body || {};
      info = this._postInfo(ctx, post);
      if (!info || !info.videoUrl) {
        throw new Error("xfree: 未找到可播视频(可能是图片帖 / 已删)@ " + id);
      }
      try {
        await ctx.cache.set("post:" + id, info, 7200);
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
      type_name: undefined,
      playbacks: [
        {
          sourceId: sourceId || "homepage",
          sourceName: "xfree",
          // playUrl 直接放 converted.mp4;resolvePlayUrl 只补 type/UA,不再发请求。
          episodes: [{ playUrl: info.videoUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 cdn.xfree.com 的 mp4 直链。CDN 在 CF 后,dyproxy 会自动透传
    // jar 里的 CF cookie(见 Rust proxy_fetch)。UA/Referer 设成浏览器一致。
    return {
      url: playUrl,
      type: "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: "https://www.xfree.com/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _postsToVods(ctx, posts) {
    const out = [];
    if (!Array.isArray(posts)) return out;
    for (const post of posts) {
      const info = this._postInfo(ctx, post);
      if (!info || !info.videoUrl) continue; // 只要视频帖
      const id = info.id;
      if (!id) continue;

      // 同步内存缓存 + 持久缓存,供 detail 命中(免二次请求)。
      this._pendingCache = this._pendingCache || {};
      this._pendingCache[id] = info;
      try {
        ctx.cache.set("post:" + id, info, 7200);
      } catch (e) {
        /* ignore */
      }

      out.push({
        id: String(id),
        title: info.title,
        poster: info.poster,
        desc: info.author,
        vod_remarks: info.durationText || undefined,
      });
    }
    return out;
  },

  /**
   * post → 归一化 info { id, title, author, desc, poster, videoUrl, durationText }。
   * 只接受 media.mimeType 以 "video/" 开头的帖;否则返 null。
   */
  _postInfo(ctx, post) {
    if (!post) return null;
    const media = post.media || (post.medias && post.medias[0]) || null;
    if (!media || !media.name) return null;
    const mime = String(media.mimeType || "");
    if (mime && mime.indexOf("video/") !== 0) return null; // 图片帖跳过

    const name = String(media.name);
    const user = post.user || {};
    const author = (user.name || user.username || "").toString().trim();
    const rawTitle = (post.title || post.text || "").toString();
    const title = this._cleanTitle(rawTitle) || author || name;

    return {
      id: post.id,
      title,
      author,
      desc: rawTitle.trim(),
      poster: this._thumbUrl(ctx, media),
      videoUrl: this._videoUrl(ctx, name),
      durationText: this._fmtDuration(media.duration),
    };
  },

  /**
   * 逆向 $getCDNurl 的视频 case:cdnBase + n0/n1/n2/name/<file>。
   * ⚠️【已实测校准 2026-07-12】正片文件名是 **full.mp4**,不是 converted.mp4
   *    (后者只用于首页 banner,CDN 上一律 404)。站点 JS 里真实 case:
   *      videopreview   → full.mp4    ← 正片全片(本源用这个)
   *      videopreview-d → full-d.mp4  ← 另一版本(降级/无声?)
   *      videolisting   → listing7.mp4 ← 列表预览小片(带 ?<listingSuffix>)
   *    实测两个真实 media:full.mp4 返 200 video/mp4(16~20MB),converted.mp4 全 404。
   *    若某帖 full.mp4 也 404,备选 full-d.mp4。
   */
  _videoUrl(ctx, name) {
    if (!name || name.length < 3) return "";
    const base = this._cdnBase(ctx);
    return (
      base + name[0] + "/" + name[1] + "/" + name[2] + "/" + name + "/full.mp4"
    );
  },

  /**
   * 列表缩略图。逆向自站点实际 HTML + CLI 探测(2026-07-12 实测 200 image/webp):
   *   thumbs.xfree.com/listing/medium_retina/<name>_<suffix>.webp
   * 扩展名是 .webp(不是 .jpg —— 站点 wall 项就用 webp)。
   * suffix 取 media.listingSuffix,缺省 0(getCDNurl 默认 e.listingSuffix||0)。
   */
  _thumbUrl(ctx, media) {
    const name = media && media.name;
    if (!name) return undefined;
    const suffix = media.listingSuffix != null ? media.listingSuffix : 0;
    return this._thumbBase(ctx) + "listing/medium_retina/" + name + "_" + suffix + ".webp";
  },

  _cleanTitle(text) {
    if (!text || typeof text !== "string") return "";
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const cleaned = line
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/#[^\s#]+/g, " ")
        .replace(/@[^\s@]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned && cleaned.length >= 2) {
        return cleaned.length > 80 ? cleaned.slice(0, 80).trim() + "…" : cleaned;
      }
    }
    return "";
  },

  /** 时长(毫秒或秒)→ m:ss。API 里 duration 单位实测是【毫秒】(8280 = 8.28s)。 */
  _fmtDuration(d) {
    let sec = Number(d);
    if (!sec || sec <= 0) return "";
    if (sec > 3600) sec = Math.round(sec / 1000); // >1h 视为毫秒,换算成秒
    sec = Math.round(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  },
};
