/**
 * 123av.fun 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 123av.fun 是竖屏成人短视频站(Hyperf/PHP 服务端渲染 + BunnyCDN 托管页面),
 *    内容以中文/亚洲短视频为主,天生适合竖屏刷流。
 *  - 站点【没有对外 JSON API】—— 列表数据全在服务端渲染的 HTML 里,每张卡片
 *    是一个 <a class="video-card" data-*> 元素,视频/封面/标题/作者/时长/播放量
 *    全塞在 data-* 属性上,所以直接抠 DOM 属性最稳(不用二次请求详情页)。
 *  - 视频直链 = 卡片的 data-src(imgcaches CDN 上的 HLS master),形如
 *    https://vs-proxy.imgcaches.cc/x/video/<hash>.m3u8 —— 竖屏 720x1280,
 *    实测匿名 200 application/vnd.apple.mpegurl,子播放列表/分片(.m4s + fMP4 init)
 *    同域 CDN,CORS 全开,不校验 Referer/UA。
 *    (卡片上还有个 data-twitter 是推特源 m3u8,但会过期;data-src 的 imgcaches 才是稳的。)
 *  - 国内直连被墙,请在「设置 → 代理」配代理,scriptFetch 与播放代理会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 页面形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 最新:   GET /              → 第 1 页;GET /page-<n> → 第 n 页(rel=next 指向 /page-<n+1>)
 *  - 排序:   GET /<field>/sort-desc[/page-<n>]
 *             field ∈ publish-time | view-count | comment-count | favorite-count
 *  - 搜索:   GET /search/q-<kw>          → 第 1 页
 *             GET /search/q-<kw>/page-<n> → 第 n 页(注意 page 段在 q 段之后)
 *  - 详情:   GET /detail/<id>-<slug>     → 同款 video-card(单条),一般用不到(列表已带全部信息)
 *  - 每卡: data-id / data-src(.m3u8) / data-poster / data-videotitle / data-duration
 *          / data-username / data-playcount / data-tags
 *  - 播放实测: HEAD/GET https://vs-proxy.imgcaches.cc/x/video/<hash>.m3u8
 *              → 200 application/vnd.apple.mpegurl, body #EXTM3U, 720x1280 VOD
 */
