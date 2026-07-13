/**
 * SwipeFap (swipefap.com) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - SwipeFap 是 TikTok 风格竖屏成人短视频站,后端是 WordPress + 自研 "swipetheme"。
 *  - 【主推荐流】没有走 WP REST,而是主题自己的 admin-ajax:
 *      POST /wp-admin/admin-ajax.php  action=swipetheme_load_more&page=<n>&per_page=<k>
 *      → { success, data:{ html:"<article...>", hasMore } }
 *    html 里每个 <article class="video-item"> 直接内嵌 <video> 的
 *    data-hls-url / data-video-url + poster + 标题/作者/描述 —— 一次拿全,无需二次请求。
 *    【匿名可用,不需要 nonce】(实测带不带 nonce 都返回真实数据);page 顺序翻页、
 *    分页不重叠(page1 尾 96642 → page2 首 96637),data.hasMore 指示是否还有下一页。
 *    注意:此 load_more 是【全站按时间倒序】的流,忽略任何分类/搜索参数(实测 category=/s= 无效)。
 *  - 【分类 / 搜索】改走标准 WP REST(admin-ajax 不支持过滤):
 *      GET /wp-json/wp/v2/posts?categories=<id>&page=<n>&per_page=20   分类
 *      GET /wp-json/wp/v2/posts?search=<kw>&page=<n>&per_page=20        搜索
 *      GET /wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc  分类清单
 *    但 WP REST 的 post JSON【不含视频直链,也不含封面】(视频只在主题渲染的 article HTML 里),
 *    所以分类/搜索的条目只带 id+标题,播放地址在 resolvePlayUrl 时按 id 现拉。
 *  - 【按 id 解析播放地址】站点单视频页 permalink 会 302 跳到 /?start_post=<id>,
 *    该页返回首页 HTML 但把目标 article 注入进去(内含【新鲜的】video 直链 + 封面 + 标题)。
 *    这是所有「只有 id」条目的统一解析路径:GET /?start_post=<id> → 抠出该 article 的 video url。
 *  - 播放地址三种形态(2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *      1. HLS(最常见): https://swipefap.com/wp-content/uploads/mediamonster/hls/<n>/playlist.m3u8
 *         → GET 200 application/vnd.apple.mpegurl,body 以 #EXTM3U 开头(单档 media playlist,
 *           segment_000.ts 相对路径;GET 段 206 video/mp2t)。dyproxy 会重写相对段路径。
 *      2. 站内 mp4: https://swipefap.com/wp-content/uploads/.../<name>.mp4
 *         (含 sda-ultimate/.../*-converted.mp4)→ GET Range 206 video/mp4。
 *      3. video-proxy: https://swipefap.com/video-proxy/<hash> → 301 到 S3(bucket xfree),
 *         部分对象已过期返回 404 NoSuchKey;少量外链(rapidcdn/tiktokcdn)会 403。
 *         → resolvePlayUrl 原样透传,能播则播,过期项由 app 侧报错兜底。
 *  - 封面 https://swipefap.com/wp-content/uploads/.../thumbnails/video-thumb-<id>-<ts>.jpg,
 *    CDN 不校验 Referer/UA,实测匿名 200 image/jpeg。
 *  - 国内直连被墙 → 在「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-12,全程匿名):
 *  - LIST: POST admin-ajax swipetheme_load_more page=1 per_page=20 → 200, 20 条 article, hasMore=true。
 *          GET /wp-json/wp/v2/posts?categories=742 → 200, 真实分类条目;search=teen → X-WP-Total 121。
 *  - RESOLVE: GET /?start_post=96599 → HTML 含 data-video-id="96599" + data-hls-url=".../96598/playlist.m3u8"。
 *  - PLAY: GET .../mediamonster/hls/32871/playlist.m3u8 → 200,首行 #EXTM3U;segment_000.ts → 206 video/mp2t。
 *          GET Range .../2024/04/B2-1.mp4 → 206 video/mp4;.../sda_..-converted.mp4 → 206 video/mp4。
 *          GET poster video-thumb-*.jpg → 200 image/jpeg(无 Referer 也可)。
 */
