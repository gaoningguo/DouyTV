/**
 * NSFWSwipe (nsfwswipe.com) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / detail / resolvePlayUrl
 *   (无 search —— 站点没有搜索接口,仅按 分类/标签/全站流 浏览)
 *
 * 说明:
 *  - NSFWSwipe 是 TikTok 风格竖屏成人短视频站,后端 Laravel(SPA + build/assets/app-*.js),
 *    内容是 Reddit v.redd.it 的 HLS 聚合(每条 gif/clip 对应一个 reddit 帖)。
 *  - 【统一列表接口】—— 主题自己的 more:
 *      POST /api/more/<page>
 *        headers: Content-Type: application/json, X-Requested-With: XMLHttpRequest
 *        body: {"category":<bool>,"tag":<bool>,"name":"<slug>","ids":[]}
 *      → 返回一段【HTML 卡片】(多个 <div class="swiper-slide">),不是 JSON。
 *    body 三种形态(实测,经 127.0.0.1:7897 代理匿名验证):
 *      · 全站流:  {category:false, tag:false, name:"",        ids:[]}
 *      · 分类:    {category:true,  tag:false, name:"<catSlug>", ids:[]}
 *      · 标签:    {category:false, tag:true,  name:"<tagSlug>", ids:[]}
 *    page 顺序翻页,分类/标签结果纯净(实测 category=twerking 返回全是 twerking)。
 *    ids 是「已看过的 id 列表」用于去重,匿名可传空数组。
 *  - 每个 <div class="swiper-slide"> 卡片内嵌全部所需字段,一次拿全、无需二次请求:
 *      data-id        视频 id
 *      data-poster    封面 https://cdn.nsfwswipe.com/swipes/<id>.webp(匿名 200)
 *      data-hls       播放源 https://v.redd.it/<rid>/HLSPlaylist.m3u8#t=0.1(master 多档)
 *      data-cleanlink /video/<id>-<slug>(单视频页)
 *      .title         标题;.channel-link → /category/<slug> 所属分类
 *  - 播放:v.redd.it 的 HLSPlaylist.m3u8 是【master playlist】(多分辨率),带浏览器 UA
 *    实测 200 application/x-mpegurl(reddit 对匿名 UA 出 HLS,不校验 Referer)。
 *    直连被墙 → 「设置 → 代理」配代理;dyproxy 会重写 master→media 与分片路径。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-20,全程匿名):
 *  - LIST:  POST /api/more/1 body{category:false,tag:false,name:"",ids:[]} → 200,5 张 swiper-slide 卡片,page 顺序翻页不重叠。
 *  - CAT:   POST /api/more/1 body{category:true,name:"twerking"} → 全是 twerking;/categories 页共 738 个分类。
 *  - TAG:   POST /api/more/1 body{tag:true,name:"ass-spread"} → 命中该标签。
 *  - PLAY:  GET v.redd.it/<rid>/HLSPlaylist.m3u8 带 UA → 200 application/x-mpegurl(#EXT-X-STREAM-INF 多档)。
 *           GET data-poster cdn.nsfwswipe.com/swipes/<id>.webp → 200。
 */
