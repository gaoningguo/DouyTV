/**
 * SexReels 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - SexReels 是 WordPress 站(tikswipe 主题,REST v2 开放),内容是竖屏短视频。
 *  - 关键发现: 列表 / 分类 / 搜索全走标准 WP REST(/wp-json/wp/v2/posts + categories),
 *    但【视频真实直链不在 REST 里】—— 页面 <video-js data-postid> 是空的,
 *    真实 URL 由前端 admin-ajax POST 拿:
 *      action=wpst_media_data_fetchmeta & post_id=<id> & nonce=<n>
 *      → { video_type, video_url, video_poster_url }
 *    nonce 是页面里 `wpst_ajax_var`/`wpst_player_init_var` 的 `nonce` 字段(匿名可用,
 *    但会变),脚本每次从首页 HTML 里刮一个,缓存 10 分钟。
 *  - video_url 落在外部 CDN(reelshdd.com 等),实测匿名 206 video/mp4、不校验 Referer。
 *  - 国内直连被墙,请在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测):
 *  - 列表: GET /wp-json/wp/v2/posts?_embed=1&per_page=<n>&page=<p>[&categories=<id>]
 *  - 搜索: GET /wp-json/wp/v2/posts?_embed=1&search=<kw>&...
 *  - 分类: GET /wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc
 *  - 播放: POST /wp-admin/admin-ajax.php  (form: action/post_id/nonce)
 */
return {
  meta: {
    name: "SexReels",
    author: "DouyTV",
    version: "0.1.0",
    description: "SexReels 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://sexreels.net";
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
    if (!res.ok) throw new Error("SexReels HTTP " + res.status + " @ " + url);
    return res.json();
  },

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "最新", group: "浏览" }];
    let cats = [];
    try {
      cats = await this._fetchCategories(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("SexReels 分类抓取失败:", String(e));
    }
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
   * WP post → ScriptVodItem。poster 用 featured 缩略图,真实视频直链留到 detail 时
   * 通过 admin-ajax 拿(REST 里没有)。id = post.id。
   */
  _toVod(post) {
    if (!post || !post.id) return null;
    const thumb = this._featured(post);
    const title =
      this._decode((post.title && post.title.rendered) || "") ||
      String(post.id);
    const typeName = this._firstCategoryName(post);

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[String(post.id)] = {
      poster: thumb,
      title,
      typeName,
      desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
    };

    return {
      id: String(post.id),
      title,
      poster: thumb || undefined,
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
      info = {
        poster: this._featured(post),
        title:
          this._decode((post.title && post.title.rendered) || "") || id,
        typeName: this._firstCategoryName(post),
        desc: this._stripHtml((post.excerpt && post.excerpt.rendered) || ""),
      };
    }
    // detail 阶段不解析真实直链 —— 交给 resolvePlayUrl(playUrl 传 post_id)。
    return {
      id,
      title: info.title,
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "sexreels",
          sourceName: "SexReels",
          // playUrl 塞 post_id,needResolve=true → resolvePlayUrl 走 admin-ajax 拿真链
          episodes: [{ playUrl: String(id), needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const postId = String(playUrl).replace(/\D/g, "");
    if (!postId) throw new Error("SexReels: 无效 post_id @ " + playUrl);
    const meta = await this._fetchMedia(ctx, postId);
    if (!meta || !meta.video_url) {
      throw new Error("SexReels: 未拿到视频直链(nonce 失效或视频受限)@ " + postId);
    }
    const url = meta.video_url;
    const isHls = /\.m3u8/i.test(url);
    return {
      url,
      type: isHls ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /**
   * admin-ajax wpst_media_data_fetchmeta —— 拿 { video_url, video_poster_url }。
   * 需要页面里的 nonce(会变),用 _getNonce 刮 + 缓存;失败时重刮一次再试。
   */
  async _fetchMedia(ctx, postId) {
    const doPost = async (nonce) => {
      const body =
        "action=wpst_media_data_fetchmeta&post_id=" +
        encodeURIComponent(postId) +
        "&nonce=" +
        encodeURIComponent(nonce);
      const res = await ctx.request.post(this._base(ctx) + "/wp-admin/admin-ajax.php", {
        headers: {
          "User-Agent": this._ua(ctx),
          Referer: this._base(ctx) + "/",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
        body,
        timeout: 20000,
      });
      const text = await res.text();
      // 失效时 WP 返回 "0"(die(0)),不是 JSON
      if (!text || text.trim() === "0") return null;
      try {
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    };

    let nonce = await this._getNonce(ctx, false);
    let meta = nonce ? await doPost(nonce) : null;
    if (!meta) {
      // nonce 过期 → 强制重刮再试一次
      nonce = await this._getNonce(ctx, true);
      if (nonce) meta = await doPost(nonce);
    }
    return meta;
  },

  /**
   * 从首页 HTML 刮 nonce(wpst_ajax_var / wpst_player_init_var 的 "nonce")。
   * 缓存 10 分钟;force=true 时跳过缓存重刮。
   */
  async _getNonce(ctx, force) {
    const CK = "sexreels:nonce:v1";
    if (!force) {
      try {
        const cached = await ctx.cache.get(CK);
        if (cached && typeof cached === "string") return cached;
      } catch (e) {
        /* ignore */
      }
    }
    const res = await ctx.request.get(this._base(ctx) + "/", {
      headers: this._headers(ctx, false),
      timeout: 20000,
    });
    const html = await res.text();
    const m =
      html.match(/wpst_player_init_var\s*=\s*\{[^}]*?"nonce":"([a-f0-9]+)"/i) ||
      html.match(/wpst_ajax_var\s*=\s*\{[^}]*?"nonce":"([a-f0-9]+)"/i) ||
      html.match(/"nonce":"([a-f0-9]{8,})"/i);
    const nonce = m ? m[1] : "";
    if (nonce) {
      try {
        await ctx.cache.set(CK, nonce, 600);
      } catch (e) {
        /* ignore */
      }
    }
    return nonce;
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
    const CK = "sexreels:cats:v1";
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
