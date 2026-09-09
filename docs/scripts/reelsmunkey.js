/**
 * ReelsMunkey 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - ReelsMunkey 是 TikTok/Instagram 风格竖屏成人短视频聚合站(Next.js SSG + Cloudflare)。
 *  - 站点没有对外 JSON API —— 数据全在每个页面 SSR 注入的
 *    <script id="__NEXT_DATA__"> JSON 里(_next/data/<buildId>/*.json 实测 404,
 *    因为 buildId 会随部署变、CDN 也没缓存,所以直接抠 __NEXT_DATA__ 最稳)。
 *  - 视频直链 = https://imgs.reelsmunkey.com/<link> (link 形如 "vkJJlA.mp4"),
 *    缩略图 = https://imgs.reelsmunkey.com/<thumbnail> ("cCXwyY.webp")。
 *    CDN 不校验 Referer/UA,匿名 200 video/mp4 且支持 Range seek。
 *  - 国内直连被墙/被 Cloudflare 拦,请在「设置 → 代理」配代理,scriptFetch 与播放代理会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 页面/数据形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 首页:  GET /            → pageProps.data[20], count, tags[](分类清单)
 *           GET /page/<n>    → 第 n 页(n≥2),同 data[20]
 *  - 分类:  GET /tag/<slug>       → pageProps.data[20], count, tag
 *           GET /tag/<slug>/<n>   → 第 n 页
 *  - 详情:  GET /video/<url> → pageProps.videoData{ link, thumbnail, title, ... }
 *  - 翻过尾页返回 404 页(pageProps 无 data / data 为空)—— 作为翻页终止信号。
 *  - 搜索:  站点 /search 是【纯前端过滤】(服务端对任意 q 都返回同一批 20 条),
 *           所以这里搜索改为「拉首页前若干页,按标题/描述/标签本地过滤」。
 *  - 每条 item: { _id, title, description, tags:[{tag,url}], link, thumbnail, url, views:{count} }
 *  - 视频直链实测: HEAD https://imgs.reelsmunkey.com/vkJJlA.mp4 → 200 video/mp4 19,655,319B
 */
