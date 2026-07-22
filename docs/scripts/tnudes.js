/**
 * TNudes (tnudes.to) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - TNudes 是 DataLife Engine (DLE) 站(【非 WordPress】,无 /wp-json),TikTok 风格竖屏成人短视频。
 *  - 列表全走服务端渲染的 HTML,卡片是 <a class="item item-poster grid-item" href="/<id>-<slug>.html">,
 *    内含 <img src="/uploads/posts/.../medium/<x>.webp"> 缩略图 + .item-poster__title 标题 + .item-poster__meta 分类。
 *  - 【分页】首页 / 分类页用 /page/<n>/ 追加(实测 /page/2/ 200,分类 /<slug>/page/2/ 200)。
 *  - 【分类】顶部导航固定几个 slug: nsfw-tiktok / of / sexy / tiktok-boobs / tiktok-porn / tiktok-pussy /
 *    tiktok-thots / ttday。分类页 URL = /<slug>/。
 *  - 【搜索】DLE 搜索: GET /index.php?do=search&subaction=search&story=<kw>,返回同样的卡片列表。
 *  - 【播放】视频页 (/<id>-<slug>.html) 里 og:video + <source> 直接给 media.tnudes.to 的直链 mp4,
 *    实测匿名 Range 请求 206 video/mp4(可 seek),CDN 不校验 Referer/UA。
 *  - 国内直连需在「设置 → 代理」配代理。成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07,全程经 127.0.0.1:7897 代理匿名):
 *  - LIST: GET / → 10 张卡片;GET /page/2/ → 200;GET /tiktok-boobs/ → 200,/tiktok-boobs/page/2/ → 200。
 *  - SEARCH: GET ?do=search&subaction=search&story=asian → 返回多张匹配卡片。
 *  - PLAY: GET /582-....html → og:video = https://media.tnudes.to/tvids/05/18.mp4;Range → 206 video/mp4。
 */
