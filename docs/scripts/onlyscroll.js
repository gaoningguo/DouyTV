/**
 * OnlyScroll 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - OnlyScroll 是 WordPress 站(REST v2 开放),内容是竖屏短视频。
 *  - 关键发现: 视频文件与 featured 缩略图【同名不同扩展】——
 *      thumbnail  .../uploads/2026/06/Sofiavalenzuela-tetas-Onlyfans.jpg
 *      video      .../uploads/2026/06/Sofiavalenzuela-tetas-Onlyfans.mp4
 *    所以直接从 REST `_embed` 里的 featured_media 缩略图把 .jpg→.mp4 换掉就是真实
 *    视频直链,不用逐页抓 HTML(实测匿名 200 video/mp4,可 Range seek)。
 *  - CDN 不校验 Referer/UA。国内直连被墙,请在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测):
 *  - 列表: GET /wp-json/wp/v2/posts?_embed=1&per_page=<n>&page=<p>[&categories=<id>]
 *  - 搜索: GET /wp-json/wp/v2/posts?_embed=1&search=<kw>&...
 *  - 分类: GET /wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc
 *  - 每条 post._embedded['wp:featuredmedia'][0].source_url 是缩略图,换 .mp4 = 视频
 */
return {
  meta: {
    name: "OnlyScroll",
    author: "DouyTV",
    version: "0.1.0",
    description: "OnlyScroll 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://onlyscroll.com";
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

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("OnlyScroll HTTP " + res.status + " @ " + url);
    return res.json();
  },

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("OnlyScroll 分类抓取失败:", String(e));
    }
    // 亚洲相关排前面
    const asian = [];
    const other = [];
    for (const c of cats) {
      (this._asianRank(c.slug + " " + c.name) < 99 ? asian : other).push(c);
    }
    const item = (c, group) => ({ id: "cat:" + c.id, name: c.name, group });
    for (const c of asian) sources.push(item(c, "亚洲"));
    for (const c of other) sources.push(item(c, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    const query = {};
    if (id.indexOf("cat:") === 0) query.categories = id.slice("cat:".length);
    return this._feed(ctx, p, query);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    return this._feed(ctx, p, { search: keyword });
  },

  async _feed(ctx, page, extraQuery) {
    const query = { _embed: 1, per_page: 24, page };
    for (const key in extraQuery) {
      if (extraQuery[key] != null && extraQuery[key] !== "") {
        query[key] = extraQuery[key];
      }
    }
    let posts;
    try {
      posts = await this._getJson(ctx, "/wp-json/wp/v2/posts", query);
    } catch (e) {
      // WP 翻过尾页会 400 rest_post_invalid_page_number —— 视为无更多
      return { list: [], page, pageCount: page, total: 0 };
    }
    const arr = Array.isArray(posts) ? posts : [];
    const list = [];
    for (const post of arr) {
      const vod = this._toVod(post);
      if (vod) list.push(vod);
    }
    const hasMore = arr.length >= 24;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * WP post → ScriptVodItem。视频 URL = featured 缩略图换 .mp4。
   * 顺便把解析结果塞内存缓存供 detail 命中。
   */
  _toVod(post) {
    if (!post || !post.id) return null;
    const thumb = this._featured(post);
    const video = this._videoFromThumb(thumb);
    if (!video) return null;

    const title = this._decode(
      (post.title && post.title.rendered) || ""
    ) || String(post.id);
    const typeName = this._firstCategoryName(post);

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[String(post.id)] = {
      url: video,
      title,
      poster: thumb,
      typeName,
      desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
    };

    return {
      id: String(post.id),
      title,
      poster: thumb,
      type_name: typeName,
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      const post = await this._getJson(
        ctx,
        "/wp-json/wp/v2/posts/" + encodeURIComponent(id),
        { _embed: 1 }
      );
      const thumb = this._featured(post);
      const video = this._videoFromThumb(thumb);
      if (!video) throw new Error("OnlyScroll: 未找到视频直链 @ " + id);
      info = {
        url: video,
        title:
          this._decode((post.title && post.title.rendered) || "") || id,
        poster: thumb,
        typeName: this._firstCategoryName(post),
        desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
      };
    }
    return {
      id,
      title: info.title,
      poster: info.poster,
      year: "",
      desc: info.desc || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "onlyscroll",
          sourceName: "OnlyScroll",
          episodes: [{ playUrl: info.url, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
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

  _featured(post) {
    try {
      const media =
        post._embedded &&
        post._embedded["wp:featuredmedia"] &&
        post._embedded["wp:featuredmedia"][0];
      if (media && media.source_url) return media.source_url;
    } catch (e) {
      /* ignore */
    }
    // 兜底: jetpack_featured_media_url / og
    if (post.jetpack_featured_media_url) return post.jetpack_featured_media_url;
    return "";
  },

  /** 缩略图路径换成 .mp4(同名不同扩展)。非图片直接返回空。 */
  _videoFromThumb(thumb) {
    if (!thumb || typeof thumb !== "string") return "";
    const m = thumb.match(/^(.*)\.(jpe?g|png|webp)(\?.*)?$/i);
    if (!m) return "";
    return m[1] + ".mp4";
  },

  _firstCategoryName(post) {
    try {
      const terms =
        post._embedded && post._embedded["wp:term"] && post._embedded["wp:term"][0];
      if (Array.isArray(terms) && terms.length) {
        return this._decode(terms[0].name || "").replace(/^#/, "") || undefined;
      }
    } catch (e) {
      /* ignore */
    }
    return undefined;
  },

  async _fetchCategories(ctx) {
    const CK = "onlyscroll:cats:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const data = await this._getJson(ctx, "/wp-json/wp/v2/categories", {
      per_page: 100,
      orderby: "count",
      order: "desc",
    });
    const out = [];
    const seen = {};
    for (const c of Array.isArray(data) ? data : []) {
      if (!c || !c.id || !c.count) continue;
      const id = String(c.id);
      if (seen[id]) continue;
      seen[id] = true;
      out.push({
        id,
        slug: String(c.slug || ""),
        name: this._decode(c.name || c.slug || id).replace(/^#/, ""),
        count: c.count || 0,
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

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },

  _stripHtml(s) {
    if (!s || typeof s !== "string") return "";
    return this._decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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
      .replace(/&hellip;/g, "…")
      .replace(/&nbsp;/g, " ")
      .trim();
  },
};
