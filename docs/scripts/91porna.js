/**
 * 91Porna (91porna.com) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 91porna 属 91porn / caoporn 一脉的国产成人视频站,PHP 后端(X-Powered-By: PHP/7.3),
 *    整站【服务端渲染 HTML】(jQuery + requireJS,非 SPA / 非 JSON API)。
 *    首页响应头虽带 `Access-Control-Allow-Headers: content-type,token`,但实测并无
 *    可匿名调用的 /api JSON 列表接口 —— 列表/搜索/详情全部是 HTML 页面,用 cheerio 解。
 *  - 【Cloudflare】整站托管在 Cloudflare 后。Rust ureq(HTTP/1.1 + rustls)指纹会被 CF
 *    403/reset,故【每个 ctx.request.* 都必须带 http2:true】走 reqwest 栈 —— 硬性要求。
 *  - 【无年龄门 / 无 cookie 门】实测首页/列表/详情/播放全程匿名可取,无需 age_verified
 *    cookie 或跳转 warning 页。
 *
 *  - 【列表 / 浏览】GET /comic/index/video?category=<cat>[&page=N]  (N>1 才带 page)
 *      cat 实测有:play(正在播放) / new_update(最新) / now_month_hot(本月最热) / original(原创)。
 *      返回 HTML,视频卡在 ul.video-items > li .video-item 里:
 *        · 详情链接  a[href="/comic/index/detail?video_key=<id>"]
 *        · 封面      img[data-src]  (加密封面,见下)
 *        · 标题      .line-clamp-* 文本 或 img[alt]
 *      翻页:页面含 <link rel="next" ...> 或 /?...&page=N+1 即有下一页。
 *  - 【搜索】GET /comic/index/search?keyword=<kw>[&page=N]  —— 同款 .video-item 网格。
 *  - 【详情】GET /comic/index/detail?video_key=<id>
 *      页内有 <script type="application/ld+json"> 的 VideoObject(name/description/
 *      embedUrl),播放器容器 #mse[data-video_id]。detail 只需拿 id 即可解播放。
 *
 *  - 【封面加密】列表/详情里的 img[data-src] 指向 pic.xmbvxj.cn/...jpeg?auth_key=...,
 *      但【多数是 AES-CBC 密文】(key='f5d965df75336270' iv='97b60394abc2fbe1',
 *      Pkcs7,前端 lazyload.js 取回后本地解密再 createObjectURL)。少数为明文图
 *      (前端有"解密失败即明文"兜底)。DouyTV 的 dyproxy 只透传字节、无法 AES 解密,
 *      故密文封面在 App 内无法显示(会走占位图),明文封面正常。仍照常回传 URL。
 *
 *  - 【播放解析】(2026-08 实测,经 127.0.0.1:7897 代理匿名验证,两条视频复现):
 *      详情页不含直链,播放器由 embed 页驱动,两跳 P.A.C.K.E.R 解包:
 *      1) GET /comic/index/embed?id=<id>  → 页内 document.write 一段 packed eval,
 *         解包后写出 <script src="/index/embed_play.js?u=<HEX>&t=<T>">。
 *         其中 <HEX> 是【按视频固定】的加密路径(120+ 位十六进制),
 *         T = parseInt(Date.now()/1000/2100)(约 35 分钟一个时间窗)。img 参数可省。
 *      2) GET /index/embed_play.js?u=<HEX>&t=<T>  → 又一段 packed eval,解包后是
 *         <source src="https://yd-hls.utxxds.cn/videos5/<h>/<h>.m3u8?auth_key=...&via=91porna&via_bm=dx">
 *      → 该 m3u8 实测匿名 200(AES-128 HLS),KEY 在 tp1.xmbvxj.cn/.../crypt.key、
 *        分片在 tp1.xmbvxj.cn/....ts,两者 auth_key 均已内嵌在 m3u8 正文里,
 *        hls.js 直接顺着拉即可,无需额外签名。CDN 不校验 Referer/UA。
 *
 * 实测证据 (2026-08-01,全程经代理匿名):
 *  - LIST:   /comic/index/video?category=play → 200,ul.video-items 网格 + rel=next。
 *            category 另有 new_update / now_month_hot / original。
 *  - SEARCH: /comic/index/search?keyword=人妻 → 200,同款 .video-item 网格 + &page=2。
 *  - DETAIL: /comic/index/detail?video_key=383954 → 200,JSON-LD VideoObject + #mse。
 *  - PLAY:   embed?id=383954 解出 u=b69a652c...(160 hex);embed_play.js 解出
 *            https://yd-hls.utxxds.cn/videos5/f83b1db2.../f83b1db2....m3u8?auth_key=...
 *            → 该 m3u8 GET 200 #EXTM3U(AES-128),crypt.key GET 200(16B)。
 *  - 国内直连被墙 → 「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 */
