/**
 * 91短视频 / melonshort (91porna.com 的短视频频道) 源脚本 (DouyTV / MoonTV 兼容)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 91porna.com 是 PHP/Cloudflare 服务端渲染站;本脚本【只】覆盖它的短视频频道
 *    (路径 /melonshort,站内品牌名「91短视频」),与主站 91porna.com 脚本相互独立。
 *  - 全站 Cloudflare 托管,ureq/rustls 指纹会被 WAF 判 403 —— 所以每个 ctx.request.*
 *    调用都【必须】带 http2:true 走 reqwest 栈(项目既定修法,见 fyptt.js/nudetik.js)。
 *  - 【列表】站点自带干净的 JSON 网格接口(前端翻页 XHR 用的就是它):
 *      GET /melonshort/grid?cate_id={id}&page={N}
 *      → { code:200, data:{ list:[{ id, title, cover, cover_proxy, duration,
 *                                    detail_url, publish_iso, user_name, play_total }],
 *                           total, page, page_size(=20), total_pages } }
 *    cate_id=0 即「推荐/最新」全站流;分类用各自 cate_id(见下,来自详情页 ms-bootstrap)。
 *    HTML 分类页 /melonshort/{slug} 也在(浏览器可见路径),但 grid JSON 更干净、
 *    还带 total_pages,故列表统一走 grid。
 *  - 【分类】首页 /melonshort 内嵌 <script id="ms-bootstrap" type="application/json">,
 *    其 tags:[{ id, name, code, sort }] 就是分类清单(id 即 grid 的 cate_id):
 *      amateur=19 素人自拍 / zipai=14 原创自拍 / hunjian=18 高燃混剪 / fancha=17 反差系列 /
 *      wanghong=16 网红达人 / mingxing=15 明星大瓜 / ai=20 ai短视频。(动态解析,不写死)
 *  - 【详情】GET /melonshort/video/{id} 同样内嵌 ms-bootstrap,其 first_screen.list
 *    第一条(id 与页面 id 相同)就是本视频,含 title/cover/tags/user_name/video_duration/
 *    video_url。列表里也有【多条】video_url(related 视频),故必须【按 id 匹配】取本视频,
 *    不能盲取第一个匹配项 —— 用 ms-bootstrap 的结构化 list 精确定位。
 *  - 【播放】video_url 是 CDN yd-hls.utxxds.cn 上的 HLS m3u8,AES-128 加密
 *    (KEY / .ts 分片在另一台 tp2.xmbvxj.cn,manifest 里已是绝对 URL,dyproxy 会重写)。
 *    每条 video_url 带 ?auth_key=<epoch>-... 令牌;manifest 令牌 TTL 较宽(实测约 5 分钟前
 *    的令牌仍 200),但 KEY/.ts 的内层令牌是服务端每次拉 manifest 现签的。为稳妥,
 *    resolvePlayUrl 里【现抓详情页取新鲜 video_url】,playUrl 只存视频 id、绝不存旧令牌 URL。
 *  - 【CDN 头/鉴权】m3u8 拉取带不带 Referer 都 200(实测);令牌按 时间+出口IP 绑定 ——
 *    App 拉 manifest 与分片都走同一个用户代理(dyproxy 用配置的代理),出口 IP 一致故可播。
 *  - 【封面】cover(pic.xmbvxj.cn)带 auth_key,实测【匿名可取 200】,但带
 *    Referer: https://91porna.com/ 反而 404 —— 所以 poster_headers【只给 UA、不给 Referer】。
 *  - 【搜索】短视频频道无独立搜索端点(/melonshort/search 返 404),search 优雅返回空。
 *  - 国内直连被墙 → 「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-08-01,全程经 127.0.0.1:7897 代理):
 *  - LIST: GET /melonshort/grid?cate_id=0&page=1 → 200, data.total_pages=264, list 20 条,
 *          每条 {id, title, cover, duration, detail_url}。cate_id=19 → total_pages=63(分类过滤生效)。
 *  - DETAIL: GET /melonshort/video/30612 → 200, ms-bootstrap.first_screen.list[0].id==30612,
 *            video_url = https://yd-hls.utxxds.cn/videos5/<hash>/<hash>.m3u8?auth_key=...&via=91porna。
 *  - PLAY: 取新鲜 video_url → 200 text/plain, 体是 #EXTM3U(AES-128, KEY/.ts 在 tp2.xmbvxj.cn);
 *          KEY → 200 16 bytes;首个 .ts → 200 1.9MB binary(真实分片字节)。
 *  - COVER: pic.xmbvxj.cn 封面无 Referer → 200 image;带 91porna Referer → 404。
 */
