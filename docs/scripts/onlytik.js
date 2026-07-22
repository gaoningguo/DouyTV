/**
 * OnlyTik (onlytik.com) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - OnlyTik 是 TikTok 风格竖屏成人短视频站,前端 Laravel + jQuery,后端一套简单 JSON API。
 *  - 【主推荐流】POST /api/new-videos —— 请求体只需 { limit:<n> }(可选 videoIds[] 去重),
 *    匿名可用,返回一批【随机】新视频。每条:
 *      { video_id, nice, desc(内嵌 #tag <span>), url(直链 mp4), username, mimetype, likes, liked }
 *    url 是 https://cdn2.onlytik.com/videos/<id>.mp4(实测匿名 Range 206 video/mp4),
 *    封面 https://cdn2.onlytik.com/preview/<id>.jpg(匿名 200 image/jpeg)。
 *    注意:此接口是【随机流,无真正分页】—— 每次都是随机批次。传 videoIds[] 可让服务端
 *    尽量不重复;脚本用一个 session 级 seen 集合累积已下发 id 传回去做去重。
 *  - 【标签浏览 / 搜索】GET /api/tag?tid=<标签词>&offset=<n> —— 返回
 *      { name, likes, videos:[ {video_id, desc, url, username, likes, ...} ] }
 *    offset 顺序翻页(offset=已加载条数)。站点没有全文搜索,故【搜索关键词当作标签处理】。
 *  - 单视频页 https://onlytik.com/<video_id> 服务端渲染,内嵌 <source src=".../<id>.mp4">,
 *    作为 detail 兜底(feed/tag 已给全信息,一般命中缓存)。
 *  - CDN 不校验 Referer/UA。国内直连被墙,请在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-20,全程经 127.0.0.1:7897 代理匿名验证):
 *  - LIST: POST /api/new-videos {limit:5} → 200,5 条,含 url .../videos/EvMD.mp4。
 *  - TAG:  GET /api/tag?tid=brunette&offset=0 → 200,{name,videos:[...]};offset=10 内容不同(分页有效)。
 *  - PLAY: GET Range .../videos/EvMD.mp4 → 206 video/mp4;preview/EvMD.jpg → 200 image/jpeg。
 */
