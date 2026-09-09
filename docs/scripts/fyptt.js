/**
 * FYPTT (fyptt.to) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - fyptt.to 是 "NSFW TikTok" 竖屏短视频聚合站,后端是标准 WordPress，
 *    对外暴露干净的 WP REST API (/wp-json/wp/v2/*)，不用抠 DOM 列表。
 *  - 每篇 post 的正文里嵌一个 <iframe src=".../fypttstr.php?fileid=XXX&mainurl=...">，
 *    请求该 fypttstr.php 会【返回纯文本的真实 mp4 直链】(stream.fyptt.to/<fileid>.mp4?token=…&expires=…)。
 *    token 有时效,所以真实直链在 resolvePlayUrl 时【实时】拉取,不在 detail 里固化。
 *  - 直链是 stream.fyptt.to 竖屏 mp4，CDN 不校验 Referer/UA，实测匿名 206 可拉。
 *    国内直连可能被墙 → 在「设置 → 代理」配好代理,scriptFetch 与播放代理会自动走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测):
 *  - 列表: GET /wp-json/wp/v2/posts?per_page=30&page=N&_embed=wp:featuredmedia[&categories=<id>]
 *          → [{ id, title.rendered, content.rendered(含iframe), _embedded.wp:featuredmedia[0].source_url }]
 *          翻页看响应头 X-WP-TotalPages。
 *  - 搜索: 同上 + &search=<kw>
 *  - 分类: GET /wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc → [{ id, name, slug, count }]
 *  - 详情: GET /wp-json/wp/v2/posts/<id>?_embed
 *  - 播放: content.rendered 里 iframe 的 fileid+mainurl → GET /fypttstr.php?fileid=..&mainurl=..
 *          → body 即真实 mp4 直链
 */
