/**
 * 麻豆社 (madou.club) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 麻豆社是国产成人「剧情片/厂牌」聚合站,WordPress + 自适应主题(excerpt-c5 网格),
 *    整站服务端渲染 HTML(无 JSON API),用 cheerio 解网格。
 *  - 【Cloudflare】站点在 CF 后。Rust ureq(HTTP/1.1 + rustls)指纹会被 403/reset,
 *    故【每个 ctx.request.* 都必须带 http2:true】走 reqwest 栈 —— 硬性要求。
 *  - 【播放跨域两跳】详情页【不含直链】,播放器是独立域的 iframe:
 *      1) GET /<slug>.html → <iframe src=https://dash.madou.club/share/<sid>>
 *         (注意:该 iframe 属性【没有引号】,正则须兼容 src=xxx 与 src="xxx")
 *         <sid> 是 24 位十六进制(MongoDB ObjectId 形态)。
 *      2) GET dash.madou.club/share/<sid> → 页内内联 JS:
 *            var m3u8 = '/videos/<sid>/index.m3u8';
 *            var token = "<JWT>";
 *            if(token!=''){ m3u8 = m3u8+'?token='+token; }
 *         → 最终 https://dash.madou.club/videos/<sid>/index.m3u8?token=<JWT>
 *  - 【token 只活 100 秒】JWT payload 实测 exp - iat = 100(iat=1786024809, exp=1786024909)。
 *    故 playUrl【只存 slug】,resolvePlayUrl 每次现抓两跳换新鲜 token —— 绝不缓存签名 URL。
 *  - 【AES-128 HLS】manifest 内 KEY 是绝对地址(注意站点自身输出了双斜杠
 *    `https://dash.madou.club//videos/<sid>/ts.key`),分片是相对名(index0.ts…)。
 *    实测 ts.key(16B)与 index0.ts(1.5MB)【不需要 token】即可匿名取,
 *    只有 manifest 本体校验 token。dyproxy 会把相对分片与 KEY URI 重写回代理域。
 *  - 国内直连被墙 → 「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-08,全程经 127.0.0.1:7897 代理匿名验证):
 *  - LIST:   / → 20 张 article.excerpt;/page/2 → 20 条且与首页不重叠;
 *            深翻到尾页返 【HTTP 404】(hongkongdoll /page/8 → 404)—— 以此判定到底,
 *            不能只看 li.next-page(实测尾页前每页都带该链接)。
 *  - CATS:   首页导航 31 个厂牌 /category/<slug>(slug 多为中文原文,少数英文如
 *            hongkongdoll / psychoporntw);/category/<slug>/page/N 翻页有效且不重叠。
 *  - SEARCH: /?s=<kw> → 20 条;/page/2?s=<kw> → 20 条且首条不同(翻页有效)。
 *  - DETAIL: /<slug>.html → iframe dash.madou.club/share/68ff2021d2f708714780a8c1。
 *  - PLAY:   share 页解出 token(149 chars JWT)→ index.m3u8?token= → 200 4388B
 *            #EXTM3U(AES-128);ts.key → 200 16B;index0.ts → 200 1,541,232B。
 */