return {
  meta: {
    name: "91Porna",
    author: "DouyTV",
    version: "0.1.0",
    description: "91porna.com 国产成人视频(Cloudflare + 服务端渲染,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://91porna.com";
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
    const sources = [
      { id: "play", name: "正在播放", group: "浏览" },
      { id: "new_update", name: "最新", group: "浏览" },
      { id: "now_month_hot", name: "本月最热", group: "浏览" },
      { id: "original", name: "原创", group: "浏览" },
    ];
    // 站点无独立分类页,分类即"标签搜索"。挑常见标签做入口(id 前缀 kw:)。
    const kw = [
      ["国产", "国产"],
      ["家庭乱伦", "乱伦"],
      ["熟女", "熟女"],
      ["人妻", "人妻"],
      ["巨乳", "巨乳"],
      ["探花", "探花"],
      ["按摩", "按摩"],
      ["换妻", "换妻"],
      ["三级片", "三级片"],
      ["内射", "内射"],
      ["萝莉", "萝莉"],
      ["黑人", "黑人"],
      ["3P", "3P"],
      ["SM", "SM"],
      ["动漫", "动漫"],
      ["AV女优片", "AV女优"],
    ];
    for (const [k, n] of kw) {
      sources.push({ id: "kw:" + k, name: n, group: "分类" });
    }
    return sources;
  },

  /* ───────────────────────── 列表 / 搜索 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "play";
    if (id.indexOf("kw:") === 0) {
      return this._feedSearch(ctx, p, id.slice("kw:".length));
    }
    return this._feedBrowse(ctx, p, id);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feedSearch(ctx, p, kw);
  },

  /** 浏览:/comic/index/video?category=<cat>[&page=N]。 */
  async _feedBrowse(ctx, page, cat) {
    const base = this._base(ctx);
    let url = base + "/comic/index/video?category=" + encodeURIComponent(cat);
    if (page > 1) url += "&page=" + page;
    return this._fetchGrid(ctx, url, page);
  },

  /** 搜索:/comic/index/search?keyword=<kw>[&page=N]。 */
  async _feedSearch(ctx, page, keyword) {
    const base = this._base(ctx);
    let url =
      base + "/comic/index/search?keyword=" + encodeURIComponent(keyword);
    if (page > 1) url += "&page=" + page;
    return this._fetchGrid(ctx, url, page);
  },

  async _fetchGrid(ctx, url, page) {
    let res;
    try {
      res = await this._get(ctx, url);
    } catch (e) {
      return { list: [], page, pageCount: page, total: 0 };
    }
    if (res.status === 404) return { list: [], page, pageCount: page, total: 0 };
    if (!res.ok) throw new Error("91Porna HTTP " + res.status + " @ " + url);
    const html = await res.text();

    const items = this._parseGrid(ctx, html);
    const list = [];
    for (const it of items) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    // 有 <link rel="next"> 或 page=N+1 链接则继续翻。
    const hasMore =
      /rel=["']next["']/i.test(html) ||
      new RegExp("[?&]page=" + (page + 1) + "\\b").test(html);
    return {
      list,
      page,
      pageCount: hasMore && list.length ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * cheerio 解 .video-item 网格。每卡:
   *   a[href*="detail?video_key="] → 详情链接(取 video_key 作 id)
   *   img[data-src]                → 封面(加密,见头注)
   *   .line-clamp-* 文本 / img[alt] → 标题
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
    $(".video-item").each(function () {
      const el = $(this);
      let id = "";
      el.find('a[href*="video_key="]').each(function () {
        if (id) return;
        const href = $(this).attr("href") || "";
        const m = href.match(/video_key=(\d+)/);
        if (m) id = m[1];
      });
      if (!id || seen[id]) return;
      seen[id] = true;
      // 封面:优先懒加载 data-src(真实图),回退 src。
      let poster = "";
      el.find("img").each(function () {
        if (poster) return;
        const src = $(this).attr("data-src") || $(this).attr("src") || "";
        if (src && !/^data:/.test(src) && !/poster_loading\.svg/i.test(src)) {
          poster = self._decode(src);
        }
      });
      // 标题:标题块文本 → img alt。
      let title = self._decode(
        (el.find(".line-clamp-2,.line-clamp-1").first().text() || "").trim()
      );
      if (!title) {
        title = self._decode((el.find("img").first().attr("alt") || "").trim());
      }
      if (!title) title = id;
      out.push({ id, title, poster });
    });
    // 极端兜底:cheerio 没抓到卡片时,整页正则扫 video_key。
    if (!out.length) {
      const re = /detail\?video_key=(\d+)/g;
      let m;
      while ((m = re.exec(html))) {
        if (seen[m[1]]) continue;
        seen[m[1]] = true;
        out.push({ id: m[1], title: m[1], poster: "" });
      }
    }
    return out;
  },

  /** grid item → ScriptVodItem;标题/封面缓存供 detail 复用。 */
  _toVod(it) {
    if (!it || !it.id) return null;
    const title = it.title || it.id;
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[it.id] = { title, poster: it.poster || "" };
    const vod = { id: String(it.id), title };
    if (it.poster) {
      vod.poster = it.poster;
      // 封面在 pic.xmbvxj.cn / expose.eisees.com 等 CDN,带上 Referer 防盗链。
      vod.poster_headers = { Referer: "https://91porna.com/" };
    }
    return vod;
  },

  /* ───────────────────────── 详情 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const vid = String(id).replace(/[^0-9]/g, "") || String(id);
    let info = this._pendingCache && this._pendingCache[vid];
    if (!info) {
      // 抓详情页,从 JSON-LD VideoObject 取标题/简介/封面。
      try {
        const res = await this._get(
          ctx,
          this._base(ctx) + "/comic/index/detail?video_key=" + encodeURIComponent(vid)
        );
        if (res.ok) {
          const html = await res.text();
          info = this._parseDetail(html);
        }
      } catch (e) {
        /* ignore, 下面兜底 */
      }
    }
    if (!info) info = { title: vid, poster: "", desc: "" };

    const vod = {
      id: vid,
      title: info.title || vid,
      year: "",
      desc: info.desc || "",
      playbacks: [
        {
          sourceId: sourceId || "91porna",
          sourceName: "91Porna",
          episodes: [{ playUrl: "id:" + vid, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
    if (info.poster) {
      vod.poster = info.poster;
      vod.poster_headers = { Referer: "https://91porna.com/" };
    }
    return vod;
  },

  /** 从详情页 HTML 的 JSON-LD VideoObject 抽 title/desc/poster。 */
  _parseDetail(html) {
    const out = { title: "", poster: "", desc: "" };
    // JSON-LD 里 @type:VideoObject 的 name/description/thumbnailUrl。
    const blocks = html.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    if (blocks) {
      for (const b of blocks) {
        const jm = b.match(/>([\s\S]*?)<\/script>/i);
        if (!jm) continue;
        let data;
        try {
          data = JSON.parse(jm[1]);
        } catch (e) {
          continue;
        }
        const graph =
          (data && data["@graph"]) || (Array.isArray(data) ? data : [data]);
        for (const node of Array.isArray(graph) ? graph : []) {
          if (!node) continue;
          const t = node["@type"];
          const isVideo =
            t === "VideoObject" || (Array.isArray(t) && t.indexOf("VideoObject") >= 0);
          if (!isVideo) continue;
          if (node.name) out.title = this._decode(String(node.name));
          if (node.description) out.desc = this._decode(String(node.description));
          const thumb = node.thumbnailUrl;
          if (thumb) {
            out.poster = this._decode(
              String(Array.isArray(thumb) ? thumb[0] : thumb)
            );
          }
          if (out.title) return out;
        }
      }
    }
    // 兜底:<title> 与 #mse 缩略图。
    if (!out.title) {
      const tm = html.match(/<title>([^<]*)<\/title>/i);
      if (tm) out.title = this._decode(tm[1].split(/[-|]/)[0].trim());
    }
    return out;
  },

  /* ───────────────────────── 播放解析 ───────────────────────── */

  async resolvePlayUrl(ctx, { playUrl }) {
    let id = String(playUrl || "");
    if (id.indexOf("id:") === 0) id = id.slice(3);
    id = id.replace(/[^0-9]/g, "");
    if (!id) throw new Error("91Porna: 无效视频 id @ " + playUrl);

    const base = this._base(ctx);

    // 1) embed 页 → 解包 → 取按视频固定的加密路径 u(120+ hex)。
    const embRes = await this._get(
      ctx,
      base + "/comic/index/embed?id=" + encodeURIComponent(id),
      base + "/comic/index/detail?video_key=" + id
    );
    if (!embRes.ok) throw new Error("91Porna: embed HTTP " + embRes.status);
    const embHtml = await embRes.text();
    const u = this._extractU(embHtml);
    if (!u) throw new Error("91Porna: 未从 embed 页解出加密路径 u(结构可能已变)");

    // 2) embed_play.js?u=&t= → 解包 → 取 m3u8。t 为 ~35 分钟时间窗。
    const t = Math.floor(Date.now() / 1000 / 2100);
    const playRes = await this._get(
      ctx,
      base + "/index/embed_play.js?u=" + encodeURIComponent(u) + "&t=" + t,
      base + "/comic/index/embed?id=" + id
    );
    if (!playRes.ok) throw new Error("91Porna: embed_play HTTP " + playRes.status);
    const playJs = await playRes.text();
    const m3u8 = this._extractM3u8(playJs);
    if (!m3u8) {
      throw new Error("91Porna: 未从 embed_play.js 解出 m3u8(解包/结构可能已变)");
    }

    return {
      url: m3u8,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: base + "/",
      },
    };
  },

  /** embed 页里加密视频路径 u —— packed 载荷中一段 120+ 位十六进制字面量。 */
  _extractU(embedHtml) {
    const m = String(embedHtml).match(/[0-9a-f]{120,}/i);
    return m ? m[0] : "";
  },

  /** 解包 embed_play.js 后,抽出 m3u8 直链。 */
  _extractM3u8(playJs) {
    const decoded = this._unpack(playJs) || String(playJs);
    // 解包后可能仍带转义的 \/,先扫 m3u8 再把 \/ 收成 /。
    const src =
      decoded.match(/https?:\\?\/\\?\/[^"'\\\s]+\.m3u8[^"'\\\s]*/i) || null;
    if (!src) return "";
    return src[0].replace(/\\\//g, "/").replace(/\\/g, "");
  },

  /**
   * Dean Edwards P.A.C.K.E.R 解包器。匹配尾部
   *   }(  'payload', radix, count, 'w0|w1|...'.split('|') ...)
   * 还原字典替换。用于 embed 页与 embed_play.js 两处 eval。
   */
  _unpack(code) {
    const m = String(code).match(
      /\}\s*\(\s*'((?:\\.|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'])*)'\.split\('\|'\)/
    );
    if (!m) return "";
    let payload = m[1];
    const radix = parseInt(m[2], 10);
    const count = parseInt(m[3], 10);
    const words = m[4].split("|");
    payload = payload.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    function enc(c) {
      return (
        (c < radix ? "" : enc(Math.floor(c / radix))) +
        ((c = c % radix) > 35 ? String.fromCharCode(c + 29) : c.toString(36))
      );
    }
    const dict = {};
    for (let i = count - 1; i >= 0; i--) dict[enc(i)] = words[i] || enc(i);
    return payload.replace(/\b\w+\b/g, function (w) {
      return Object.prototype.hasOwnProperty.call(dict, w) ? dict[w] : w;
    });
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

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
