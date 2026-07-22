/**
 * NudeTik (nudetik.com) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - NudeTik 是 WordPress 站(bimber 主题 + FIFU 外链特色图 + REST v2 开放),
 *    TikTok 风格竖屏成人短视频【聚合站】—— 它自己不托管视频,而是把每条帖子
 *    嵌到多个第三方托管上(sendvid / xfree / reelsmunkey / fap.onl …)。
 *  - 列表走标准 WP REST:
 *      GET /wp-json/wp/v2/posts?_embed=1&per_page=<n>&page=<p>[&categories=<id>][&search=<kw>]
 *    但 REST 的 post.content.rendered 【是空的】(内容在主题模板里渲染),
 *    所以视频直链必须【抓 post.link 页面】现解。
 *  - 封面:REST post.meta.fifu_image_url 直接给外链缩略图(thumbs2.sendvid.com /
 *    thumbs.xfree.com / imgs.reelsmunkey.com …),匿名可取,无需 _embed。
 *  - 播放解析(抓 post 页面 HTML,2026-07 实测,经 127.0.0.1:7897 代理匿名验证):
 *      1. 直接内嵌 <source src="https://cdn.xfree.com/.../full.mp4">   → mp4 直传
 *      2. 直接内嵌 <source src="https://imgs.reelsmunkey.com/<id>.mp4"> → mp4 直传
 *      3. sendvid iframe: <iframe src="//sendvid.com/embed/<id>">
 *         → GET https://sendvid.com/embed/<id> → og:video 是【带 token 的】
 *           https://videos2.sendvid.com/../<id>.mp4?validfrom=..&validto=..&hash=..
 *           (token 按 IP 签发、约 4h 有效)→ 每次播放现解,不缓存直链。
 *  - CDN 均不校验 Referer/UA(实测匿名可取);国内直连被墙 → 「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-20,全程匿名):
 *  - LIST: GET /wp-json/wp/v2/posts?per_page=10 → 200,post.meta.fifu_image_url 给外链缩略图。
 *          GET /wp-json/wp/v2/categories → 200,tiktokporn1(1526)/nude-tiktok-3(988)… 真实分类。
 *          GET /wp-json/wp/v2/posts?search=asian → 200 有结果。
 *  - RESOLVE: 帖子页含 //sendvid.com/embed/m5lrkl06 或 cdn.xfree.com/.../full.mp4 或 imgs.reelsmunkey.com/*.mp4。
 *  - PLAY: sendvid embed 页 og:video → videos2.sendvid.com/../m5lrkl06.mp4?validfrom=..&hash=.. (206 video/mp4)。
 */
