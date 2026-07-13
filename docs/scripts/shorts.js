/**
 * Shorts.XXX 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Shorts.XXX (https://www.shorts.xxx/) 是服务端渲染的成人竖屏短视频 tube 站
 *    (Apache/2.2 + jQuery, 无对外 JSON 数据 API)。
 *  - 列表数据统一走 AJAX 分页端点 GET /loader2.php,返回 { content:<HTML>, total, ... },
 *    content 里是一串 <div class="box" id="box<ID>" data-creator=...> 节点,每个含
 *    <source src="/content/server2/.../<uuid>.mp4?exp=<ts>&sig=<hash>"> —— 站内同域签名直链。
 *  - 浏览分类是「排序模式」而非标签体系: order 空=首页/最新, 1=Newest, 2=Popular,
 *    3=Best, 4=Random。站点没有 tag 分类页,所以「亚洲」相关分类用 *搜索关键字* 合成
 *    (search= 服务端真实过滤,实测 asian/japanese/korean/chinese/thai/hentai 均有结果)。
 *  - 详情/播放: GET /post/<ID> 返回带该视频 box 的整页 HTML,内含 *新鲜* 签名 source。
 *    签名 URL 带 exp(约 1 小时过期),故 needResolve:true —— 播放前用 /post/<ID> 重新取一次
 *    保证 sig 不过期。source 是同域 /content/... 相对路径,拼上 base 即绝对直链。
 *  - CDN/直链实测不校验 Referer(仅 sig),但仍回传像样 UA + Referer。
 *  - 国内直连被墙,请在「设置 → 代理」配代理,scriptFetch 与播放代理都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 列表:  GET /loader2.php?adsadded=1&orientation=1&showfavorites=0&showfeed=0
 *                &post=&search=<kw>&order=<0-4>&p=<page>
 *           → 200 application/json, content 内 30 个 box (无 cookie 亦可)。
 *           order: ""=首页 1=Newest 2=Popular 3=Best 4=Random。search= 真实过滤。
 *  - 详情:  GET /post/<ID> → 200 HTML,含 id="box<ID>" 的 box + 新鲜签名 <source>。
 *  - 播放:  <source> 是 /content/server2/<x>/<uuid>.mp4?exp=&sig= (同域)。
 *           实测 HEAD/Range → 206 Content-Type: video/mp4 (Accept-Ranges: bytes)。
 *  - 封面:  https://shorts-img.b-cdn.net/<n>/<hash>.jpg?token=&expires= (匿名 200)。
 */
