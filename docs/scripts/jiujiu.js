/**
 * 919185.xyz 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 919185.xyz 是中文竖屏短视频站(91porn / 自拍 / 主播),后端 WordPress + 自研
 *    "tikswipe" 主题。列表/分类/搜索全部走标准 WP REST v2(开放,匿名可读):
 *      列表:   GET /wp-json/wp/v2/posts?_embed=1&per_page=<n>&page=<p>[&categories=<id>][&search=<kw>]
 *      分类:   GET /wp-json/wp/v2/categories?per_page=50&orderby=count&order=desc
 *  - 【视频直链不在 post JSON 里】。主题把播放地址藏在 admin-ajax 的
 *    wpst_media_data_fetchmeta 里(见 player-init.js):
 *      POST /wp-admin/admin-ajax.php
 *        action=wpst_media_data_fetchmeta&nonce=<nonce>&post_id=<id>
 *      → { video_type:"video/mp4", video_url:"https://dsp.000355.xyz/.../<x>.mp4",
 *          video_poster_url, video_width, video_height }
 *    【必须带 nonce】(不带返回文本 "Busted!")。nonce 挂在首页内联的
 *    loadmore_ajax_var / wpst_ajax_var 里(全站同一个),故先抓一次首页缓存 nonce。
 *  - 直链在 dsp.000355.xyz(CDN,不校验 Referer/UA,匿名 Range 206 video/mp4)。
 *    直链是静态路径无 token,但仍每次现拉一遍(nonce 可能轮换 / 直链域名可能变),
 *    故 playUrl 存 "id:<postId>",resolvePlayUrl 时用 fetchmeta 现拿。
 *  - 分类里 "pics"(id 4145)是图集不是视频,跳过;"woman"(count 0)空分类,跳过。
 *  - 国内直连该 CDN 可能不稳,建议在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-20,经 127.0.0.1:7897 代理匿名):
 *  - LIST: GET /wp-json/wp/v2/posts?per_page=2&_embed=1 → 200,post JSON(封面在
 *          _embedded.wp:featuredmedia[0].source_url,部分挂 dsp.000355.xyz)。
 *  - CATS: 91porn(2100)/ pics(166)/ zipai(52)/ zhubo(6)。
 *  - RESOLVE: POST admin-ajax fetchmeta post_id=26568 (带 nonce) → video_url
 *             https://dsp.000355.xyz/2025/05/1747225758-20250514202853.mp4;
 *             不带 nonce → "Busted!"。
 *  - PLAY: GET Range .../*.mp4 → 206 video/mp4。
 */