return {
  meta: {
    name: "123av.fun",
    author: "DouyTV",
    version: "0.1.0",
    description: "123av.fun 竖屏亚洲短视频(成人内容,需代理 + 年龄确认)",
  },

  /** 站点基址,可用脚本 config.base 覆盖(万一换域名)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://123av.fun";
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
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: this._base(ctx) + "/",
    };
  },

  async _getHtml(ctx, path) {
    const url = this._base(ctx) + path;
    return ctx.request.getHtml(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
  },

  async getSources(ctx) {
    // 浏览 + 排序入口 + 站点热门搜索词(当分类用)。亚洲相关排前。
    const sources = [
      { id: "latest", name: "最新", group: "浏览" },
      { id: "sort:view-count", name: "最多播放", group: "浏览" },
      { id: "sort:favorite-count", name: "最多收藏", group: "浏览" },
      { id: "sort:comment-count", name: "最多评论", group: "浏览" },
    ];

    let terms = [];
    try {
      terms = await this._fetchHotTerms(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("123av 热词抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const t of terms) {
      (this._asianRank(t) < 99 ? asian : other).push(t);
    }
    const item = (kw, group) => ({ id: "kw:" + kw, name: kw, group });
    for (const kw of asian) sources.push(item(kw, "热门"));
    for (const kw of other) sources.push(item(kw, "标签"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";

    if (id.indexOf("kw:") === 0) {
      const kw = id.slice("kw:".length);
      return this._feedSearch(ctx, p, kw);
    }
    if (id.indexOf("sort:") === 0) {
      const field = id.slice("sort:".length);
      const base = "/" + field + "/sort-desc";
      const path = p > 1 ? base + "/page-" + p : base;
      return this._feed(ctx, p, path);
    }
    // 最新 / 首页
    const path = p > 1 ? "/page-" + p : "/";
    return this._feed(ctx, p, path);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feedSearch(ctx, p, kw);
  },

  /** 搜索列表:/search/q-<kw>[/page-<n>](page 段在 q 段之后)。 */
  async _feedSearch(ctx, page, keyword) {
    const q = "q-" + encodeURIComponent(keyword);
    const path =
      page > 1 ? "/search/" + q + "/page-" + page : "/search/" + q;
    return this._feed(ctx, page, path);
  },

  /** 通用列表:抓 HTML,抠所有 <a class="video-card" data-*>。 */
  async _feed(ctx, page, path) {
    let html;
    try {
      html = await this._getHtml(ctx, path);
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    const cards = this._parseCards(ctx, html);
    const list = [];
    for (const c of cards) {
      const vod = this._toVod(c);
      if (vod) list.push(vod);
    }
    // 有 rel=next 才认为还有下一页(翻过尾页页面无卡片 / 无 next)。
    const hasMore =
      list.length > 0 && /rel="?next"?/i.test(String(html || ""));
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * 用 cheerio 抠 video-card 的 data-* 属性。
   * cheerio 拿不到时兜底走正则(个别属性名带下划线,cheerio attr 全兼容)。
   */
  _parseCards(ctx, html) {
    const out = [];
    try {
      const $ = ctx.html.load(html);
      $("a.video-card").each((_, el) => {
        const $el = $(el);
        const src = $el.attr("data-src") || "";
        const id = $el.attr("data-id") || "";
        if (!src || !id) return;
        out.push({
          id: String(id),
          src: String(src),
          poster: $el.attr("data-poster") || "",
          title:
            $el.attr("data-videotitle") ||
            $el.attr("alt") ||
            "",
          duration: $el.attr("data-duration") || "",
          username: $el.attr("data-username") || "",
          playcount: $el.attr("data-playcount") || "",
          tags: $el.attr("data-tags") || "",
          href: $el.attr("href") || "",
        });
      });
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("123av cheerio 解析失败:", String(e));
    }
    return out;
  },

  /**
   * card → ScriptVodItem。id 用 data-id。
   * 把 src/poster/title 塞内存缓存供 detail 命中(免二次请求)。
   */
  _toVod(c) {
    if (!c || !c.id || !c.src) return null;
    const title = this._decode(c.title) || c.id;
    const typeName = this._firstTag(c.tags);

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[c.id] = {
      src: c.src,
      poster: c.poster,
      title,
      username: this._decode(c.username),
      typeName,
      duration: c.duration,
    };

    return {
      id: c.id,
      title,
      poster: c.poster || undefined,
      type_name: typeName,
      vod_remarks: this._remarks(c),
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      // 内存 miss:直接抓详情页(单卡),再抠一次。
      let html;
      try {
        html = await this._getHtml(ctx, "/detail/" + encodeURIComponent(id));
      } catch (e) {
        throw new Error("123av: 详情请求失败 @ " + id);
      }
      const cards = this._parseCards(ctx, html);
      const c = cards.find((x) => x.id === String(id)) || cards[0];
      if (!c || !c.src) throw new Error("123av: 未找到视频直链 @ " + id);
      info = {
        src: c.src,
        poster: c.poster,
        title: this._decode(c.title) || id,
        username: this._decode(c.username),
        typeName: this._firstTag(c.tags),
        duration: c.duration,
      };
    }
    return {
      id,
      title: info.title,
      poster: info.poster || undefined,
      year: "",
      desc: info.username ? "@" + info.username : "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "av123",
          sourceName: "123av.fun",
          episodes: [{ playUrl: info.src, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 imgcaches CDN 上的 HLS master。CDN CORS 全开、不校验 Referer/UA。
    return {
      url: playUrl,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 从 /explore 抓站点热门搜索词(/search/q-<kw> 链接),当分类用,缓存一天。 */
  async _fetchHotTerms(ctx) {
    const CK = "av123:terms:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    let html;
    try {
      html = await this._getHtml(ctx, "/explore");
    } catch (e) {
      return [];
    }
    const out = [];
    const seen = {};
    const re = /\/search\/q-([^"'\/\s]+)/g;
    let m;
    while ((m = re.exec(String(html || ""))) !== null) {
      let kw = m[1];
      try {
        kw = decodeURIComponent(kw);
      } catch (e) {
        /* keep raw */
      }
      kw = kw.trim();
      if (!kw || seen[kw]) continue;
      seen[kw] = true;
      out.push(kw);
      if (out.length >= 40) break;
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

  _firstTag(tags) {
    if (!tags || typeof tags !== "string") return undefined;
    const first = tags.split(/[,，\s]+/).filter(Boolean)[0];
    return first ? this._decode(first) : undefined;
  },

  _remarks(c) {
    const bits = [];
    if (c.duration) {
      const s = parseInt(c.duration, 10);
      if (s > 0) {
        const mm = Math.floor(s / 60);
        const ss = s % 60;
        bits.push(
          (mm < 10 ? "0" + mm : mm) + ":" + (ss < 10 ? "0" + ss : ss)
        );
      }
    }
    if (c.playcount) {
      const n = parseInt(c.playcount, 10);
      if (n > 0) bits.push(this._humanCount(n) + " 播放");
    }
    return bits.length ? bits.join(" · ") : undefined;
  },

  _humanCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  },

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|hong\s*kong|中文|中国|中國|台湾|台灣|香港|抖音|国产|國產/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番|无码|無碼/i.test(s)) return 1;
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
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  },
};