return {
  meta: {
    name: "ReelsMunkey",
    author: "DouyTV",
    version: "0.1.0",
    description: "ReelsMunkey TikTok/IG 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** 站点基址,可用脚本 config.base 覆盖(万一换域名)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://reelsmunkey.com";
  },

  /** 视频/缩略图 CDN 基址。 */
  _cdn(ctx) {
    const c = ctx.config && ctx.config.get && ctx.config.get("cdn");
    return (typeof c === "string" && c) || "https://imgs.reelsmunkey.com";
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
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: this._base(ctx) + "/",
    };
  },

  /** 拉取一个页面并解析出 __NEXT_DATA__ 的 props.pageProps。失败/404 返回 null。 */
  async _getPageProps(ctx, path) {
    const url = this._base(ctx) + path;
    let html;
    try {
      html = await ctx.request.getHtml(url, {
        headers: this._headers(ctx),
        timeout: 20000,
        // reelsmunkey 走 Cloudflare —— ureq(HTTP/1.1 + rustls 默认指纹)会被 bot
        // 检测层 403(与 nudetik/sharesome 同类)。走 reqwest(http2)栈更接近浏览器。
        http2: true,
      });
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("ReelsMunkey 请求失败:", url, String(e));
      return null;
    }
    if (!html || typeof html !== "string") return null;
    // <script id="__NEXT_DATA__" type="application/json">{...}</script>
    const m = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!m) return null;
    let json;
    try {
      json = JSON.parse(m[1]);
    } catch (e) {
      return null;
    }
    return (json && json.props && json.props.pageProps) || null;
  },

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let tags = [];
    try {
      const pp = await this._getPageProps(ctx, "/");
      if (pp && Array.isArray(pp.tags)) tags = pp.tags;
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("ReelsMunkey 分类抓取失败:", String(e));
    }
    // 亚洲相关排前面(照站点内容偏好)。
    const asian = [];
    const other = [];
    for (const t of tags) {
      if (!t || !t.url) continue;
      (this._asianRank(t.url + " " + (t.tag || "") + " " + (t.keywords || "")) < 99
        ? asian
        : other
      ).push(t);
    }
    const item = (t, group) => ({
      id: "tag:" + t.url,
      name: t.tag || t.url,
      group,
    });
    for (const t of asian) sources.push(item(t, "亚洲"));
    for (const t of other) sources.push(item(t, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    if (id.indexOf("tag:") === 0) {
      const slug = id.slice("tag:".length);
      const path = p > 1 ? "/tag/" + slug + "/" + p : "/tag/" + slug;
      return this._feed(ctx, p, path);
    }
    // 最新 / 首页
    const path = p > 1 ? "/page/" + p : "/";
    return this._feed(ctx, p, path);
  },

  /**
   * 搜索:站点搜索是纯前端的(服务端不按 q 过滤)。
   * 这里拉首页前若干页,把 keyword 在 标题/描述/标签 里本地匹配。
   * page>1 时对更深的页做同样过滤,保证还能继续翻。
   */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };

    // 每个 App 分页对应站点 2 页(20*2=40),提高命中率。
    const list = [];
    let hasMore = false;
    for (let i = 0; i < 2; i++) {
      const sitePage = (p - 1) * 2 + i + 1;
      const path = sitePage > 1 ? "/page/" + sitePage : "/";
      const pp = await this._getPageProps(ctx, path);
      const data = (pp && Array.isArray(pp.data) && pp.data) || [];
      if (data.length >= 20) hasMore = true;
      for (const it of data) {
        if (this._matchKeyword(it, kw)) {
          const vod = this._toVod(ctx, it);
          if (vod) list.push(vod);
        }
      }
    }
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  _matchKeyword(it, kw) {
    const hay =
      (it.title || "") +
      " " +
      (it.description || "") +
      " " +
      (Array.isArray(it.tags)
        ? it.tags.map((t) => (t && (t.tag + " " + t.url)) || "").join(" ")
        : "");
    return hay.toLowerCase().indexOf(kw) >= 0;
  },

  /** 通用列表:抓一个已带页码的 path,解析 pageProps.data。 */
  async _feed(ctx, page, path) {
    const pp = await this._getPageProps(ctx, path);
    const data = (pp && Array.isArray(pp.data) && pp.data) || [];
    const list = [];
    for (const it of data) {
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }
    // 站点每页 20 条;满 20 认为还有下一页(翻过尾页会进 404 页,data 为空)。
    const hasMore = data.length >= 20;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * item → ScriptVodItem。id 用站点 url slug(详情页要用它)。
   * 顺便把 link/thumbnail 塞内存缓存,detail 命中可免二次请求。
   */
  _toVod(ctx, it) {
    if (!it || !it.url || !it.link) return null;
    const slug = String(it.url);
    const link = String(it.link);
    const title = (it.title || slug).trim();
    const thumb = it.thumbnail || "";
    const typeName =
      Array.isArray(it.tags) && it.tags.length ? it.tags[0].tag : undefined;

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[slug] = {
      link,
      thumbnail: thumb,
      title,
      desc: (it.description || "").trim(),
      typeName,
    };

    const cdn = this._cdn(ctx);
    const views = it.views && it.views.count;
    return {
      id: slug,
      title,
      poster: thumb ? cdn + "/" + thumb : undefined,
      type_name: typeName,
      vod_remarks: views ? views + " 次播放" : undefined,
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      const pp = await this._getPageProps(ctx, "/video/" + encodeURIComponent(id));
      const vd = pp && pp.videoData;
      if (!vd || !vd.link) {
        throw new Error("ReelsMunkey: 未找到该视频(可能已删除)@ " + id);
      }
      info = {
        link: String(vd.link),
        thumbnail: vd.thumbnail || "",
        title: (vd.title || id).trim(),
        desc: (vd.description || "").trim(),
        typeName:
          Array.isArray(vd.tags) && vd.tags.length ? vd.tags[0].tag : undefined,
      };
    }
    const cdn = this._cdn(ctx);
    const playUrl = cdn + "/" + info.link;
    return {
      id,
      title: info.title,
      poster: info.thumbnail ? cdn + "/" + info.thumbnail : undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "reelsmunkey",
          sourceName: "ReelsMunkey",
          episodes: [{ playUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 CDN 上的 .mp4 直链。CDN 不校验 Referer/UA,但给个像样 UA。
    return {
      url: playUrl,
      type: "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },
};