return {
  meta: {
    name: "NudeTik",
    author: "DouyTV",
    version: "0.1.0",
    description: "NudeTik 竖屏短视频聚合(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://nudetik.com";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx, json, referer) {
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer || this._base(ctx) + "/",
      Accept: json
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 20000,
      // nudetik.com 的 TLS 握手对 ureq(rustls)会 "unexpected end of file",
      // 走 reqwest 栈(http2:true)才稳 —— 全站请求统一带上。
      http2: true,
    });
    // WP 越界翻页返回 400 rest_post_invalid_page_number —— 交给调用方判空。
    if (res.status === 400) return { __over: true, headers: res.headers };
    if (!res.ok) throw new Error("NudeTik HTTP " + res.status + " @ " + url);
    const data = await res.json();
    return { data, headers: res.headers };
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  /**
   * 【HTML 优先】wp-json 对部分出口 IP 被 Cloudflare WAF 拦(返 404),而首页/分类/搜索
   * 的 HTML 网格对所有 IP 都通(浏览器实际走的路径)。故分类优先从首页导航解 /category/ 链接;
   * wp-json/categories 仅作可选补充(拿到更全的清单),失败静默降级。
   */
  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("NudeTik 分类抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    const seen = {};
    for (const c of cats) {
      if (!c.slug || seen[c.slug]) continue;
      if (c.slug === "uncategorized") continue;
      seen[c.slug] = true;
      (this._asianRank(c.slug + " " + c.name) < 99 ? asian : other).push(c);
    }
    const item = (c, group) => ({ id: "cat:" + c.slug, name: c.name, group });
    for (const c of asian) sources.push(item(c, "亚洲"));
    for (const c of other) sources.push(item(c, "分类"));
    return sources;
  },

  /** 分类清单:先 wp-json(全),失败或空则退回首页导航里的 /category/ 链接。 */
  async _fetchCategories(ctx) {
    const CK = "nudetik:categories:v2";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    let out = [];
    // 快速路径:wp-json(对我方 IP 通时能拿到全量带 count 的分类)
    try {
      const { data } = await this._getJson(ctx, "/wp-json/wp/v2/categories", {
        per_page: 100,
        orderby: "count",
        order: "desc",
      });
      for (const c of Array.isArray(data) ? data : []) {
        if (!c || !c.slug || !c.count) continue;
        out.push({
          slug: c.slug,
          name: this._prettyCat(this._decode((c.name || c.slug).toString())),
          count: c.count || 0,
        });
      }
    } catch (e) {
      /* wp-json 被 WAF 拦,降级到 HTML 导航 */
    }
    // 兜底:首页导航里的 /category/{slug}/ 链接
    if (!out.length) {
      try {
        out = await this._navCategories(ctx);
      } catch (e) {
        /* ignore */
      }
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

  /** 从首页 HTML 的导航解 /category/{slug}/ 链接(对所有 IP 都通)。 */
  async _navCategories(ctx) {
    const res = await ctx.request.get(this._base(ctx) + "/", {
      headers: this._headers(ctx, false),
      timeout: 20000,
      http2: true,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out = [];
    const seen = {};
    let $ = null;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      $ = null;
    }
    if (!$) return out;
    const self = this;
    $("a[href*='/category/']").each(function () {
      const href = $(this).attr("href") || "";
      const m = href.match(/\/category\/([^\/?#]+)/);
      if (!m) return;
      const slug = m[1];
      if (seen[slug]) return;
      seen[slug] = true;
      const txt = self._decode(($(this).text() || "").trim());
      out.push({ slug, name: txt || self._prettyCat(slug), count: 1 });
    });
    return out;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    if (id.indexOf("cat:") === 0) {
      return this._feed(ctx, p, { category: id.slice("cat:".length) });
    }
    return this._feed(ctx, p, {});
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feed(ctx, p, { search: kw });
  },

  /**
   * 【HTML 网格】抓首页/分类页/搜索页的 <article> 网格(对所有 IP 都通)。
   *  - 最新:   /            (第 1 页) | /page/{N}/            (N>1)
   *  - 分类:   /category/{slug}/       | /category/{slug}/page/{N}/
   *  - 搜索:   /?s={kw}                | /page/{N}/?s={kw}
   * 用 cheerio 解每个 article 的 a[href]+img+title,post 链接缓存供 detail。
   */
  async _feed(ctx, page, opts) {
    const base = this._base(ctx);
    let path;
    if (opts.search) {
      path =
        page > 1
          ? "/page/" + page + "/?s=" + encodeURIComponent(opts.search)
          : "/?s=" + encodeURIComponent(opts.search);
    } else if (opts.category) {
      path =
        "/category/" +
        opts.category +
        (page > 1 ? "/page/" + page + "/" : "/");
    } else {
      path = page > 1 ? "/page/" + page + "/" : "/";
    }
    const res = await ctx.request.get(base + path, {
      headers: this._headers(ctx, false),
      timeout: 20000,
      http2: true,
    });
    // 翻过尾页 WP 返 404 —— 视作无更多
    if (res.status === 404) return { list: [], page, pageCount: page, total: 0 };
    if (!res.ok) throw new Error("NudeTik HTTP " + res.status + " @ " + path);
    const html = await res.text();

    const items = this._parseGrid(ctx, html);
    const list = [];
    for (const it of items) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    // 有下一页链接(/page/{page+1}/)或本页拿满(≈WP 每页 ≥ 20)则继续翻。
    const hasMore =
      new RegExp("/page/" + (page + 1) + "/").test(html) || list.length >= 20;
    return {
      list,
      page,
      pageCount: hasMore && list.length ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * 用 cheerio 解 <article> 网格,抽 { link, title, poster }。
   * post 链接形如 /some-slug/;封面在 article 内 img 的 src(FIFU 外链缩略图)。
   */
  _parseGrid(ctx, html) {
    const out = [];
    const seen = {};
    let $ = null;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      return out;
    }
    const self = this;
    const base = this._base(ctx);
    $("article").each(function () {
      const el = $(this);
      // 找指向单个 post 的链接(排除 /category/、/tag/、/page/、评论锚点等)
      let link = "";
      let title = "";
      el.find("a[href]").each(function () {
        if (link) return;
        const href = $(this).attr("href") || "";
        if (!href) return;
        const abs = /^https?:\/\//.test(href)
          ? href
          : base + "/" + href.replace(/^\/+/, "");
        if (abs.indexOf(base) !== 0) return; // 只认本站链接
        const pathPart = abs.slice(base.length);
        if (
          /\/(category|tag|author|page)\//.test(pathPart) ||
          /[?#]/.test(pathPart) ||
          pathPart === "/" ||
          pathPart === ""
        )
          return;
        // 单 post:形如 /slug/
        if (!/^\/[^\/]+\/?$/.test(pathPart)) return;
        link = abs;
        const t = self._decode(($(this).attr("title") || $(this).text() || "").trim());
        if (t) title = t;
      });
      if (!link || seen[link]) return;
      seen[link] = true;
      // 封面:article 内首个有真实 src 的 img(优先 data-src 懒加载)
      let poster = "";
      el.find("img").each(function () {
        if (poster) return;
        const src =
          $(this).attr("data-src") ||
          $(this).attr("data-lazy-src") ||
          $(this).attr("src") ||
          "";
        if (src && !/^data:/.test(src)) poster = self._decode(src);
      });
      // 标题兜底:img alt / article 里的标题元素
      if (!title) {
        title =
          self._decode((el.find("img").first().attr("alt") || "").trim()) ||
          self._decode((el.find("h1,h2,h3,.entry-title").first().text() || "").trim());
      }
      if (!title) title = self._slugTitle(link);
      out.push({ link, title, poster });
    });
    return out;
  },

  /** 从 post 链接的 slug 造可读标题(最终兜底)。 */
  _slugTitle(link) {
    try {
      const m = String(link).replace(/\/+$/, "").match(/\/([^\/]+)$/);
      if (!m) return "";
      return this._prettyCat(m[1]);
    } catch (e) {
      return "";
    }
  },

  /** grid item → ScriptVodItem。post 链接缓存供 detail/resolve。 */
  _toVod(it) {
    if (!it || !it.link) return null;
    const id = it.link; // 用 post 链接作 id(HTML 路径下无数字 post id)
    const title = it.title || this._slugTitle(it.link);
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = { link: it.link, title, poster: it.poster || "" };
    return { id, title, poster: it.poster || undefined };
  },

  async detail(ctx, { id, sourceId }) {
    const info = (this._pendingCache && this._pendingCache[id]) || {
      link: /^https?:\/\//.test(id) ? id : this._base(ctx) + "/" + String(id).replace(/^\/+/, ""),
      title: this._slugTitle(id),
      poster: "",
    };
    if (!info.link) throw new Error("NudeTik: 缺少视频页地址 @ " + id);

    return {
      id: String(id),
      title: info.title || this._slugTitle(id),
      poster: info.poster || undefined,
      year: "",
      desc: "",
      playbacks: [
        {
          sourceId: sourceId || "nudetik",
          sourceName: "NudeTik",
          // playUrl 存 post 页 URL,resolvePlayUrl 抓页面解真实直链。
          episodes: [{ playUrl: info.link, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const pageUrl = /^https?:\/\//.test(playUrl)
      ? playUrl
      : this._base(ctx) + "/" + String(playUrl).replace(/^\/+/, "");

    const res = await ctx.request.get(pageUrl, {
      headers: this._headers(ctx, false),
      timeout: 20000,
      http2: true,
    });
    if (!res.ok) throw new Error("NudeTik: 视频页 HTTP " + res.status);
    const html = await res.text();

    const video = await this._extractVideoUrl(ctx, html);
    if (!video) {
      throw new Error("NudeTik: 未从视频页解出直链(嵌入结构可能已变)");
    }
    return {
      url: video,
      type: /\.m3u8(\?|$)/i.test(video) ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 播放解析 ───────────────────────── */

  /**
   * 从 post 页面 HTML 解出真实直链。nudetik 是聚合站,视频以两种形态嵌在正文
   * <video>/<iframe> 里(实测原始 HTML 就带,非 JS 懒加载),用 cheerio 解 DOM:
   *  1) <video><source src="....mp4/.m3u8">(xfree / reelsmunkey / fap.onl 等自托管直链)
   *  2) sendvid iframe //sendvid.com/embed/<id> → 抓 embed 页 og:video(带 token 的 mp4)
   *  3) 其它 embed iframe → 抓 iframe 页嗅探 mp4/m3u8
   * 都失败再用整页正则兜底(极端结构变动时的最后一道保险)。
   */
  async _extractVideoUrl(ctx, html) {
    let $ = null;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      $ = null;
    }

    if ($) {
      // 1) <video>/<source> 自托管直链(排除广告/其它区块:只认正文 .video / article 内)
      let direct = "";
      $("video source[src], video[src]").each(function () {
        if (direct) return;
        const src = $(this).attr("src") || "";
        if (/\.(?:m3u8|mp4)(\?|$)/i.test(src)) direct = src;
      });
      if (direct) return this._decode(direct);

      // 2/3) iframe embed —— 优先 sendvid,再通用嗅探(跳过 recaptcha/google)
      const iframes = [];
      $("iframe[src]").each(function () {
        const s = $(this).attr("src") || "";
        if (s) iframes.push(s);
      });
      let sendvidId = "";
      let otherEmbed = "";
      for (const raw of iframes) {
        let src = this._decode(raw);
        if (src.indexOf("//") === 0) src = "https:" + src;
        if (/recaptcha|google\.com/i.test(src)) continue;
        const sv = src.match(/sendvid\.com\/embed\/([A-Za-z0-9]+)/i);
        if (sv) {
          sendvidId = sv[1];
          break; // sendvid 最常见,拿到就停
        }
        if (!otherEmbed && /^https?:\/\//i.test(src)) otherEmbed = src;
      }
      if (sendvidId) {
        const url = await this._resolveSendvid(ctx, sendvidId);
        if (url) return url;
      }
      if (otherEmbed) {
        const url = await this._sniffEmbed(ctx, otherEmbed);
        if (url) return url;
      }
    }

    // 兜底:整页正则(cheerio 解析失败或结构异常时)
    const sv = html.match(/sendvid\.com\/embed\/([A-Za-z0-9]+)/i);
    if (sv) {
      const url = await this._resolveSendvid(ctx, sv[1]);
      if (url) return url;
    }
    const any =
      html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i) ||
      html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
    return any ? this._decode(any[0]) : "";
  },

  /** sendvid embed → og:video(带 token 的 mp4,按 IP 签发,现解现用)。 */
  async _resolveSendvid(ctx, id) {
    const url = "https://sendvid.com/embed/" + encodeURIComponent(id);
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, false, "https://sendvid.com/"),
        timeout: 20000,
      });
      if (!res.ok) return "";
      const html = await res.text();
      const og =
        html.match(
          /property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i
        ) ||
        html.match(
          /content=["']([^"']+)["']\s+property=["']og:video(?::secure_url)?["']/i
        ) ||
        html.match(/<source[^>]*\ssrc=["']([^"']+\.mp4[^"']*)["']/i);
      return og ? this._decode(og[1]) : "";
    } catch (e) {
      return "";
    }
  },

  /** 通用兜底:抓任意 embed 页 HTML,找 og:video / source 里的 mp4/m3u8。 */
  async _sniffEmbed(ctx, src) {
    try {
      const res = await ctx.request.get(src, {
        headers: this._headers(ctx, false, src),
        timeout: 20000,
      });
      if (!res.ok) return "";
      const html = await res.text();
      const m =
        html.match(
          /property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i
        ) ||
        html.match(/<source[^>]*\ssrc=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
        html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i) ||
        html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
      return m ? this._decode(m[1] || m[0]) : "";
    } catch (e) {
      return "";
    }
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 封面:优先 meta.fifu_image_url,再 _embed 特色图,再 jetpack。 */
  _poster(post) {
    if (!post) return "";
    try {
      if (post.meta && post.meta.fifu_image_url) return post.meta.fifu_image_url;
    } catch (e) {
      /* ignore */
    }
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
    return "";
  },

  /** 分类名清一下常见后缀数字(tiktokporn1 / nude-tiktok-3 → 更可读)。 */
  _prettyCat(name) {
    return String(name || "")
      .replace(/[-_]+/g, " ")
      .replace(/\s*\d+\s*$/, "")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  },

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
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
      .replace(/&#8217;/g, "’")
      .replace(/&#8230;|&hellip;/g, "…")
      .replace(/&nbsp;/g, " ")
      .trim();
  },
};