return {
  meta: {
    name: "FYPTT",
    author: "DouyTV",
    version: "0.1.0",
    description: "FYPTT / NSFW TikTok 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** 站点基址,可用脚本 config.base 覆盖(万一换域名)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://fyptt.to";
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

  async getSources(ctx) {
    // 浏览入口 + 真实 WP 分类(按内容量降序)。
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("FYPTT 分类抓取失败:", String(e));
    }
    for (const c of cats) {
      if (!c.count) continue; // 跳过空分类
      sources.push({
        id: "cat:" + c.id,
        name: this._zhName(c.name),
        group: "分类",
      });
    }
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    const query = {};
    if (id.indexOf("cat:") === 0) {
      query.categories = id.slice("cat:".length);
    }
    return this._feed(ctx, p, query);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    return this._feed(ctx, p, { search: keyword });
  },

  /**
   * 通用列表拉取 —— WP REST /posts。page 顺序翻页(WP 原生支持 ?page=N)。
   * 用响应头 X-WP-TotalPages 判断是否还有下一页。
   */
  async _feed(ctx, page, extraQuery) {
    const query = { per_page: 30, page, _embed: "wp:featuredmedia" };
    for (const key in extraQuery) {
      if (extraQuery[key] != null && extraQuery[key] !== "") {
        query[key] = extraQuery[key];
      }
    }
    const url = ctx.utils.buildUrl(this._base(ctx) + "/wp-json/wp/v2/posts", query);
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 20000,
      // fyptt 走 Cloudflare —— ureq(HTTP/1.1 + rustls 默认指纹)会被 bot 检测层
      // 403/连接重置。走 reqwest(http2)栈更接近浏览器,实测在浏览器指纹下正常。
      http2: true,
    });
    // WP 越界翻页返回 400 rest_post_invalid_page_number —— 视作没有更多。
    if (res.status === 400) return { list: [], page, pageCount: page, total: 0 };
    if (!res.ok) throw new Error("FYPTT HTTP " + res.status + " @ " + url);

    const posts = await res.json();
    const arr = Array.isArray(posts) ? posts : [];
    const list = [];
    for (const post of arr) {
      const vod = this._toVod(post);
      if (vod) list.push(vod);
    }

    const totalPages = parseInt(res.headers["x-wp-totalpages"] || "0", 10) || 0;
    const hasMore = totalPages ? page < totalPages : list.length >= 30;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * WP post → ScriptVodItem。从正文抠 iframe 的 fileid/mainurl,存内存缓存供 detail 免二请。
   * 无法从正文找到 fypttstr 播放源的 post 直接丢弃。
   */
  _toVod(post) {
    if (!post || post.id == null) return null;
    const id = String(post.id);
    const html = (post.content && post.content.rendered) || "";
    const play = this._extractPlaySrc(html);
    if (!play) return null;

    const title = this._decodeEntities(
      (post.title && post.title.rendered) || ""
    ).trim() || id;
    const poster = this._featuredImage(post);

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = { play, title, poster };

    return {
      id,
      title,
      poster,
      desc: "",
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      const url =
        this._base(ctx) +
        "/wp-json/wp/v2/posts/" +
        encodeURIComponent(id) +
        "?_embed=wp:featuredmedia";
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, true),
        timeout: 20000,
        http2: true,
      });
      if (!res.ok) throw new Error("FYPTT detail HTTP " + res.status + " @ " + url);
      const post = await res.json();
      const html = (post.content && post.content.rendered) || "";
      const play = this._extractPlaySrc(html);
      if (!play) throw new Error("FYPTT: 该视频未找到可播放源 @ " + id);
      info = {
        play,
        title:
          this._decodeEntities((post.title && post.title.rendered) || "").trim() ||
          id,
        poster: this._featuredImage(post),
      };
    }

    return {
      id,
      title: info.title,
      poster: info.poster,
      year: "",
      desc: "",
      playbacks: [
        {
          sourceId: sourceId || "fyptt",
          sourceName: "FYPTT",
          // playUrl = fypttstr.php URL;真实 mp4 直链(带时效 token)在 resolvePlayUrl 实时拉。
          episodes: [{ playUrl: info.play, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 是 fypttstr.php 的完整 URL。请求它 → body 就是真实 mp4 直链(纯文本)。
    let mp4 = playUrl;
    if (/fypttstr\.php/i.test(playUrl)) {
      const res = await ctx.request.get(playUrl, {
        headers: this._headers(ctx),
        timeout: 20000,
        http2: true,
      });
      if (!res.ok) {
        throw new Error("FYPTT: 取播放直链失败 HTTP " + res.status);
      }
      const body = (await res.text()).trim();
      const m = body.match(/https?:\/\/\S+?\.mp4[^\s"'<>]*/i);
      if (!m) throw new Error("FYPTT: fypttstr 未返回 mp4 直链");
      mp4 = m[0];
    }
    return {
      url: mp4,
      type: "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 从 post 正文 HTML 抠出 fypttstr.php 播放 URL(优先 data-src-no-ap,退 src)。 */
  _extractPlaySrc(html) {
    if (!html || typeof html !== "string") return "";
    // 优先 ld+json 的 embedURL(最干净),退到 iframe 的 data-src-no-ap / src。
    let m = html.match(/"embedURL"\s*:\s*"([^"]*fypttstr\.php[^"]*)"/i);
    if (m) return this._decodeEntities(m[1].replace(/\\\//g, "/"));
    m = html.match(/data-src-no-ap="([^"]*fypttstr\.php[^"]*)"/i);
    if (m) return this._decodeEntities(m[1]);
    m = html.match(/src="([^"]*fypttstr\.php[^"]*)"/i);
    if (m) return this._decodeEntities(m[1]);
    return "";
  },

  /** 取 WP 特色图(_embed 展开后的 source_url;优先 medium/full)。 */
  _featuredImage(post) {
    const emb = post && post._embedded && post._embedded["wp:featuredmedia"];
    const fm = emb && emb[0];
    if (!fm) return undefined;
    const sizes = fm.media_details && fm.media_details.sizes;
    if (sizes) {
      if (sizes.medium && sizes.medium.source_url) return sizes.medium.source_url;
      if (sizes.full && sizes.full.source_url) return sizes.full.source_url;
    }
    return fm.source_url || undefined;
  },

  /** 抓 WP 分类,按内容量降序。缓存一天。 */
  async _fetchCategories(ctx) {
    const CK = "fyptt:categories:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const url =
      this._base(ctx) +
      "/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc";
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 20000,
      http2: true,
    });
    if (!res.ok) throw new Error("FYPTT categories HTTP " + res.status);
    const raw = await res.json();
    const out = [];
    for (const c of Array.isArray(raw) ? raw : []) {
      if (!c || c.id == null) continue;
      out.push({
        id: String(c.id),
        name: this._decodeEntities((c.name || "").toString()).trim(),
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

  /** 常见 fyptt 分类英文名 → 中文(命不中原样返回)。 */
  _zhName(name) {
    const map = {
      Nudes: "裸露",
      Boobs: "美胸",
      NSFW: "NSFW",
      Thots: "网红",
      Sexy: "性感",
      Ass: "翘臀",
      XXX: "XXX",
      Live: "直播",
      Pussy: "私处",
      TikTok: "TikTok",
      Sex: "性爱",
      Instagram: "Ins",
      Fuck: "啪啪",
      Teen: "青年",
      Viral: "热门",
    };
    return map[name] || name;
  },

  /** 轻量 HTML 实体解码(WP title/name 常见 &amp; &#039; &#8217; 等)。 */
  _decodeEntities(s) {
    if (!s || typeof s !== "string") return "";
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&#8217;/g, "’")
      .replace(/&#8216;/g, "‘")
      .replace(/&#8220;/g, "“")
      .replace(/&#8221;/g, "”")
      .replace(/&#8211;/g, "–")
      .replace(/&#8230;/g, "…")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&nbsp;/g, " ");
  },
};
