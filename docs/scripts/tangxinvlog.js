/**
 * 糖心Vlog (tangxinvlog.app) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 糖心Vlog 是国产 NSFW 工作室聚合站,前端是【Astro v6 静态站】(generator meta 可证),
 *    没有 JSON API —— 所有数据都直接渲染在 HTML 里,用 cheerio 抓 <article class="card"> 网格。
 *  - 视频直链是【规律 HLS】: 每个视频 /v/{id}/ 详情页里,播放器 inline <script> 和 JSON-LD
 *    VideoObject.contentUrl 都给同一个地址:
 *        https://t.5gcdn.xyz/videos/{id}/index.m3u8
 *    id 就是列表卡片 href="/v/{id}/" 里的数字。封面同域:.../videos/{id}/cover.jpg。
 *  - 【CDN t.5gcdn.xyz 强校验 Referer】: 不带 Referer → 403;带 Referer: https://tangxinvlog.app/
 *    → 200。m3u8 是 AES-128 加密(#EXT-X-KEY URI="enc.key" 相对路径)+ 相对 segN.ts 分段,
 *    hls.js 会基于 manifest URL 自动补全相对路径,DouyTV 的 dyproxy 也会把相对段回写代理,
 *    所以只要把 Referer 头交给 App(resolve 的 headers + 封面的 poster_headers)即可正常播/出图。
 *  - 【CDN 与站点是两个不同的 Cloudflare 区】: 站点页面(tangxinvlog.app)对 curl 直接放行,
 *    但 t.5gcdn.xyz 会对非浏览器 TLS 指纹发 JS 挑战 —— 脚本里所有请求统一带 http2:true 走
 *    reqwest(h2)栈,指纹接近浏览器,实测可过(与 nudetik/sharesome 同款做法)。
 *  - 分页(全部 307 到带尾斜杠的路径,脚本统一带尾斜杠请求以免多一跳):
 *      最新/精选: /featured/            (第 1 页) | /featured/{N}/            (N>1)
 *      标签:      /tag/{标签}/           (第 1 页) | /tag/{标签}/{N}/           (N>1)
 *      演员/出品方:/a/{名字}/            (第 1 页) | /a/{名字}/{N}/            (N>1)
 *    每页 24~25 条;页脚 "第 X / Y 页" 给总页数,<link rel=next> 给下一页,据此判断是否翻页。
 *  - 【搜索】站点自带的 /search/ 是纯客户端 Pagefind(WASM,读 /pagefind/*),脚本层无法直接查。
 *    改用站点的标签/演员体系近似搜索:关键词优先当【标签】拉 /tag/{kw}/,再当【演员】拉 /a/{kw}/,
 *    合并去重。站点标签 slug 基本就是中文词本身(如 /tag/巨乳/),命中率高。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-31,全程匿名,经 127.0.0.1:7897 代理):
 *  - LIST: GET /featured/ → 200,article.card 24 条,href=/v/35877/,img=t.5gcdn.xyz/videos/35877/cover.jpg,
 *          页脚 "第 1 / 138 页";/tag/巨乳/ → 25 条 "第 1 / 74 页";/a/桥本香菜/ → 24 条 "第 1 / 4 页"。
 *  - DETAIL: GET /v/35877/ → JSON-LD contentUrl + inline m3u8 = https://t.5gcdn.xyz/videos/35877/index.m3u8,
 *            tags(巨乳/女神/…)、nickname(@糖心AI创意短剧)、duration、poster 均在页内。
 *  - PLAY: GET .../videos/35877/index.m3u8 —— 无 Referer 403;带 Referer:tangxinvlog.app/ → 200
 *          audio/x-mpegurl(AES-128,seg0.ts…);seg0.ts → 200 7MB 视频字节。cover.jpg 同样需 Referer。
 */