return {
  meta: {
    name: "SwipeFap",
    author: "DouyTV",
    version: "0.1.0",
    description: "SwipeFap 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /* ── 基址(可 config 覆盖,万一换域名)── */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://swipefap.com";
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
      "Accept-Language": "en-US,en;q=0.9",
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

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("SwipeFap 分类抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const c of cats) {
      if (!c.count) continue; // 跳过空分类
      (this._asianRank(c.slug + " " + c.name) < 99 ? asian : other).push(c);
    }
    const item = (c, group) => ({ id: "cat:" + c.id, name: c.name, group });
    for (const c of asian) sources.push(item(c, "亚洲"));
    for (const c of other) sources.push(item(c, "分类"));
    return sources;
  },

  /** 抓 WP 分类,按内容量降序。缓存一天。 */
  async _fetchCategories(ctx) {
    const CK = "swipefap:categories:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const url = ctx.utils.buildUrl(this._base(ctx) + "/wp-json/wp/v2/categories", {
      per_page: 100,
      orderby: "count",
      order: "desc",
    });
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, "json"),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("SwipeFap categories HTTP " + res.status);
    const raw = await res.json();
    const out = [];
    for (const c of Array.isArray(raw) ? raw : []) {
      if (!c || c.id == null) continue;
      out.push({
        id: String(c.id),
        name: this._decode((c.name || "").toString()).trim(),
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
      return this._feedRest(ctx, p, { categories: id.slice("cat:".length) });
    }
    return this._feedLatest(ctx, p);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feedRest(ctx, p, { search: kw });
  },

  /**
   * 主推荐流 —— admin-ajax swipetheme_load_more(全站时间倒序,匿名可用,不需 nonce)。
   * html 里每个 article 已内嵌 video 直链 + 封面 + 标题,直接解析入库(detail 命中免二请)。
   */
  async _feedLatest(ctx, page) {
    const body =
      "action=swipetheme_load_more&page=" +
      encodeURIComponent(page) +
      "&per_page=20";
    const res = await ctx.request.post(
      this._base(ctx) + "/wp-admin/admin-ajax.php",
      {
        headers: this._headers(ctx, "ajax"),
        body,
        timeout: 25000,
      }
    );
    if (!res.ok) throw new Error("SwipeFap load_more HTTP " + res.status);
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    const html = data && data.data && data.data.html;
    if (!html || typeof html !== "string") {
      return { list: [], page, pageCount: page, total: 0 };
    }
    const items = this._parseArticles(ctx, html);
    const list = [];
    for (const it of items) {
      if (it.mediaType && it.mediaType !== "video") continue; // 跳过图片/广告条目
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }
    const hasMore = data.data.hasMore !== false && list.length > 0;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * 分类 / 搜索 —— WP REST /posts(admin-ajax 不支持过滤)。page 顺序翻页,
   * 用响应头 X-WP-TotalPages 判断是否还有下一页。
   * 注意:REST 的 post JSON 不含视频直链/封面 —— 条目只带 id+标题,
   * 播放地址在 resolvePlayUrl 时用 id 走 /?start_post 现拉。
   */
  async _feedRest(ctx, page, extraQuery) {
    const query = { per_page: 20, page };
    for (const key in extraQuery) {
      if (extraQuery[key] != null && extraQuery[key] !== "") {
        query[key] = extraQuery[key];
      }
    }
    const url = ctx.utils.buildUrl(
      this._base(ctx) + "/wp-json/wp/v2/posts",
      query
    );
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, "json"),
      timeout: 20000,
    });
    // WP 越界翻页返回 400 rest_post_invalid_page_number —— 视作没有更多。
    if (res.status === 400) return { list: [], page, pageCount: page, total: 0 };
    if (!res.ok) throw new Error("SwipeFap REST HTTP " + res.status + " @ " + url);

    const posts = await res.json();
    const arr = Array.isArray(posts) ? posts : [];
    const list = [];
    for (const post of arr) {
      if (post == null || post.id == null) continue;
      const id = String(post.id);
      const title =
        this._decode((post.title && post.title.rendered) || "").trim() || id;
      // REST 无封面/直链,仅缓存标题;video url 留到解析时拿。
      this._pendingCache = this._pendingCache || {};
      if (!this._pendingCache[id]) this._pendingCache[id] = { title };
      list.push({ id, title });
    }
    const totalPages = parseInt(res.headers["x-wp-totalpages"] || "0", 10) || 0;
    const hasMore = totalPages ? page < totalPages : list.length >= 20;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    // 分类/搜索命中(只有标题)或彻底 miss → 走 /?start_post 现拉完整信息。
    if (!info || !info.videoUrl) {
      const resolved = await this._resolveById(ctx, id);
      if (resolved) {
        info = Object.assign({}, info || {}, resolved);
        this._pendingCache = this._pendingCache || {};
        this._pendingCache[id] = info;
      }
    }
    if (!info) info = { title: String(id) };

    // playUrl:有直链就直传(此站直链是静态 wp-content 路径,无 token 过期);
    // 否则塞 "id:<id>",resolvePlayUrl 再现拉。
    const playUrl = info.videoUrl ? info.videoUrl : "id:" + id;
    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.author || undefined,
      playbacks: [
        {
          sourceId: sourceId || "swipefap",
          sourceName: "SwipeFap",
          episodes: [{ playUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    // "id:<n>" → 走 /?start_post 现拉该视频直链。
    if (url.indexOf("id:") === 0) {
      const id = url.slice(3);
      const resolved = await this._resolveById(ctx, id);
      if (!resolved || !resolved.videoUrl) {
        throw new Error("SwipeFap: 无法解析播放地址 @ " + playUrl);
      }
      url = resolved.videoUrl;
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("SwipeFap: 无效播放地址 @ " + playUrl);
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
   * 按 video_id 解析:GET /?start_post=<id> 返回首页 HTML 但注入了目标 article,
   * 从中抠出该 article 的 video 直链 + 封面 + 标题。找不到返回 null。
   */
  async _resolveById(ctx, id) {
    const url =
      this._base(ctx) + "/?start_post=" + encodeURIComponent(String(id));
    let html;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, "html"),
        timeout: 25000,
      });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("SwipeFap 解析失败:", String(e));
      return null;
    }
    if (!html || typeof html !== "string") return null;
    const items = this._parseArticles(ctx, html);
    for (const it of items) {
      if (String(it.id) === String(id)) {
        if (!it.videoUrl) return null;
        return {
          videoUrl: it.videoUrl,
          poster: it.poster || undefined,
          title: it.title || String(id),
          author: it.author || undefined,
          desc: it.desc || "",
        };
      }
    }
    return null;
  },

  /* ───────────────────────── 归一化 ───────────────────────── */

  /**
   * 用 cheerio 解析一段含多个 <article class="video-item"> 的 HTML,
   * 抽取 { id, mediaType, permalink, videoUrl, poster, title, author, desc }。
   */
  _parseArticles(ctx, html) {
    const out = [];
    let $;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      return out;
    }
    const self = this;
    $("article.video-item, article.media-item").each(function () {
      const el = $(this);
      if (el.hasClass("ad-item")) return;
      const id = el.attr("data-video-id");
      if (!id) return;
      const mediaType = el.attr("data-media-type") || "";
      const permalink = el.attr("data-permalink") || "";
      const video = el.find("video").first();
      const videoUrl =
        (video && (video.attr("data-hls-url") || video.attr("data-video-url"))) ||
        "";
      const poster = (video && video.attr("poster")) || "";
      const strong = el.find(".video-description strong").first();
      let title = self._decode((strong && strong.text()) || "").trim();
      if (!title) title = self._slugTitle(permalink) || String(id);
      const author = self
        ._decode(el.find(".video-author").first().text() || "")
        .replace(/\s+/g, " ")
        .trim();
      // 描述 = video-description 全文去掉标题。
      let desc = self
        ._decode(el.find(".video-description").first().text() || "")
        .replace(/\s+/g, " ")
        .trim();
      if (title && desc.indexOf(title) === 0) desc = desc.slice(title.length).trim();
      out.push({
        id: String(id),
        mediaType,
        permalink,
        videoUrl,
        poster,
        title,
        author,
        desc,
      });
    });
    return out;
  },

  /**
   * article item → ScriptVodItem。存 videoUrl/poster 到 _pendingCache 供 detail 命中。
   * 无 videoUrl 的丢弃(纯图/广告)。
   */
  _toVod(ctx, it) {
    if (!it || !it.id || !it.videoUrl) return null;
    const id = String(it.id);
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      videoUrl: it.videoUrl,
      poster: it.poster || "",
      title: it.title || id,
      author: it.author || "",
      desc: it.desc || "",
    };
    return {
      id,
      title: it.title || id,
      poster: it.poster || undefined,
      type_name: it.author || undefined,
      desc: it.desc || undefined,
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 从 permalink slug 造一个人类可读标题(兜底,当 article 没有 strong 标题时)。 */
  _slugTitle(permalink) {
    if (!permalink || typeof permalink !== "string") return "";
    const m = permalink.replace(/\/+$/, "").match(/\/([^\/]+)$/);
    if (!m) return "";
    return m[1]
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  },

  /** 亚洲优先级:中文/台港 → 日 → 韩 → 其它亚洲 → 非亚洲(99)。数字越小越靠前。 */
  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },

  /** 轻量 HTML 实体解码。 */
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
      .replace(/&#8217;/g, "’")
      .replace(/&#8216;/g, "‘")
      .replace(/&#8220;/g, "“")
      .replace(/&#8221;/g, "”")
      .replace(/&#8211;/g, "–")
      .replace(/&#8230;|&hellip;/g, "…")
      .replace(/&nbsp;/g, " ");
  },
};