return {
  meta: {
    name: "91短视频",
    author: "DouyTV",
    version: "0.1.0",
    description: "91porna 短视频频道 /melonshort(HLS,成人内容,需代理 + 年龄确认)",
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

  _headers(ctx, json, referer) {
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: referer || this._base(ctx) + "/melonshort",
      Accept: json
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  /** 封面头:pic.xmbvxj.cn 带 Referer 反而 404,故【只给 UA、绝不给 Referer】。 */
  _posterHeaders(ctx) {
    return { "User-Agent": this._ua(ctx) };
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  /**
   * 分类清单来自【详情页】/melonshort/video/{id} 内嵌的
   * <script id="ms-bootstrap"> 的 tags 数组(id 即 grid 的 cate_id;list 页无此块)。
   * 先用 grid?cate_id=0 取一个视频 id,再抓其详情页解 tags。失败退回写死的映射。
   * 首项固定「推荐」(cate_id=0)。缓存一天。
   */
  async getSources(ctx) {
    const sources = [{ id: "cate:0", name: "推荐", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("91短视频 分类抓取失败:", String(e));
    }
    if (!cats.length) cats = this._fallbackCategories();
    for (const c of cats) {
      if (!c || c.id == null) continue;
      sources.push({ id: "cate:" + c.id, name: c.name || String(c.id), group: "分类" });
    }
    return sources;
  },

  /** 兜底分类映射(2026-08-01 从详情页 ms-bootstrap.tags 实测,按 sort 降序)。 */
  _fallbackCategories() {
    return [
      { id: 19, name: "素人自拍", sort: 60 },
      { id: 14, name: "原创自拍", sort: 55 },
      { id: 18, name: "高燃混剪", sort: 50 },
      { id: 17, name: "反差系列", sort: 40 },
      { id: 16, name: "网红达人", sort: 30 },
      { id: 15, name: "明星大瓜", sort: 20 },
      { id: 20, name: "ai短视频", sort: 1 },
    ];
  },

  async _fetchCategories(ctx) {
    const CK = "melonshort:categories:v2";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    // 取一个视频 id(list 页无 ms-bootstrap,分类映射只在详情页里)。
    let seedId = "";
    try {
      const g = await this._gridFeed(ctx, "0", 1);
      if (g && g.list && g.list.length) seedId = g.list[0].id;
    } catch (e) {
      /* ignore */
    }
    let out = [];
    if (seedId) {
      try {
        const html = await this._fetchVideoHtml(ctx, seedId);
        const boot = this._parseBootstrap(html);
        const tags = (boot && boot.tags) || [];
        const seen = {};
        for (const t of Array.isArray(tags) ? tags : []) {
          if (!t || t.id == null || seen[t.id]) continue;
          seen[t.id] = true;
          out.push({
            id: t.id,
            name: this._decode(t.name || t.code || String(t.id)),
            sort: t.sort || 0,
          });
        }
        out.sort((a, b) => (b.sort || 0) - (a.sort || 0));
      } catch (e) {
        /* ignore, 交给上层退回 fallback */
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

  /** 抽出 <script id="ms-bootstrap" type="application/json">…</script> 并 JSON.parse。 */
  _parseBootstrap(html) {
    if (!html) return null;
    const m = html.match(
      /<script[^>]*id=["']ms-bootstrap["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      return null;
    }
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "cate:0";
    const cateId = id.indexOf("cate:") === 0 ? id.slice("cate:".length) : "0";
    return this._gridFeed(ctx, cateId, p);
  },

  /**
   * 短视频频道无独立搜索端点(/melonshort/search 实测 404),优雅返回空。
   * 如需按分类浏览请走 getSources 给出的分类源。
   */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    return { list: [], page: p, pageCount: p, total: 0 };
  },

  /** GET /melonshort/grid?cate_id=&page= → { list, page, pageCount, total }。 */
  async _gridFeed(ctx, cateId, page) {
    const url = ctx.utils.buildUrl(this._base(ctx) + "/melonshort/grid", {
      cate_id: cateId,
      page: page,
    });
    let data;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, true),
        timeout: 20000,
        http2: true,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("91短视频 grid 失败:", String(e));
      return { list: [], page, pageCount: page, total: 0 };
    }
    const d = (data && data.data) || {};
    const arr = Array.isArray(d.list) ? d.list : [];
    const list = [];
    for (const v of arr) {
      const vod = this._toVod(ctx, v);
      if (vod) list.push(vod);
    }
    const totalPages = parseInt(d.total_pages || "0", 10) || 0;
    const hasMore = totalPages ? page < totalPages : list.length >= 20;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: parseInt(d.total || "0", 10) || list.length,
    };
  },

  /** grid item → ScriptVodItem。封面走 poster_headers(仅 UA),id 为纯数字。 */
  _toVod(ctx, v) {
    if (!v || v.id == null) return null;
    const id = String(v.id);
    const title = this._decode(v.title || "") || id;
    const poster = this._decode(v.cover || v.cover_proxy || "");
    return {
      id,
      title,
      poster: poster || undefined,
      poster_headers: poster ? this._posterHeaders(ctx) : undefined,
      vod_remarks: v.duration ? String(v.duration) : undefined,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const vid = String(id);
    const info = await this._fetchVideoInfo(ctx, vid);

    const tags = [];
    for (const t of (info && info.tags) || []) {
      const n = this._decode((t && t.name) || "");
      if (n) tags.push(n);
    }
    const descBits = [];
    if (info && info.user_name) descBits.push("作者:" + this._decode(info.user_name));
    if (tags.length) descBits.push("标签:" + tags.join(" / "));

    return {
      id: vid,
      title: (info && this._decode(info.title || "")) || vid,
      poster: (info && this._decode(info.cover || "")) || undefined,
      poster_headers: info && info.cover ? this._posterHeaders(ctx) : undefined,
      year: "",
      desc: descBits.join("  ") || (info && this._decode(info.desc || "")) || "",
      type_name: (info && this._decode(info.cate_name || "")) || undefined,
      playbacks: [
        {
          sourceId: sourceId || "melonshort",
          sourceName: "91短视频",
          // playUrl 只存 id,resolvePlayUrl 现抓详情页取新鲜 auth_key'd m3u8。
          episodes: [{ playUrl: "id:" + vid, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let vid = String(playUrl || "");
    if (vid.indexOf("id:") === 0) vid = vid.slice(3);
    // 兼容:万一传进来的是详情页路径 /melonshort/video/{id}
    const m = vid.match(/\/melonshort\/video\/(\d+)/);
    if (m) vid = m[1];
    if (!/^\d+$/.test(vid)) throw new Error("91短视频: 无效播放 id @ " + playUrl);

    const info = await this._fetchVideoInfo(ctx, vid);
    const url = info && info.video_url ? this._decode(info.video_url) : "";
    if (!url) {
      throw new Error("91短视频: 未从详情页解出 video_url(结构可能已变) @ " + vid);
    }
    return {
      url,
      type: /\.m3u8(\?|$)/i.test(url) ? "hls" : "auto",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /**
   * 抓 GET /melonshort/video/{id},从 ms-bootstrap.first_screen.list 里【按 id 匹配】
   * 取本视频(不盲取第一个 video_url,避免拿到 related 视频的)。返回该条 raw 对象。
   */
  async _fetchVideoInfo(ctx, id) {
    const html = await this._fetchVideoHtml(ctx, id);
    const boot = this._parseBootstrap(html);
    const list =
      (boot && boot.first_screen && Array.isArray(boot.first_screen.list)
        ? boot.first_screen.list
        : []) || [];
    let hit = null;
    for (const v of list) {
      if (v && String(v.id) === String(id)) {
        hit = v;
        break;
      }
    }
    // 结构变动兜底:第一条(通常就是本视频),或整页正则里第一个 video_url。
    if (!hit) hit = list[0] || null;
    if (hit && hit.video_url) return hit;
    // 最后兜底:整页正则(极端结构变动)。挑与本视频 hash 无关时无从匹配 id,取首个。
    const vm = html.match(/"video_url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
    const merged = hit ? Object.assign({}, hit) : {};
    if (!merged.video_url && vm) merged.video_url = vm[1].replace(/\\\//g, "/");
    return merged;
  },

  /** GET /melonshort/video/{id} 原始 HTML。 */
  async _fetchVideoHtml(ctx, id) {
    const res = await ctx.request.get(this._base(ctx) + "/melonshort/video/" + id, {
      headers: this._headers(ctx, false),
      timeout: 20000,
      http2: true,
    });
    if (!res.ok) throw new Error("91短视频: 详情页 HTTP " + res.status + " @ " + id);
    return res.text();
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _decode(s) {
    if (!s || typeof s !== "string") return "";
    return s
      .replace(/\\\//g, "/")
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