return {
  meta: {
    name: "糖心Vlog",
    author: "DouyTV",
    version: "0.1.0",
    description: "糖心Vlog 国产精品聚合(HLS,成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://tangxinvlog.app";
  },

  // 视频/封面所在的独立 CDN(可覆盖,以防站方换 CDN)。
  _cdn(ctx) {
    const c = ctx.config && ctx.config.get && ctx.config.get("cdn");
    return (typeof c === "string" && c) || "https://t.5gcdn.xyz";
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
      Referer: this._base(ctx) + "/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  // CDN(封面/流)统一走站点 Referer —— 不带会 403(实测)。App 拿这组头去
  // wrapImage / 播放解析里带上。
  _mediaHeaders(ctx) {
    return {
      "User-Agent": this._ua(ctx),
      Referer: this._base(ctx) + "/",
    };
  },

  // 抓 HTML(全站 http2:true 走 reqwest h2 栈,过 CDN/站点的 TLS 指纹校验)。
  async _get(ctx, path) {
    const url = /^https?:\/\//i.test(path) ? path : this._base(ctx) + path;
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
      http2: true,
    });
    return res;
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  // 站点有 203 个标签(/tag/),这里挑高频、覆盖面广的一批做「标签」分类;
  // 另加几个站方主推的出品方/演员做「演员」分类。slug 用中文原词,构造 URL 时逐段编码。
  _tagCats() {
    return [
      "原创", "剧情", "反差", "萝莉", "御姐", "人妻", "少妇", "熟女",
      "巨乳", "白虎", "丝袜", "美腿", "制服", "JK", "cospaly", "调教",
      "母狗", "SM", "捆绑", "户外", "露出", "自慰", "潮喷", "口交",
      "颜射", "内射", "3P", "群P", "肛交", "约炮", "偷拍", "网红",
      "主播", "探花", "福利姬", "国产AV", "黑料正能量", "onlyfans", "韩国", "欧美",
    ];
  },

  _actorCats() {
    return [
      "桥本香菜", "情深叉喔", "饼干姐姐", "小欣奈", "星野兔",
      "Yuzukitty柚子猫", "Nana_taipei", "糖心AI创意短剧",
    ];
  },

  async getSources() {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    for (const t of this._tagCats()) {
      sources.push({ id: "tag:" + t, name: t, group: "标签" });
    }
    for (const a of this._actorCats()) {
      sources.push({ id: "actor:" + a, name: a, group: "演员" });
    }
    return sources;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  // 把一个路径段中文安全编码(标签/演员名可能含中文、空格、连字符)。
  _seg(s) {
    return encodeURIComponent(String(s || ""));
  },

  // 造分页路径:第 1 页无页码,>1 用 /{N}/(统一带尾斜杠,避免 307 多跳)。
  _pagePath(prefix, page) {
    return page > 1 ? prefix + page + "/" : prefix;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    if (id.indexOf("tag:") === 0) {
      const slug = id.slice("tag:".length);
      return this._feed(ctx, this._pagePath("/tag/" + this._seg(slug) + "/", p), p);
    }
    if (id.indexOf("actor:") === 0) {
      const name = id.slice("actor:".length);
      return this._feed(ctx, this._pagePath("/a/" + this._seg(name) + "/", p), p);
    }
    return this._feed(ctx, this._pagePath("/featured/", p), p);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };

    // 无脚本级搜索接口 —— 用标签体系近似:先当标签,再当演员,合并去重。
    const seg = this._seg(kw);
    const tag = await this._feed(ctx, this._pagePath("/tag/" + seg + "/", p), p);
    let list = tag.list;
    let pageCount = tag.pageCount;

    // 标签这一页没结果 → 试演员页(演员名往往整串匹配)。
    if (!list.length) {
      const actor = await this._feed(ctx, this._pagePath("/a/" + seg + "/", p), p);
      list = actor.list;
      pageCount = actor.pageCount;
    } else if (p === 1) {
      // 标签有结果时,第 1 页再补一批演员命中(去重),让首屏更全。
      const actor = await this._feed(ctx, "/a/" + seg + "/", 1);
      const seen = {};
      for (const v of list) seen[v.id] = true;
      for (const v of actor.list) {
        if (!seen[v.id]) {
          seen[v.id] = true;
          list.push(v);
        }
      }
    }

    return { list, page: p, pageCount, total: list.length };
  },

  /**
   * 抓一个列表页,解 <article class="card"> 网格 → {list, pageCount}。
   * 翻过尾页 / 无此标签/演员 → 404,视作无更多。
   */
  async _feed(ctx, path, page) {
    const res = await this._get(ctx, path);
    if (res.status === 404) return { list: [], page, pageCount: page, total: 0 };
    if (!res.ok) throw new Error("糖心Vlog HTTP " + res.status + " @ " + path);
    const html = await res.text();

    const items = this._parseGrid(ctx, html);
    const list = [];
    for (const it of items) {
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }

    // 总页数:页脚 "第 X / Y 页";拿不到就看有没有 rel=next / 下一页链接。
    let pageCount = page;
    const mTotal = html.match(/\/\s*(\d+)\s*页/);
    if (mTotal) {
      const total = parseInt(mTotal[1], 10) || page;
      if (total > page) pageCount = page + 1;
    } else if (
      /rel=["']next["']/.test(html) ||
      new RegExp("/(?:featured|tag/[^\"']+|a/[^\"']+)/" + (page + 1) + "/?[\"']").test(html)
    ) {
      pageCount = page + 1;
    }
    return { list, page, pageCount, total: list.length };
  },

  /**
   * cheerio 解 article.card 网格,抽 { id, title, poster }。
   *  - 卡片链接: a.cover-link / a[href^="/v/"],href=/v/{id}/
   *  - 标题:     aria-label / h3.title a 文本 / img alt
   *  - 封面:     img src(t.5gcdn.xyz/videos/{id}/cover.jpg)
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
    $("article.card").each(function () {
      const el = $(this);
      let id = "";
      let title = "";
      el.find("a[href]").each(function () {
        if (id) return;
        const href = $(this).attr("href") || "";
        const m = href.match(/\/v\/(\d+)\/?/);
        if (!m) return;
        id = m[1];
        title = self._decode(($(this).attr("aria-label") || "").trim());
      });
      if (!id || seen[id]) return;
      seen[id] = true;
      if (!title) {
        title = self._decode((el.find("h3.title a").first().text() || "").trim());
      }
      let poster = "";
      el.find("img").each(function () {
        if (poster) return;
        const src = $(this).attr("src") || $(this).attr("data-src") || "";
        if (src && !/^data:/.test(src)) poster = self._decode(src);
      });
      if (!title) {
        title = self._decode((el.find("img").first().attr("alt") || "").trim());
      }
      // 时长(卡片右下角)当 remarks
      const dur = self._decode((el.find(".duration").first().text() || "").trim());
      out.push({ id, title: title || id, poster, dur });
    });
    return out;
  },

  /** grid item → ScriptVodItem。同时缓存供 detail 免二次抓页。 */
  _toVod(ctx, it) {
    if (!it || !it.id) return null;
    const poster = it.poster || this._cdn(ctx) + "/videos/" + it.id + "/cover.jpg";
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[it.id] = {
      title: it.title,
      poster,
      dur: it.dur || "",
    };
    return {
      id: it.id,
      title: it.title,
      poster,
      // CDN 封面校验 Referer,给 App 走代理带头的那组。
      poster_headers: this._mediaHeaders(ctx),
      vod_remarks: it.dur || undefined,
    };
  },

  /* ───────────────────────── 详情 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const vid = String(id).replace(/[^\d]/g, "") || String(id);
    const cached = (this._pendingCache && this._pendingCache[vid]) || {};

    let title = cached.title || vid;
    let poster = cached.poster || this._cdn(ctx) + "/videos/" + vid + "/cover.jpg";
    let desc = "";
    let author = "";
    let tags = "";
    // 直链默认按规律构造,详情页能解出 contentUrl 就用页内的(更权威)。
    let m3u8 = this._cdn(ctx) + "/videos/" + vid + "/index.m3u8";

    try {
      const res = await this._get(ctx, "/v/" + vid + "/");
      if (res.ok) {
        const html = await res.text();
        const info = this._parseDetail(ctx, html);
        if (info.title) title = info.title;
        if (info.poster) poster = info.poster;
        if (info.desc) desc = info.desc;
        if (info.author) author = info.author;
        if (info.tags) tags = info.tags;
        if (info.m3u8) m3u8 = info.m3u8;
      }
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("糖心Vlog 详情抓取失败:", String(e));
    }

    return {
      id: vid,
      title,
      poster,
      poster_headers: this._mediaHeaders(ctx),
      year: "",
      desc: desc || (tags ? "标签: " + tags : ""),
      type_name: author || undefined,
      playbacks: [
        {
          sourceId: sourceId || "tangxinvlog",
          sourceName: "糖心Vlog",
          episodes: [
            { playUrl: m3u8, needResolve: true, title: "正片", type: "hls" },
          ],
          episodes_titles: ["正片"],
        },
      ],
    };
  },

  /** 解 /v/{id}/ 详情页:标题、封面、简介、演员、标签、m3u8 直链。 */
  _parseDetail(ctx, html) {
    const info = {};

    // 优先 JSON-LD VideoObject(contentUrl 是权威直链)。
    try {
      const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = re.exec(html))) {
        let data;
        try {
          data = JSON.parse(m[1].trim());
        } catch (e) {
          continue;
        }
        const objs = Array.isArray(data) ? data : [data];
        for (const o of objs) {
          if (o && o["@type"] === "VideoObject") {
            if (o.contentUrl && /\.m3u8/i.test(o.contentUrl)) info.m3u8 = o.contentUrl;
            if (o.name) info.title = this._decode(String(o.name));
            if (o.thumbnailUrl) info.poster = String(o.thumbnailUrl);
            if (o.description && o.description !== "当前暂无简介") {
              info.desc = this._decode(String(o.description));
            }
            if (o.keywords) info.tags = this._decode(String(o.keywords));
            if (o.creator && o.creator.name) info.author = this._decode(String(o.creator.name));
          }
        }
      }
    } catch (e) {
      /* ignore */
    }

    // 兜底:inline 播放器脚本里的 const m3u8 = "...";
    if (!info.m3u8) {
      const mm = html.match(/m3u8\s*=\s*["']([^"']+\.m3u8[^"']*)["']/i);
      if (mm) info.m3u8 = mm[1];
    }

    // cheerio 补标题/标签(JSON-LD 缺时)。
    if (!info.title || !info.tags) {
      let $ = null;
      try {
        $ = ctx.html.load(html);
      } catch (e) {
        $ = null;
      }
      if ($) {
        if (!info.title) {
          info.title = this._decode(($("h1").first().text() || "").trim());
        }
        if (!info.author) {
          info.author = this._decode(($(".byline .nickname").first().text() || "").trim());
        }
        if (!info.tags) {
          const ts = [];
          $(".tags a.tag").each(function () {
            const t = ($(this).text() || "").trim();
            if (t) ts.push(t);
          });
          if (ts.length) info.tags = ts.join("、");
        }
      }
    }
    return info;
  },

  /* ───────────────────────── 播放解析 ───────────────────────── */

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    // 兼容存了 "id:{n}" 或纯数字的情况 —— 按规律补 m3u8。
    if (/^id:/i.test(url)) url = url.slice(3);
    if (/^\d+$/.test(url)) {
      url = this._cdn(ctx) + "/videos/" + url + "/index.m3u8";
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("糖心Vlog: 无效播放地址 @ " + playUrl);
    }
    const isHls = /\.m3u8(\?|$)/i.test(url);
    return {
      url,
      type: isHls ? "hls" : "mp4",
      // CDN 强校验 Referer(不带 403);UA 用浏览器 UA。
      headers: this._mediaHeaders(ctx),
    };
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
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },
};