return {
  meta: {
    name: "OnlyTik",
    author: "DouyTV",
    version: "0.1.0",
    description: "OnlyTik 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://onlytik.com";
  },

  _cdn(ctx) {
    const c = ctx.config && ctx.config.get && ctx.config.get("cdn");
    return (typeof c === "string" && c) || "https://cdn2.onlytik.com";
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
      "Accept-Language": "en-US,en;q=0.9",
      Referer: this._base(ctx) + "/",
    };
    if (kind === "ajax") {
      h.Accept = "application/json, text/javascript, */*; q=0.01";
      h["X-Requested-With"] = "XMLHttpRequest";
      h.Origin = this._base(ctx);
      h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (kind === "json") {
      h.Accept = "application/json, text/plain, */*";
      h["X-Requested-With"] = "XMLHttpRequest";
    } else {
      h.Accept =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    }
    return h;
  },

  async getSources() {
    // 站点没有固定分类清单(标签藏在每条 desc 里),只有随机「最新」全站流。
    // 分类浏览通过【搜索关键词=标签】走 /api/tag 实现。
    return [{ id: "latest", name: "最新", group: "浏览" }];
  },

  async recommend(ctx, { page }) {
    // 随机流,无真正分页 —— 每页拉一批,传 seen 做去重。
    const limit = 24;
    const seen = this._seen || (this._seen = []);
    const body =
      "limit=" +
      encodeURIComponent(limit) +
      seen
        .slice(-200)
        .map((id) => "&videoIds[]=" + encodeURIComponent(id))
        .join("");
    let arr;
    try {
      const res = await ctx.request.post(this._base(ctx) + "/api/new-videos", {
        headers: this._headers(ctx, "ajax"),
        body,
        timeout: 25000,
      });
      if (!res.ok) throw new Error("OnlyTik new-videos HTTP " + res.status);
      arr = await res.json();
    } catch (e) {
      return { list: [], page: page || 1, pageCount: page || 1, total: 0 };
    }
    const list = [];
    for (const v of Array.isArray(arr) ? arr : []) {
      const vod = this._toVod(ctx, v);
      if (vod) {
        list.push(vod);
        seen.push(vod.id);
      }
    }
    // 随机流永远「还有下一页」(除非返回空)。
    const p = page || 1;
    return {
      list,
      page: p,
      pageCount: list.length ? p + 1 : p,
      total: list.length,
    };
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    // 站点无全文搜索 —— 关键词当标签处理。offset = (page-1)*每页数。
    const perPage = 24;
    const offset = (p - 1) * perPage;
    const url = ctx.utils.buildUrl(this._base(ctx) + "/api/tag", {
      tid: kw.toLowerCase(),
      offset,
    });
    let data;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, "json"),
        timeout: 20000,
      });
      if (!res.ok) throw new Error("OnlyTik tag HTTP " + res.status);
      data = await res.json();
    } catch (e) {
      return { list: [], page: p, pageCount: p, total: 0 };
    }
    const vids = (data && Array.isArray(data.videos) && data.videos) || [];
    const list = [];
    for (const v of vids) {
      const vod = this._toVod(ctx, v);
      if (vod) list.push(vod);
    }
    const hasMore = list.length >= perPage;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info || !info.url) {
      // 兜底:抓单视频页解 <source src>。
      const resolved = await this._resolveById(ctx, id);
      if (resolved) {
        info = Object.assign({}, info || {}, resolved);
        this._pendingCache = this._pendingCache || {};
        this._pendingCache[id] = info;
      }
    }
    if (!info) info = { title: String(id) };

    const playUrl = info.url ? info.url : "id:" + id;
    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.author || undefined,
      playbacks: [
        {
          sourceId: sourceId || "onlytik",
          sourceName: "OnlyTik",
          episodes: [{ playUrl, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    if (url.indexOf("id:") === 0) {
      const resolved = await this._resolveById(ctx, url.slice(3));
      if (!resolved || !resolved.url) {
        throw new Error("OnlyTik: 无法解析播放地址 @ " + playUrl);
      }
      url = resolved.url;
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("OnlyTik: 无效播放地址 @ " + playUrl);
    }
    return {
      url,
      type: /\.m3u8(\?|$)/i.test(url) ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /** 抓单视频页 https://onlytik.com/<id>,解 <source src="...mp4"> + poster。 */
  async _resolveById(ctx, id) {
    const url = this._base(ctx) + "/" + encodeURIComponent(String(id));
    let html;
    try {
      const res = await ctx.request.get(url, {
        headers: this._headers(ctx, "html"),
        timeout: 25000,
      });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      return null;
    }
    if (!html) return null;
    const sm =
      html.match(/<source[^>]*\ssrc=["']([^"']+\.mp4[^"']*)["']/i) ||
      html.match(/https?:\/\/[^"'\s]+\/videos\/[^"'\s]+\.mp4/i);
    if (!sm) return null;
    const mp4 = this._decode(sm[1] || sm[0]);
    const pm = html.match(/poster=["']([^"']+)["']/i);
    return {
      url: mp4,
      poster: pm ? this._decode(pm[1]) : this._cdn(ctx) + "/preview/" + id + ".jpg",
      title: String(id),
    };
  },

  /** API video 条目 → ScriptVodItem,并缓存直链供 detail 命中。 */
  _toVod(ctx, v) {
    if (!v || !v.video_id) return null;
    const id = String(v.video_id);
    const url = v.url || this._cdn(ctx) + "/videos/" + id + ".mp4";
    const poster = this._cdn(ctx) + "/preview/" + id + ".jpg";
    const tags = this._tagsFromDesc(v.desc);
    const title =
      (v.nice && this._decode(String(v.nice)).trim()) ||
      (tags.length ? tags.map((t) => "#" + t).join(" ") : "") ||
      (v.username ? "@" + v.username : id);
    const author = v.username ? String(v.username) : "";

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      url,
      poster,
      title,
      author,
      desc: tags.length ? tags.map((t) => "#" + t).join(" ") : "",
    };
    return {
      id,
      title,
      poster,
      type_name: author || undefined,
    };
  },

  /** 从 desc 里的 <span data-id="tag">#tag</span> 抠出标签词。 */
  _tagsFromDesc(desc) {
    if (!desc || typeof desc !== "string") return [];
    const out = [];
    const re = /data-id=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(desc))) {
      const t = m[1].trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
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