return {
  meta: {
    name: "Shorts.XXX",
    author: "DouyTV",
    version: "0.1.0",
    description: "Shorts.XXX 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** 站点基址,可用脚本 config.base 覆盖(万一换域名)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://www.shorts.xxx";
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
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      Referer: this._base(ctx) + "/",
      Accept: json
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  /* ─────────────────────────── getSources ─────────────────────────── */

  async getSources(ctx) {
    // 「亚洲」搜索关键字合成的伪分类(站点无 tag 体系,search= 服务端真实过滤)。
    const asian = [
      { kw: "asian", name: "亚洲 Asian" },
      { kw: "japanese", name: "日本 Japanese" },
      { kw: "korean", name: "韩国 Korean" },
      { kw: "chinese", name: "中文 Chinese" },
      { kw: "thai", name: "泰国 Thai" },
      { kw: "hentai", name: "里番 Hentai" },
    ];
    const sources = [];
    for (const a of asian) {
      sources.push({ id: "kw:" + a.kw, name: a.name, group: "亚洲" });
    }
    // 排序浏览入口(order 值来自站点页面内联 var order)。
    sources.push({ id: "latest", name: "首页 Home", group: "浏览" });
    sources.push({ id: "order:1", name: "最新 Newest", group: "浏览" });
    sources.push({ id: "order:2", name: "热门 Popular", group: "浏览" });
    sources.push({ id: "order:3", name: "精选 Best", group: "浏览" });
    sources.push({ id: "order:4", name: "随机 Random", group: "浏览" });
    return sources;
  },

  /* ─────────────────────────── recommend ─────────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    if (id.indexOf("kw:") === 0) {
      // 搜索伪分类: search=<kw>, 排序用 Newest(1)。
      return this._feed(ctx, p, { search: id.slice("kw:".length), order: "1" });
    }
    if (id.indexOf("order:") === 0) {
      return this._feed(ctx, p, { order: id.slice("order:".length) });
    }
    // 首页 / latest → order 为空。
    return this._feed(ctx, p, { order: "" });
  },

  /* ─────────────────────────── search ─────────────────────────── */

  async search(ctx, { keyword, page }) {
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: page || 1, pageCount: page || 1, total: 0 };
    return this._feed(ctx, page || 1, { search: kw, order: "1" });
  },

  /* ─────────────────────────── 列表核心 ─────────────────────────── */

  /**
   * 通用列表: 调 /loader2.php 分页,解析 content HTML 里的 box 节点。
   * opts: { search?, order? }
   */
  async _feed(ctx, page, opts) {
    const q = {
      adsadded: 1,
      orientation: 1,
      showfavorites: 0,
      showfeed: 0,
      post: "",
      search: (opts && opts.search) || "",
      order: opts && opts.order != null ? opts.order : "",
      p: page,
    };
    const url = ctx.utils.buildUrl(this._base(ctx) + "/loader2.php", q);
    let data;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, true),
        timeout: 20000,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = res.json();
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Shorts.XXX loader2 失败:", url, String(e));
      return { list: [], page, pageCount: page, total: 0 };
    }
    const html = (data && data.content) || "";
    const list = this._parseBoxes(ctx, html);
    // 满 30(站点每页固定 30)认为还有下一页;翻过尾页 content 为空。
    const hasMore = list.length >= 30;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /** 解析 content/整页 HTML 里的所有 <div class="box" id="box<ID>"> 节点。 */
  _parseBoxes(ctx, html) {
    const list = [];
    if (!html || typeof html !== "string") return list;
    // 按 box 起点切块(用 id="box<num>" 作为切分锚点)。
    const parts = html.split(/<div class="box"/);
    for (let i = 1; i < parts.length; i++) {
      const chunk = parts[i];
      const vod = this._boxToVod(ctx, chunk);
      if (vod) list.push(vod);
    }
    return list;
  },

  /** 单个 box HTML 片段 → ScriptVodItem。顺便塞 _pendingCache 供 detail 命中。 */
  _boxToVod(ctx, chunk) {
    const idm = chunk.match(/\bid="box(\d+)"/);
    if (!idm) return null;
    const id = idm[1];
    // 排除广告 box (id="boxads" 之类不会匹配 \d+,这里再兜底跳过无 source 的)。
    const srcm = chunk.match(/<source[^>]*\bsrc="([^"]+)"/i);
    const posterm = chunk.match(/\bposter="([^"]+)"/i);
    const titlem = chunk.match(/<div class="title"[^>]*>([\s\S]*?)<\/div>/i);
    const creatorm = chunk.match(/\bdata-creator="([^"]*)"/i);
    if (!srcm) return null;

    const src = this._abs(ctx, srcm[1]);
    const poster = posterm ? posterm[1] : "";
    const title = this._decode(
      (titlem ? titlem[1] : "").replace(/<[^>]+>/g, " ")
    ).trim() || String(id);
    const creator = creatorm ? this._decode(creatorm[1]) : "";

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      src,
      poster,
      title,
      creator,
    };

    return {
      id: String(id),
      title,
      poster: poster || undefined,
      type_name: creator || undefined,
      vod_remarks: creator ? "@" + creator : undefined,
    };
  },

  /* ─────────────────────────── detail ─────────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    // 无论有没有缓存,都取一次 /post 拿新鲜签名 source(缓存里的可能已过期)。
    const fresh = await this._fetchPost(ctx, id);
    if (fresh) info = fresh;
    if (!info) throw new Error("Shorts.XXX: 未找到该视频 @ " + id);

    // playUrl 存 id,resolvePlayUrl 再取一次 /post 保证 sig 不过期。
    return {
      id,
      title: info.title || id,
      poster: info.poster || undefined,
      year: "",
      desc: info.creator ? "@" + info.creator : "",
      type_name: info.creator || undefined,
      playbacks: [
        {
          sourceId: sourceId || "shorts",
          sourceName: "Shorts.XXX",
          episodes: [{ playUrl: String(id), needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  /** GET /post/<id>,从整页 HTML 里抠出目标 box 的新鲜 source。 */
  async _fetchPost(ctx, id) {
    const url = this._base(ctx) + "/post/" + encodeURIComponent(id);
    let html;
    try {
      html = await ctx.request.getHtml(url, {
        headers: this._headers(ctx, false),
        timeout: 20000,
      });
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Shorts.XXX /post 失败:", url, String(e));
      return null;
    }
    if (!html || typeof html !== "string") return null;
    // 精确定位 id="box<id>" 所在的那一块。
    const anchor = 'id="box' + id + '"';
    const at = html.indexOf(anchor);
    let chunk;
    if (at >= 0) {
      // 从该 box 起点到下一个 box 起点之间。
      const start = html.lastIndexOf('<div class="box"', at);
      const from = start >= 0 ? start : at;
      const nextRel = html.slice(from + 8).indexOf('<div class="box"');
      chunk = nextRel >= 0 ? html.slice(from, from + 8 + nextRel) : html.slice(from);
    } else {
      chunk = html;
    }
    const srcm = chunk.match(/<source[^>]*\bsrc="([^"]+)"/i);
    if (!srcm) return null;
    const posterm = chunk.match(/\bposter="([^"]+)"/i);
    const titlem = chunk.match(/<div class="title"[^>]*>([\s\S]*?)<\/div>/i);
    const creatorm = chunk.match(/\bdata-creator="([^"]*)"/i);
    return {
      src: this._abs(ctx, srcm[1]),
      poster: posterm ? posterm[1] : "",
      title: this._decode(
        (titlem ? titlem[1] : "").replace(/<[^>]+>/g, " ")
      ).trim(),
      creator: creatorm ? this._decode(creatorm[1]) : "",
    };
  },

  /* ─────────────────────────── resolvePlayUrl ─────────────────────────── */

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 是视频 id;取一次 /post 拿新鲜签名直链(避免 exp 过期)。
    let src = "";
    if (/^\d+$/.test(String(playUrl))) {
      const info = await this._fetchPost(ctx, String(playUrl));
      if (info && info.src) src = info.src;
    } else if (/^https?:\/\//i.test(String(playUrl))) {
      // 兜底: 已是绝对直链就直接用。
      src = String(playUrl);
    }
    if (!src) throw new Error("Shorts.XXX: 无法解析播放直链 @ " + playUrl);
    return {
      url: src,
      type: "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _abs(ctx, u) {
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.charAt(0) === "/") return this._base(ctx) + u;
    return this._base(ctx) + "/" + u;
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
      .replace(/&plus;/g, "+")
      .replace(/&hellip;/g, "…")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },
};