return {
  meta: {
    name: "919185",
    author: "DouyTV",
    version: "0.1.0",
    description: "919185.xyz 中文竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://919185.xyz";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx, kind) {
    const h = {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: this._base(ctx) + "/",
    };
    if (kind === "json") {
      h.Accept = "application/json, text/plain, */*";
    } else if (kind === "ajax") {
      h.Accept = "application/json, text/javascript, */*; q=0.01";
      h["X-Requested-With"] = "XMLHttpRequest";
      h.Origin = this._base(ctx);
      h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    } else {
      h.Accept =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    }
    return h;
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, "json"),
      timeout: 20000,
    });
    if (res.status === 400) return { __empty: true, headers: res.headers };
    if (!res.ok) throw new Error("919185 HTTP " + res.status + " @ " + url);
    const data = await res.json();
    data.__headers = res.headers;
    return data;
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("919185 分类抓取失败:", String(e));
    }
    for (const c of cats) {
      if (!c.count) continue; // 空分类跳过
      if (/^pics?$/i.test(c.slug)) continue; // 图集,非视频
      sources.push({ id: "cat:" + c.id, name: c.name, group: "分类" });
    }
    return sources;
  },

  async _fetchCategories(ctx) {
    const CK = "919185:categories:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const raw = await this._getJson(ctx, "/wp-json/wp/v2/categories", {
      per_page: 50,
      orderby: "count",
      order: "desc",
    });
    const out = [];
    for (const c of Array.isArray(raw) ? raw : []) {
      if (!c || c.id == null) continue;
      out.push({
        id: String(c.id),
        name: this._decode((c.name || c.slug || "").toString()).trim(),
        slug: c.slug || "",
        count: c.count || 0,
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

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    if (id.indexOf("cat:") === 0) {
      return this._feed(ctx, p, { categories: id.slice("cat:".length) });
    }
    return this._feed(ctx, p, {});
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feed(ctx, p, { search: kw });
  },

  async _feed(ctx, page, extraQuery) {
    const query = { per_page: 20, page, _embed: 1 };
    for (const key in extraQuery) {
      if (extraQuery[key] != null && extraQuery[key] !== "") {
        query[key] = extraQuery[key];
      }
    }
    let data;
    try {
      data = await this._getJson(ctx, "/wp-json/wp/v2/posts", query);
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    if (data && data.__empty) return { list: [], page, pageCount: page, total: 0 };
    const arr = Array.isArray(data) ? data : [];
    const list = [];
    for (const post of arr) {
      const vod = this._toVod(post);
      if (vod) list.push(vod);
    }
    const headers = (data && data.__headers) || {};
    const totalPages =
      parseInt(headers["x-wp-totalpages"] || "0", 10) || 0;
    const hasMore = totalPages ? page < totalPages : list.length >= 20;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  _toVod(post) {
    if (!post || post.id == null) return null;
    const id = String(post.id);
    const title =
      this._decode((post.title && post.title.rendered) || "").trim() || id;
    const poster = this._featured(post);
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      title,
      poster,
      desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
    };
    return {
      id,
      title,
      poster: poster || undefined,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      // 直接 miss(如从收藏进入)→ 拉单条 post 补标题/封面。
      try {
        const post = await this._getJson(
          ctx,
          "/wp-json/wp/v2/posts/" + encodeURIComponent(id),
          { _embed: 1 }
        );
        info = {
          title:
            this._decode((post.title && post.title.rendered) || "").trim() ||
            String(id),
          poster: this._featured(post),
          desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
        };
      } catch (e) {
        info = { title: String(id) };
      }
    }
    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      playbacks: [
        {
          sourceId: sourceId || "jiujiu",
          sourceName: "919185",
          // playUrl 存 "id:<postId>";resolvePlayUrl 用 fetchmeta 现拉直链。
          episodes: [{ playUrl: "id:" + id, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    if (url.indexOf("id:") === 0) {
      const id = url.slice(3);
      const meta = await this._fetchMeta(ctx, id);
      if (!meta || !meta.video_url) {
        throw new Error("919185: 无法解析播放地址 @ " + playUrl);
      }
      url = meta.video_url;
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("919185: 无效播放地址 @ " + playUrl);
    }
    const isHls = /\.m3u8(\?|$)/i.test(url);
    return {
      url,
      type: isHls ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /**
   * 用 fetchmeta 拿单条 post 的视频直链。需要全站 nonce(首页内联,缓存复用)。
   * 若 nonce 过期(返回 "Busted!" / 非 JSON),清缓存重取一次再试。
   */
  async _fetchMeta(ctx, id, _retry) {
    const nonce = await this._nonce(ctx, _retry === true);
    if (!nonce) return null;
    const body =
      "action=wpst_media_data_fetchmeta&nonce=" +
      encodeURIComponent(nonce) +
      "&post_id=" +
      encodeURIComponent(String(id));
    let text = "";
    try {
      const res = await ctx.request.post(
        this._base(ctx) + "/wp-admin/admin-ajax.php",
        { headers: this._headers(ctx, "ajax"), body, timeout: 20000 }
      );
      if (!res.ok) return null;
      text = await res.text();
    } catch (e) {
      return null;
    }
    // nonce 失效 → "Busted!"(非 JSON)。清缓存重试一次。
    if (!text || text.indexOf("{") !== 0) {
      if (!_retry) return this._fetchMeta(ctx, id, true);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  },

  /** 抓首页内联的 loadmore_ajax_var / wpst_ajax_var 里的全站 nonce,缓存 1 天。 */
  async _nonce(ctx, force) {
    const CK = "919185:nonce:v1";
    if (!force) {
      try {
        const cached = await ctx.cache.get(CK);
        if (cached && typeof cached === "string") return cached;
      } catch (e) {
        /* ignore */
      }
    }
    let html = "";
    try {
      const res = await ctx.request.get(this._base(ctx) + "/", {
        headers: this._headers(ctx, "html"),
        timeout: 20000,
      });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      return null;
    }
    const m =
      html.match(/wpst_ajax_var\s*=\s*\{[^}]*"nonce"\s*:\s*"([a-f0-9]+)"/i) ||
      html.match(/loadmore_ajax_var\s*=\s*\{[^}]*"nonce"\s*:\s*"([a-f0-9]+)"/i) ||
      html.match(/"nonce"\s*:\s*"([a-f0-9]{8,})"/i);
    const nonce = m ? m[1] : "";
    if (nonce) {
      try {
        await ctx.cache.set(CK, nonce, 86400);
      } catch (e) {
        /* ignore */
      }
    }
    return nonce || null;
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _featured(post) {
    try {
      const media =
        post._embedded &&
        post._embedded["wp:featuredmedia"] &&
        post._embedded["wp:featuredmedia"][0];
      if (media && media.source_url) return media.source_url;
    } catch (e) {
      /* ignore */
    }
    if (post.jetpack_featured_media_url) return post.jetpack_featured_media_url;
    if (post.meta && post.meta.fifu_image_url) return post.meta.fifu_image_url;
    return "";
  },

  _stripHtml(s) {
    if (!s || typeof s !== "string") return "";
    return this._decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&hellip;/g, "…")
      .replace(/&nbsp;/g, " ")
      .trim();
  },
};
