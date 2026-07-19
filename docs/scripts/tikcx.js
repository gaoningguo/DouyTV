/**
 * Tik.cx 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Tik.cx (原 tik.pm) 是 WordPress 站(REST v2 开放),竖屏短视频聚合。
 *  - 只有一个真实分类 "video",故【浏览用 tags 标签】(amateur/tiktok/asian…)。
 *  - 播放链路: 视频页用 clean-tube-player 插件,页面里有
 *      <iframe src=".../player-x.php?q=<base64>">
 *    base64 解出 `post_id=..&type=video&tag=<video src="https://wwwv.tiktok.pm/videos-f/<标题>.mp4">`。
 *    该 mp4 302 跳到 cdn.totkan.com 真实直链(实测匿名 206 video/mp4,可 Range seek)。
 *    标题→文件名映射有大小写/编码坑,故【不猜文件名】,一律抓页面解 iframe 拿 src。
 *  - CDN 不校验 Referer/UA。国内直连被墙,请在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测):
 *  - 列表: GET /wp-json/wp/v2/posts?_embed=1&per_page=<n>&page=<p>[&tags=<id>]
 *  - 搜索: GET /wp-json/wp/v2/posts?_embed=1&search=<kw>&...
 *  - 标签: GET /wp-json/wp/v2/tags?per_page=40&orderby=count&order=desc
 *  - 播放: GET <post.link> → 抠 player-x.php?q=<b64> → 解出 <video src=...>
 */
return {
  meta: {
    name: "Tik.cx",
    author: "DouyTV",
    version: "0.1.0",
    description: "Tik.cx 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://tik.cx";
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
    if (!res.ok) throw new Error("Tik.cx HTTP " + res.status + " @ " + url);
    return res.json();
  },

  async getSources() {
    // 【只保留「最新」】(2026-07 实测):站点的 tag/category 分类下全是 2023 年的老帖,
    // 其视频直链指向【已下线】的 tiktits.tik.pm 主机(连接直接 000,未迁移到新 CDN),
    // 全都无法播放;而新内容(cdndl.xyz)不带任何 tag。所以分类/标签浏览只会呈现死链,
    // 拉标签清单反而误导用户 —— 干脆去掉,只留能正常播放的最新流。
    return [{ id: "latest", name: "最新", group: "浏览" }];
  },

  async recommend(ctx, { page }) {
    // 只有「最新」全站流(WP 默认 orderby=date desc)是活的,直接拉,不带任何 tag 过滤。
    return this._feed(ctx, page || 1, {});
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
      // WP 翻过尾页会 400 —— 视为无更多
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
   * WP post → ScriptVodItem。这里【不解析视频直链】(要抓页面),
   * 只把 post.link 缓存起来供 detail 用。
   */
  _toVod(post) {
    if (!post || !post.id) return null;
    const thumb = this._featured(post);
    const title = this._decode((post.title && post.title.rendered) || "") || String(post.id);
    const link = post.link || "";
    if (!link) return null;

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[String(post.id)] = {
      link,
      title,
      poster: thumb,
      desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
    };

    return {
      id: String(post.id),
      title,
      poster: thumb,
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
      info = {
        link: post.link || "",
        title: this._decode((post.title && post.title.rendered) || "") || id,
        poster: this._featured(post),
        desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
      };
    }
    if (!info.link) throw new Error("Tik.cx: 缺少视频页地址 @ " + id);

    return {
      id,
      title: info.title,
      poster: info.poster,
      year: "",
      desc: info.desc || "",
      playbacks: [
        {
          sourceId: sourceId || "tikcx",
          // playUrl 存视频页 URL, resolvePlayUrl 抓页面解 iframe 拿真实 mp4。
          sourceName: "Tik.cx",
          episodes: [{ playUrl: info.link, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 是视频页 URL(detail 里塞的 post.link)。
    // 抓页面 → 找 clean-tube-player iframe 的 q=<base64> → 解出 <video src=...>。
    const pageUrl = /^https?:\/\//.test(playUrl)
      ? playUrl
      : this._base(ctx) + "/" + String(playUrl).replace(/^\/+/, "");

    const res = await ctx.request.get(pageUrl, {
      headers: this._headers(ctx, false),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Tik.cx: 视频页 HTTP " + res.status);
    const html = await res.text();

    const video = this._extractVideoUrl(ctx, html);
    if (!video) {
      throw new Error("Tik.cx: 未从视频页解出直链(clean-tube-player 结构可能已变)");
    }
    return {
      url: video,
      type: /\.m3u8/i.test(video) ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /**
   * 从视频页 HTML 里解出真实视频直链。两条路径:
   *  1) clean-tube-player iframe: src=".../player-x.php?q=<base64>"
   *     base64 解码得 `post_id=..&tag=<video src="...mp4">`,再从 tag 里抠 src。
   *  2) 兜底: 直接从 HTML 里正则找 wwwv.tiktok.pm / .mp4 直链。
   */
  _extractVideoUrl(ctx, html) {
    // 路径 1: player-x.php?q=<base64>
    const m = html.match(/player-x\.php\?q=([A-Za-z0-9+/=_-]+)/);
    if (m) {
      let decoded = "";
      try {
        decoded = ctx.utils.base64Decode(m[1]);
      } catch (e) {
        try {
          decoded = atob(m[1]);
        } catch (e2) {
          decoded = "";
        }
      }
      if (decoded) {
        // decoded 内的 tag 是 URL-encoded 的 HTML,里面有 <video src="...">
        const un = this._safeDecodeURI(decoded);
        const sm =
          un.match(/<video[^>]*\ssrc=["']([^"']+\.mp4[^"']*)["']/i) ||
          un.match(/src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
        if (sm) return this._decode(sm[1]);
      }
    }
    // 路径 2: 页面里直接的 tiktok.pm / .mp4
    const d2 =
      html.match(/https?:\/\/[^"'\s]*tiktok\.pm\/[^"'\s]+\.mp4[^"'\s]*/i) ||
      html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
    return d2 ? this._decode(d2[0]) : "";
  },

  _safeDecodeURI(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      // 部分 %XX 非法时逐段解
      return s.replace(/%[0-9a-f]{2}/gi, (seq) => {
        try {
          return decodeURIComponent(seq);
        } catch (e2) {
          return seq;
        }
      });
    }
  },

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
    if (post.jetpack_featured_media_url) return post.jetpack_featured_media_url;
    return "";
  },

  async _fetchTags(ctx) {
    const CK = "tikcx:tags:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const data = await this._getJson(ctx, "/wp-json/wp/v2/tags", {
      per_page: 40,
      orderby: "count",
      order: "desc",
    });
    const out = [];
    const seen = {};
    for (const t of Array.isArray(data) ? data : []) {
      if (!t || !t.id || !t.count) continue;
      const id = String(t.id);
      if (seen[id]) continue;
      seen[id] = true;
      out.push({
        id,
        slug: String(t.slug || ""),
        name: this._decode(t.name || t.slug || id),
        count: t.count || 0,
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