return {
  meta: {
    name: "NSFWSwipe",
    author: "DouyTV",
    version: "0.1.0",
    description: "NSFWSwipe 竖屏短视频(Reddit HLS 聚合,成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://nsfwswipe.com";
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
    if (kind === "ajax") {
      h.Accept = "*/*";
      h["X-Requested-With"] = "XMLHttpRequest";
      h.Origin = this._base(ctx);
      h["Content-Type"] = "application/json";
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
      ctx.log && ctx.log.warn && ctx.log.warn("NSFWSwipe 分类抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const c of cats) {
      if (c.slug === "all" || c.slug === "horizontal" || c.slug === "vertical") {
        continue; // 排除非内容筛选项
      }
      (this._asianRank(c.slug + " " + c.name) < 99 ? asian : other).push(c);
    }
    const item = (c, group) => ({ id: "cat:" + c.slug, name: c.name, group });
    for (const c of asian) sources.push(item(c, "亚洲"));
    // 分类数量巨大(738),只取前若干个常见的,避免 UI 过长。
    for (const c of other.slice(0, 60)) sources.push(item(c, "分类"));
    return sources;
  },

  /** 抓 /categories 页的分类清单。缓存一天。 */
  async _fetchCategories(ctx) {
    const CK = "nsfwswipe:categories:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const res = await ctx.request.get(this._base(ctx) + "/categories", {
      headers: this._headers(ctx, "html"),
      timeout: 20000,
      // nsfwswipe 走 Cloudflare —— ureq(HTTP/1.1 + rustls 默认指纹)会被 bot 检测层
      // 403/连接重置。走 reqwest(http2)栈更接近浏览器,实测在浏览器指纹下正常。
      http2: true,
    });
    if (!res.ok) throw new Error("NSFWSwipe categories HTTP " + res.status);
    const html = await res.text();
    const out = [];
    const seen = {};
    let $ = null;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      $ = null;
    }
    if ($) {
      const self = this;
      $("a.category-link[href], a[href^='/category/']").each(function () {
        const href = $(this).attr("href") || "";
        const m = href.match(/\/category\/([^\/?#]+)/);
        if (!m) return;
        const slug = m[1];
        if (seen[slug]) return;
        if (slug === "horizontal" || slug === "vertical") return; // 布局开关,非真分类
        seen[slug] = true;
        // 卡片文本是「#slug 数字 一大段描述」—— 只取 slug 美化,别把描述当名字。
        out.push({ slug, name: self._prettySlug(slug) });
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
      return this._feed(ctx, p, {
        category: true,
        tag: false,
        name: id.slice("cat:".length),
      });
    }
    if (id.indexOf("tag:") === 0) {
      return this._feed(ctx, p, {
        category: false,
        tag: true,
        name: id.slice("tag:".length),
      });
    }
    return this._feed(ctx, p, { category: false, tag: false, name: "" });
  },

  /**
   * POST /api/more/<page> → HTML 卡片。body 决定 全站/分类/标签。
   * 返回的每个 swiper-slide 已内嵌 hls/poster/title,直接入库。
   */
  async _feed(ctx, page, sel) {
    const body = JSON.stringify({
      category: !!sel.category,
      tag: !!sel.tag,
      name: sel.name || "",
      ids: [],
    });
    const res = await ctx.request.post(
      this._base(ctx) + "/api/more/" + encodeURIComponent(page),
      {
        headers: this._headers(ctx, "ajax"),
        body,
        timeout: 25000,
        http2: true,
      }
    );
    if (!res.ok) throw new Error("NSFWSwipe more HTTP " + res.status);
    const html = await res.text();
    const items = this._parseSlides(ctx, html);
    const list = [];
    for (const it of items) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    const hasMore = list.length > 0;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /** cheerio 解析一段含多个 <div class="swiper-slide"> 的 HTML。 */
  _parseSlides(ctx, html) {
    const out = [];
    let $ = null;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      return out;
    }
    const self = this;
    $("div.swiper-slide").each(function () {
      const el = $(this);
      const id = el.attr("data-id") || "";
      if (!id) return;
      // hls / poster 挂在内部带 data-hls 的元素上
      let hls = el.attr("data-hls") || "";
      let poster = el.attr("data-poster") || "";
      if (!hls) hls = (el.find("[data-hls]").first().attr("data-hls")) || "";
      if (!poster) {
        poster = (el.find("[data-poster]").first().attr("data-poster")) || "";
      }
      hls = self._cleanHls(hls);
      const title = self._decode((el.find(".title").first().text() || "").trim());
      const cat = self._decode(
        (el.find(".channel-link").first().text() || "").trim()
      ).replace(/^More NSFW\s*#?/i, "").replace(/\s*Porn Gifs\s*$/i, "");
      out.push({
        id: String(id),
        hls,
        poster,
        title: title || self._prettySlug(id),
        cat,
      });
    });
    return out;
  },

  _toVod(it) {
    if (!it || !it.id || !it.hls) return null;
    const id = String(it.id);
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      hls: it.hls,
      poster: it.poster || "",
      title: it.title || id,
      cat: it.cat || "",
    };
    return {
      id,
      title: it.title || id,
      poster: it.poster || undefined,
      type_name: it.cat || undefined,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info || !info.hls) {
      // miss(直达详情):抓单视频页 /video/<id> 解 data-hls。
      const resolved = await this._resolveById(ctx, id);
      if (resolved) {
        info = Object.assign({}, info || {}, resolved);
        this._pendingCache = this._pendingCache || {};
        this._pendingCache[id] = info;
      }
    }
    if (!info) info = { title: String(id) };

    const playUrl = info.hls ? info.hls : "id:" + id;
    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: "",
      type_name: info.cat || undefined,
      playbacks: [
        {
          sourceId: sourceId || "nsfwswipe",
          sourceName: "NSFWSwipe",
          episodes: [{ playUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    if (url.indexOf("id:") === 0) {
      const resolved = await this._resolveById(ctx, url.slice(3));
      if (!resolved || !resolved.hls) {
        throw new Error("NSFWSwipe: 无法解析播放地址 @ " + playUrl);
      }
      url = resolved.hls;
    }
    url = this._cleanHls(url);
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("NSFWSwipe: 无效播放地址 @ " + playUrl);
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

  /** 抓单视频页 /video/<id> 解 data-hls(detail 直达时用)。 */
  async _resolveById(ctx, id) {
    const url = this._base(ctx) + "/video/" + encodeURIComponent(String(id));
    let html;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, "html"),
        timeout: 20000,
        http2: true,
      });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      return null;
    }
    if (!html) return null;
    const items = this._parseSlides(ctx, html);
    for (const it of items) {
      if (String(it.id) === String(id) && it.hls) {
        return { hls: it.hls, poster: it.poster, title: it.title, cat: it.cat };
      }
    }
    // 兜底:整页找该 id 的 data-hls / 任意 v.redd.it m3u8
    const m =
      html.match(/data-hls=["']([^"']+\.m3u8[^"']*)["']/i) ||
      html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    if (m) return { hls: this._cleanHls(m[1] || m[0]) };
    return null;
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 去掉 v.redd.it 链接尾巴的 #t=0.1 锚(hls.js 不需要,留着无害但清爽)。 */
  _cleanHls(u) {
    return String(u || "").replace(/#t=[\d.]+$/, "");
  },

  _prettySlug(s) {
    return String(s || "")
      .replace(/[-_]+/g, " ")
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
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },
};