return {
  meta: {
    name: "麻豆社",
    author: "DouyTV",
    version: "0.1.0",
    description: "麻豆社 国产剧情成人片(WordPress + dash 播放域,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://madou.club";
  },

  /** 播放器域(iframe / m3u8 所在)。可用 config.dash 覆盖。 */
  _dash(ctx) {
    const d = ctx.config && ctx.config.get && ctx.config.get("dash");
    return (typeof d === "string" && d) || "https://dash.madou.club";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx, referer) {
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: referer || this._base(ctx) + "/",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  /** 统一 GET —— Cloudflare 站,必须 http2:true 走 reqwest 栈(ureq 会被 403/reset)。 */
  async _get(ctx, url, referer) {
    return ctx.request.get(url, {
      headers: this._headers(ctx, referer),
      timeout: 20000,
      http2: true,
    });
  },
  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("麻豆社 分类抓取失败:", String(e));
    }
    for (const c of cats) {
      sources.push({ id: "cat:" + c.slug, name: c.name, group: "厂牌" });
    }
    return sources;
  },

  /** 首页导航里的 /category/<slug> 清单(31 个厂牌)。缓存一天。 */
  async _fetchCategories(ctx) {
    const CK = "madou:categories:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const res = await this._get(ctx, this._base(ctx) + "/");
    if (!res.ok) throw new Error("麻豆社 首页 HTTP " + res.status);
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
      $('a[href*="/category/"]').each(function () {
        const href = $(this).attr("href") || "";
        const m = href.match(/\/category\/([^\/?#]+)/);
        if (!m) return;
        const slug = m[1];
        const name = self._decode(($(this).text() || "").trim());
        if (!name || seen[slug]) return;
        seen[slug] = true;
        out.push({ slug, name });
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

  /* ───────────────────────── 列表 / 搜索 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    const base = this._base(ctx);
    let url;
    if (id.indexOf("cat:") === 0) {
      const slug = id.slice("cat:".length);
      url = base + "/category/" + slug + (p > 1 ? "/page/" + p : "");
    } else {
      url = base + (p > 1 ? "/page/" + p : "/");
    }
    return this._fetchGrid(ctx, url, p);
  },

  /** 搜索:/?s=<kw> ;翻页 /page/N?s=<kw>(实测有效且不重叠)。 */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    const base = this._base(ctx);
    const q = "?s=" + encodeURIComponent(kw);
    const url = base + (p > 1 ? "/page/" + p + q : "/" + q);
    return this._fetchGrid(ctx, url, p);
  },

  /**
   * 抓一页网格。翻过尾页站点返 404 —— 以此判定到底(不能只看 li.next-page,
   * 实测尾页之前每页都带该链接,单看它会无限翻)。
   */
  async _fetchGrid(ctx, url, page) {
    let res;
    try {
      res = await this._get(ctx, url);
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    // 尾页越界 → 404,视作没有更多。
    if (res.status === 404) return { list: [], page, pageCount: page, total: 0 };
    if (!res.ok) throw new Error("麻豆社 HTTP " + res.status + " @ " + url);
    const html = await res.text();

    const items = this._parseGrid(ctx, html);
    const list = [];
    for (const it of items) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    // 满页(20)且存在下一页链接才继续;否则到底。
    const hasNext = /class="next-page"><a\s/i.test(html);
    const hasMore = list.length > 0 && hasNext;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },
  /**
   * cheerio 解 article.excerpt 网格。每卡:
   *   a.thumbnail[href="https://madou.club/<slug>.html"] → 详情链接(slug 作 id)
   *   img[data-src]  → 真实封面(src 是 thumb.png 占位图,懒加载)
   *   h2 > a         → 标题
   *   footer a[rel="category tag"] → 厂牌;.post-view → 观看数
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
    $("article.excerpt").each(function () {
      const el = $(this);
      // 详情链接 → slug 作 id
      let href = el.find("a.thumbnail").first().attr("href") || "";
      if (!href) href = el.find("h2 a").first().attr("href") || "";
      const slug = self._slugFromUrl(href);
      if (!slug || seen[slug]) return;
      seen[slug] = true;

      // 封面:懒加载真实图在 data-src,src 是占位 thumb.png。
      let poster = "";
      el.find("img").each(function () {
        if (poster) return;
        const ds =
          $(this).attr("data-src") || $(this).attr("data-original") || "";
        const sr = $(this).attr("src") || "";
        const pick = ds || sr;
        if (pick && !/^data:/.test(pick) && !/\/thumb\.png$/i.test(pick)) {
          poster = pick;
        }
      });

      const title =
        self._decode((el.find("h2 a").first().text() || "").trim()) ||
        self._decode((el.find("img").first().attr("alt") || "").trim()) ||
        slug;
      const studio = self._decode(
        (el.find('footer a[rel="category tag"]').first().text() || "").trim()
      );
      const views = self._decode(
        (el.find(".post-view").first().text() || "").trim()
      );

      out.push({ slug, title, poster, studio, views });
    });

    // 兜底:主题若改 class,整页正则扫 /<slug>.html。
    if (!out.length) {
      const re = /href="https?:\/\/[^"\/]+\/([^"\/]+)\.html"/g;
      let m;
      while ((m = re.exec(html))) {
        const slug = m[1];
        if (!slug || seen[slug]) continue;
        seen[slug] = true;
        out.push({ slug, title: this._prettySlug(slug), poster: "" });
      }
    }
    return out;
  },

  /** grid item → ScriptVodItem;顺便缓存供 detail 免二请。 */
  _toVod(it) {
    if (!it || !it.slug) return null;
    const title = it.title || it.slug;
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[it.slug] = {
      title,
      poster: it.poster || "",
      studio: it.studio || "",
    };
    const vod = {
      id: it.slug,
      title,
      type_name: it.studio || undefined,
      vod_remarks: it.views || undefined,
    };
    if (it.poster) {
      vod.poster = it.poster;
      // 封面与页面同域(madou.club/covers/...),带上 Referer 防盗链。
      vod.poster_headers = { Referer: "https://madou.club/" };
    }
    return vod;
  },
  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const slug = String(id);
    let info = this._pendingCache && this._pendingCache[slug];
    if (!info) {
      // 缓存 miss(直达详情):抓 /<slug>.html 取标题/封面。
      try {
        const res = await this._get(ctx, this._pageUrl(ctx, slug));
        if (res.ok) info = this._parseDetail(await res.text(), slug);
      } catch (e) {
        /* ignore,下面兜底 */
      }
    }
    if (!info) info = { title: this._prettySlug(slug), poster: "" };

    const vod = {
      id: slug,
      title: info.title || this._prettySlug(slug),
      year: "",
      desc: "",
      type_name: info.studio || undefined,
      playbacks: [
        {
          sourceId: sourceId || "madou",
          sourceName: "麻豆社",
          // playUrl 只存 slug —— JWT token 仅 100 秒有效期,绝不能固化到库里,
          // 每次播放都由 resolvePlayUrl 现抓 embed 页拿新鲜 token。
          episodes: [{ playUrl: slug, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
    if (info.poster) {
      vod.poster = info.poster;
      vod.poster_headers = { Referer: "https://madou.club/" };
    }
    return vod;
  },

  /** 详情页 HTML → { title, poster, studio, shareId }。 */
  _parseDetail(html, slug) {
    const out = { title: "", poster: "", studio: "", shareId: "" };
    const tm = html.match(/<title>([^<]*)<\/title>/i);
    if (tm) {
      // "标题-麻豆社" → 去掉站名后缀
      out.title = this._decode(tm[1].replace(/-\s*麻豆社\s*$/, "").trim());
    }
    if (!out.title) out.title = this._prettySlug(slug);
    // iframe → dash.madou.club/share/<24hex>
    out.shareId = this._shareIdFrom(html);
    // 封面:og:image 或正文里 /covers/ 图
    const og = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    );
    if (og) out.poster = this._decode(og[1]);
    if (!out.poster) {
      const cv = html.match(/https?:\/\/[^"'\s]*\/covers\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
      if (cv) out.poster = cv[0];
    }
    const cat = html.match(/rel=["']category tag["'][^>]*>([^<]+)</i);
    if (cat) out.studio = this._decode(cat[1].trim());
    return out;
  },

  /**
   * 播放解析(两跳):
   *  1) GET /<slug>.html            → iframe src = dash.madou.club/share/<shareId>
   *  2) GET dash/share/<shareId>    → 内联 JS 里 var m3u8='/videos/<shareId>/index.m3u8'
   *                                    与 var token="<JWT>"(exp-iat=100 秒)
   *  → 最终 URL = <dash>/videos/<shareId>/index.m3u8?token=<JWT>
   * token 极短命,故每次播放都现抓;m3u8 内 KEY 是绝对 URL、分片是相对路径,
   * dyproxy 会把相对分片重写回代理域,hls.js 顺着拉即可(KEY/分片本身不要 token)。
   */
  async resolvePlayUrl(ctx, { playUrl }) {
    const slug = String(playUrl || "").trim();
    if (!slug) throw new Error("麻豆社: 缺少 slug");

    // 1) 详情页 → shareId
    let shareId = "";
    const cached = this._pendingCache && this._pendingCache[slug];
    if (cached && cached.shareId) shareId = cached.shareId;
    if (!shareId) {
      const res = await this._get(ctx, this._pageUrl(ctx, slug));
      if (!res.ok) throw new Error("麻豆社: 详情页 HTTP " + res.status);
      const html = await res.text();
      shareId = this._shareIdFrom(html);
      if (!shareId) {
        throw new Error("麻豆社: 未从详情页解出播放器 iframe(结构可能已变)");
      }
      this._pendingCache = this._pendingCache || {};
      this._pendingCache[slug] = Object.assign(
        {},
        this._pendingCache[slug] || {},
        { shareId }
      );
    }

    // 2) embed 页 → m3u8 路径 + 新鲜 token
    const dash = this._dash(ctx);
    const embedUrl = dash + "/share/" + encodeURIComponent(shareId);
    const embRes = await this._get(ctx, embedUrl, this._base(ctx) + "/");
    if (!embRes.ok) throw new Error("麻豆社: embed HTTP " + embRes.status);
    const embHtml = await embRes.text();

    let path = "";
    const pm = embHtml.match(/var\s+m3u8\s*=\s*['"]([^'"]+\.m3u8)['"]/i);
    if (pm) path = pm[1];
    if (!path) path = "/videos/" + shareId + "/index.m3u8"; // 站点固定规律兜底

    const tm = embHtml.match(/var\s+token\s*=\s*['"]([^'"]*)['"]/i);
    const token = tm ? tm[1] : "";

    let url = /^https?:\/\//i.test(path) ? path : dash + path;
    if (token) url += (url.indexOf("?") >= 0 ? "&" : "?") + "token=" + token;

    return {
      url,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: dash + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 从详情页 HTML 抠 dash.madou.club/share/<24hex> 的 shareId(iframe src 无引号)。 */
  _shareIdFrom(html) {
    const s = String(html || "");
    let m = s.match(/\/share\/([0-9a-f]{16,32})/i);
    if (m) return m[1];
    // iframe src 可能不带引号:src=https://dash.../share/xxx
    m = s.match(/<iframe[^>]*\ssrc=["']?([^"'\s>]+)/i);
    if (m) {
      const m2 = m[1].match(/\/share\/([0-9a-f]{16,32})/i);
      if (m2) return m2[1];
    }
    return "";
  },

  /** 详情页 URL —— slug 里的中文已是 URL 编码形式,原样拼接不要二次编码。 */
  _pageUrl(ctx, slug) {
    const s = String(slug || "");
    if (/^https?:\/\//i.test(s)) return s;
    return this._base(ctx) + "/" + s + ".html";
  },

  /** 从详情链接抠 slug(去掉 .html 与站点前缀;保留 URL 编码原样)。 */
  _slugFromUrl(href) {
    const s = String(href || "").trim();
    if (!s) return "";
    const m = s.match(/^(?:https?:\/\/[^\/]+)?\/([^?#]+?)\.html(?:[?#].*)?$/i);
    return m ? m[1] : "";
  },

  /** URL 编码的中文 slug → 可读标题(解码失败原样返回)。 */
  _prettySlug(slug) {
    const s = String(slug || "");
    try {
      return decodeURIComponent(s).replace(/[-_]+/g, " ").trim() || s;
    } catch (e) {
      return s.replace(/[-_]+/g, " ").trim() || s;
    }
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
      .replace(/\s+/g, " ")
      .trim();
  },
};