return {
  meta: {
    name: "TNudes",
    author: "DouyTV",
    version: "0.1.0",
    description: "TNudes 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://tnudes.to";
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
      Referer: this._base(ctx) + "/",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources() {
    // DLE 顶部导航固定分类(slug 稳定,直接内置,免一次抓取)。
    return [
      { id: "latest", name: "最新", group: "浏览" },
      { id: "cat:nsfw-tiktok", name: "NSFW TikTok", group: "分类" },
      { id: "cat:sexy", name: "Sexy", group: "分类" },
      { id: "cat:tiktok-boobs", name: "TikTok Boobs", group: "分类" },
      { id: "cat:tiktok-porn", name: "TikTok Porn", group: "分类" },
      { id: "cat:tiktok-pussy", name: "TikTok Pussy", group: "分类" },
      { id: "cat:tiktok-thots", name: "TikTok Thots", group: "分类" },
      { id: "cat:of", name: "OnlyFans", group: "分类" },
      { id: "cat:ttday", name: "TikTok of the Day", group: "分类" },
    ];
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    let path;
    if (id.indexOf("cat:") === 0) {
      const slug = id.slice("cat:".length);
      path = p > 1 ? "/" + slug + "/page/" + p + "/" : "/" + slug + "/";
    } else {
      path = p > 1 ? "/page/" + p + "/" : "/";
    }
    return this._feed(ctx, this._base(ctx) + path, p);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    // DLE 搜索翻页用 search_start(从 1 开始);首页 search_start=1。
    const url = ctx.utils.buildUrl(this._base(ctx) + "/index.php", {
      do: "search",
      subaction: "search",
      search_start: p,
      full_search: 0,
      result_from: (p - 1) * 10 + 1,
      story: kw,
    });
    return this._feed(ctx, url, p);
  },

  /** 抓一页 HTML,解析所有卡片。 */
  async _feed(ctx, url, page) {
    let html;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx),
        timeout: 20000,
      });
      if (!res.ok) return { list: [], page, pageCount: page, total: 0 };
      html = await res.text();
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    const list = this._parseCards(ctx, html);
    // DLE 一页 ~10 条;满页则假定还有下一页。
    const hasMore = list.length >= 8;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * 解析列表页的卡片: <a class="item item-poster grid-item" href="/<id>-<slug>.html">
   *   内含 <img src=...> + .item-poster__title + .item-poster__meta。
   */
  _parseCards(ctx, html) {
    const out = [];
    let $;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      return out;
    }
    const self = this;
    const seen = {};
    $("a.item-poster").each(function () {
      const el = $(this);
      const href = el.attr("href") || "";
      const id = self._idFromHref(href);
      if (!id || seen[id]) return;
      const img = el.find("img").first();
      let poster =
        (img && (img.attr("data-src") || img.attr("src"))) || "";
      poster = self._abs(ctx, poster);
      const title = self
        ._decode(el.find(".item-poster__title").first().text() || "")
        .replace(/\s+/g, " ")
        .trim();
      const meta = self
        ._decode(el.find(".item-poster__meta").first().text() || "")
        .replace(/\s+/g, " ")
        .trim();
      seen[id] = true;
      const link = self._abs(ctx, href);
      self._pendingCache = self._pendingCache || {};
      self._pendingCache[id] = {
        link,
        title: title || id,
        poster,
        desc: meta,
      };
      out.push({
        id,
        title: title || id,
        poster: poster || undefined,
        type_name: meta || undefined,
      });
    });
    return out;
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info || !info.link) {
      // miss(直接进 detail)→ 无法只凭 id 拼 slug,报错交给列表流。
      // 但 DLE 也接受纯 /<id> 前缀跳转,尝试 /<id>-.html 会 404;所以要求先经列表。
      info = info || {};
    }
    const link = info.link || this._base(ctx) + "/" + id + "-.html";
    // 现拉视频页解出直链 + 补全封面/标题。
    const resolved = await this._resolvePage(ctx, link);
    const title = (resolved && resolved.title) || info.title || String(id);
    const poster = (resolved && resolved.poster) || info.poster || undefined;
    const videoUrl = resolved && resolved.videoUrl;
    return {
      id: String(id),
      title,
      poster,
      year: "",
      desc: info.desc || "",
      playbacks: [
        {
          sourceId: sourceId || "tnudes",
          sourceName: "TNudes",
          episodes: [
            {
              // 有直链直传(media.tnudes.to 静态路径,无 token);否则塞视频页 URL 现拉。
              playUrl: videoUrl || link,
              needResolve: true,
              title: "完整版",
            },
          ],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    // 若给的是视频页 URL(非直链 mp4),现拉解析。
    if (!/\.mp4(\?|$)/i.test(url) && /\/\d+-.*\.html/i.test(url)) {
      const resolved = await this._resolvePage(ctx, url);
      if (!resolved || !resolved.videoUrl) {
        throw new Error("TNudes: 无法从视频页解出直链 @ " + playUrl);
      }
      url = resolved.videoUrl;
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("TNudes: 无效播放地址 @ " + playUrl);
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

  /** 抓视频页 HTML,解出 og:video / <source> 直链 + og:image 封面 + 标题。 */
  async _resolvePage(ctx, pageUrl) {
    let html;
    try {
      const res = await ctx.request.get(pageUrl, {
        headers: this._headers(ctx),
        timeout: 20000,
      });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      return null;
    }
    if (!html) return null;
    const videoUrl = this._extractVideo(ctx, html);
    const poster = this._extractOg(html, "og:image");
    const title = this._decode(this._extractOg(html, "og:title") || "");
    return { videoUrl, poster: this._abs(ctx, poster), title };
  },

  _extractVideo(ctx, html) {
    let m =
      html.match(
        /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+\.mp4[^"']*)["']/i
      ) ||
      html.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i) ||
      html.match(/https?:\/\/media\.tnudes\.to\/[^"'\s]+\.mp4[^"'\s]*/i);
    if (!m) return "";
    return this._abs(ctx, this._decode(m[1] || m[0]));
  },

  _extractOg(html, prop) {
    const m = html.match(
      new RegExp(
        '<meta[^>]+property=["\']' +
          prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          '["\'][^>]+content=["\']([^"\']+)["\']',
        "i"
      )
    );
    return m ? m[1] : "";
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 从 /<id>-<slug>.html 抽 id。 */
  _idFromHref(href) {
    if (!href || typeof href !== "string") return "";
    const m = href.match(/\/(\d+)-[^\/]*\.html/);
    return m ? m[1] : "";
  },

  _abs(ctx, url) {
    if (!url || typeof url !== "string") return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    return this._base(ctx) + "/" + url.replace(/^\/+/, "");
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
