/**
 * 小红书18 (xhs18.net) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - xhs18.net 是 Next.js(App Router)前端 + Strapi 风格后端的【推特/X 内容聚合站】,
 *    自己不托管视频,把 X(twitter)上的帖子采集入库,视频直链最终是 video.twimg.com。
 *  - 【列表】走干净的 JSON 接口(浏览器 XHR 同款):
 *      GET /api/feed?limit=<n>&offset=<m>[&q=<kw>]
 *      → { items:[...], hasMore:bool, nextOffset:int, total:int }
 *    offset 翻页(下一页用响应里的 nextOffset,或自己 offset+=limit)。
 *    item 混合 type:"video" / "image";本 App 是视频流,只取 video。
 *    注意:feed 的 item【不含视频直链】(videos:[] 恒空),只有:
 *      thumbnail(pbs.twimg.com/amplify_video_thumb/<vid>/img/...jpg)、slug、title(_zh)、
 *      description、source_author(_name/_avatar)、tags、aspect_ratio、source_url(x.com 原帖)。
 *  - 【搜索】同一 /api/feed,带 q=<kw>(服务端全文搜,total 随之变化),offset 翻页。
 *  - 【分类】站点没有服务端分类接口(前端"视频/图片/热门"是对 feed 结果客户端过滤),
 *    故这里只暴露「最新」一条;搜索用关键词覆盖分类诉求。
 *  - 【播放解析】视频直链只在详情页 SSR 里:
 *      GET /posts/<slug>  → Next.js flight 数据(self.__next_f)里内嵌
 *        "videos":[{"video_url":"https://video.twimg.com/amplify_video/<vid>/vid/avc1/<w>x<h>/<hash>.mp4?tag=.."}]
 *      <vid> 与封面 amplify_video_thumb/<vid> 一致,故按 <vid> 精确匹配该帖的 mp4;
 *      SSR 首个 video_url 亦即当前帖(兜底取第一个)。
 *    → 直链约带 tag 参数,twimg CDN 靠 UA 放行(裸请求可能 403,带浏览器 UA → 206 video/mp4,
 *      支持 Range seek;不校验 Referer)。故 playUrl 存 slug,resolvePlayUrl 现拉新鲜直链。
 *  - meta.fifu 式缩略图 / mediaUrl:形如 /uploads/... 的相对图会补 https://api.xhs18.net 前缀
 *    (源码 mediaUrl 规则);但视频封面都是 pbs.twimg.com 绝对图,一般用不上。
 *  - 国内直连(X / twimg)被墙 → 「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-20,经 127.0.0.1:7897 代理匿名):
 *  - LIST: GET /api/feed?limit=24&offset=0 → 200 {items[24], hasMore:true, nextOffset:24, total:44740}。
 *  - SEARCH: GET /api/feed?q=asian → total 175,offset 翻页 items 不重叠。
 *  - RESOLVE: GET /posts/<slug> → __next_f 内 video_url=https://video.twimg.com/amplify_video/<vid>/.../*.mp4?tag=..,
 *             <vid> 与封面 amplify_video_thumb/<vid> 一致。
 *  - PLAY: GET(带 UA) twimg mp4 → 206 video/mp4(Range 可 seek)。
 */
return {
  meta: {
    name: "小红书18",
    author: "DouyTV",
    version: "0.1.0",
    description: "xhs18.net 推特内容聚合竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://xhs18.net";
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
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: this._base(ctx) + "/",
    };
    h.Accept =
      kind === "json"
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    return h;
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources() {
    // 站点无服务端分类接口:/api/feed 的 sort 参数服务端【完全无视】(实测各值同序),
    // 官网「热门」是纯客户端逻辑(近 7 天 + source_likes 降序)。这里如实复刻:
    //   - 最新:直接翻 feed(offset 分页)
    //   - 热门:拉一大批 → 过滤近 7 天 → 按 source_likes 降序 → 前端切片翻页
    return [
      { id: "latest", name: "最新", group: "浏览" },
      { id: "hot", name: "热门", group: "浏览" },
    ];
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    if ((sourceId || "") === "hot") return this._hotFeed(ctx, p);
    return this._feed(ctx, p, {});
  },

  /**
   * 「热门」—— 服务端不支持热度排序,故复刻官网客户端逻辑:
   * 一次拉一大批(HOT_POOL 条)→ 只留近 7 天的 video → 按 source_likes 降序 →
   * 按 page 切片(每页 24)。池子缓存 10 分钟,翻页不重复打接口。
   */
  async _hotFeed(ctx, page) {
    const PAGE = 24;
    const POOL = 200;
    const CK = "xhs18:hotpool:v1";
    let pool = null;
    try {
      pool = await ctx.cache.get(CK);
    } catch (e) {
      /* ignore */
    }
    if (!pool || !Array.isArray(pool) || !pool.length) {
      const url = ctx.utils.buildUrl(this._base(ctx) + "/api/feed", {
        limit: POOL,
        offset: 0,
      });
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, "json"),
        timeout: 25000,
      });
      if (!res.ok) throw new Error("xhs18 hot HTTP " + res.status);
      const data = await res.json();
      const items = (data && Array.isArray(data.items) && data.items) || [];
      const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      const recent = [];
      for (const it of items) {
        if (!it || it.type !== "video") continue;
        const t = it.createdAt ? Date.parse(it.createdAt) : NaN;
        if (isFinite(t) && t >= weekAgo) recent.push(it);
      }
      // 近 7 天不足时放宽为全量 video(避免热门页空)。
      const base = recent.length >= PAGE ? recent : items.filter((x) => x && x.type === "video");
      base.sort((a, b) => (b.source_likes || 0) - (a.source_likes || 0));
      pool = base;
      try {
        await ctx.cache.set(CK, pool, 600);
      } catch (e) {
        /* ignore */
      }
    }
    const start = (Math.max(1, page) - 1) * PAGE;
    const slice = pool.slice(start, start + PAGE);
    const list = [];
    for (const it of slice) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    const hasMore = start + PAGE < pool.length;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  async search(ctx, { keyword, page }) {
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: page || 1, pageCount: page || 1, total: 0 };
    return this._feed(ctx, page || 1, { q: kw });
  },

  /**
   * /api/feed offset 翻页。page(1 起)→ offset=(page-1)*limit。
   * 只保留 type:"video";用响应 hasMore 决定是否还有下一页。
   */
  async _feed(ctx, page, extraQuery) {
    const limit = 24;
    const offset = (Math.max(1, page) - 1) * limit;
    const query = { limit, offset };
    for (const k in extraQuery) {
      if (extraQuery[k] != null && extraQuery[k] !== "") query[k] = extraQuery[k];
    }
    const url = ctx.utils.buildUrl(this._base(ctx) + "/api/feed", query);
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, "json"),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("xhs18 feed HTTP " + res.status + " @ " + url);
    const data = await res.json();
    const items = (data && Array.isArray(data.items) && data.items) || [];

    const list = [];
    for (const it of items) {
      if (!it || it.type !== "video") continue; // 只要视频
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    // hasMore 明确给了就用它;否则按本页原始条数是否满 limit 推断。
    const hasMore =
      typeof (data && data.hasMore) === "boolean"
        ? data.hasMore
        : items.length >= limit;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /** feed item → ScriptVodItem。缓存 slug + 封面 amplify id 供 detail/resolve 精确匹配。 */
  _toVod(it) {
    const slug = it.slug || "";
    if (!slug) return null;
    const title =
      this._decode(it.title_zh || it.title || it.description || "").trim() || slug;
    const poster = this._poster(it);
    const author = this._decode(it.source_author_name || it.source_author || "").trim();

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[slug] = {
      slug,
      title,
      poster,
      author,
      thumbId: this._thumbId(it.thumbnail || ""),
      desc: this._decode(it.description || "").trim(),
    };

    return {
      id: slug,
      title,
      poster: poster || undefined,
      type_name: author || undefined,
      desc: this._pendingCache[slug].desc || undefined,
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const slug = String(id);
    const info = (this._pendingCache && this._pendingCache[slug]) || { slug };
    return {
      id: slug,
      title: info.title || slug,
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.author || undefined,
      playbacks: [
        {
          sourceId: sourceId || "xhs18",
          sourceName: "小红书18",
          // playUrl 存 slug;resolvePlayUrl 抓详情页 SSR 拿新鲜 twimg mp4。
          episodes: [{ playUrl: slug, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const slug = String(playUrl || "").trim();
    if (!slug) throw new Error("xhs18: 缺少 slug");

    const cached = this._pendingCache && this._pendingCache[slug];
    const wantId = cached && cached.thumbId;

    const pageUrl = /^https?:\/\//.test(slug)
      ? slug
      : this._base(ctx) + "/posts/" + encodeURIComponent(slug);
    const res = await ctx.request.get(pageUrl, {
      headers: this._headers(ctx, "html"),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("xhs18: 详情页 HTTP " + res.status);
    const html = await res.text();

    const mp4 = this._extractMp4(html, wantId);
    if (!mp4) throw new Error("xhs18: 未从详情页解出 twimg 直链(SSR 结构可能已变)");

    return {
      url: mp4,
      type: /\.m3u8(\?|$)/i.test(mp4) ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        // video.twimg.com CDN 【拒绝非 twitter 的 Referer】(带站点 Referer → 403),
        // 只认 x.com/twitter.com 或无 Referer。故这里必须用 x.com,不能用本站。
        Referer: "https://x.com/",
      },
    };
  },

  /**
   * 从详情页 HTML(Next.js flight 数据在 self.__next_f 里,mp4 用反斜杠转义)解出 twimg 直链。
   *  - 有封面 amplify id(wantId)→ 优先精确匹配该帖自己的 mp4(避免抓到"相关推荐"里别人的)。
   *  - 否则取第一个 video_url / 第一个 video.twimg mp4。
   */
  _extractMp4(html, wantId) {
    if (!html || typeof html !== "string") return "";
    // 精确匹配:同一 amplify id 的 mp4
    if (wantId) {
      const re = new RegExp(
        "video\\.twimg\\.com/amplify_video/" +
          wantId.replace(/[^0-9]/g, "") +
          "/[^\\\\\"'\\s]+?\\.mp4[^\\\\\"'\\s]*",
        "i"
      );
      const m = html.match(re);
      if (m) return "https://" + m[0];
    }
    // 兜底 1: 结构化 "video_url":"...mp4..."
    const vu = html.match(/video_url\\?["']:\\?["'](https?:\/\/[^\\"'\s]+?\.mp4[^\\"'\s]*)/i);
    if (vu) return this._clean(vu[1]);
    // 兜底 2: 页面里任意 twimg amplify mp4
    const any = html.match(
      /https?:\/\/video\.twimg\.com\/amplify_video\/[^\\"'\s]+?\.mp4[^\\"'\s]*/i
    );
    if (any) return this._clean(any[0]);
    // 兜底 3: 任意 .mp4/.m3u8 绝对链接
    const g =
      html.match(/https?:\/\/[^\\"'\s]+?\.m3u8[^\\"'\s]*/i) ||
      html.match(/https?:\/\/[^\\"'\s]+?\.mp4[^\\"'\s]*/i);
    return g ? this._clean(g[0]) : "";
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 从 amplify_video_thumb/<id>/ 抠出 amplify 视频 id(join key)。 */
  _thumbId(thumb) {
    const m = String(thumb || "").match(/amplify_video_thumb\/(\d+)\//);
    return m ? m[1] : "";
  },

  /** 封面:pbs.twimg 绝对图直接用;/uploads/ 相对图补 api 前缀(源码 mediaUrl 规则)。 */
  _poster(it) {
    const t = (it && it.thumbnail) || "";
    if (!t) return "";
    if (/^https?:\/\//i.test(t)) return t;
    if (t.indexOf("/uploads/") === 0) return "https://api.xhs18.net" + t;
    return t;
  },

  /** 去掉 flight 转义残留(\" / 结尾反斜杠)。 */
  _clean(u) {
    return String(u || "")
      .replace(/\\+$/, "")
      .replace(/\\(.)/g, "$1")
      .trim();
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
      .trim();
  },
};
