/**
 * Sharesome 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Sharesome 是社交向成人内容站,"Quickies" 是它的竖屏短视频板块(TikTok 风)。
 *  - 前端是自研 Vue SPA,但 REST API 开放:https://sharesome.com/api/* 匿名可读。
 *  - Quickies 视频【匿名可播】:每条 item 带 video_src / mp4_url(mp4 直链),
 *    部分还有 hls_master_playlist_url(fMP4 HLS master)。CDN videos.sharesome.com
 *    不校验 Referer/UA,匿名 Range 206 video/mp4,HLS 分片(init.mp4/*.m4s)也匿名 206。
 *  - 关键限制:Quickies 推荐流是【固定池、无服务端分类/搜索过滤】——
 *      · /api/posts?quickies=1&limit=N 返回稳定有序的前 N 条(offset/page 参数被忽略);
 *      · topic/category/q 参数匿名下均不过滤(返回同一批)。
 *    所以本脚本一次性拉一个大池(默认 200),分类/搜索都在客户端按 item.categories
 *    / 文本本地过滤,分页对大池做切片。
 *  - 国内直连被墙 / 触发 Cloudflare,请在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 列表: GET /api/posts?quickies=1&limit=<N>  → { success, data:[ item ] }(N≤300)
 *  - 详情: GET /api/posts?single=<uuid>         → { data:[ item ] }(取 data[0])
 *  - 分类: GET /api/topics                       → [{ id, name, slug, posts_no }]
 *  - item: { uuid, text, is_paid, type:"Video", orientation, duration("00:00:12"),
 *            video_src / mp4_url(mp4 直链), hls_master_playlist_url(可选 HLS),
 *            thumb, categories:[{id,name,slug}], primary_category, user, views }
 *  - 直链实测: HEAD .../file/videos-out/<id>/<id>.mp4 → 206 video/mp4;
 *              HLS master → 变体 playlists/1078p.m3u8 → ../segments/1078p/*.m4s 均匿名 206。
 */
return {
  meta: {
    name: "Sharesome",
    author: "DouyTV",
    version: "0.1.0",
    description: "Sharesome Quickies 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** 站点基址(API 与页面同域),可用脚本 config.base 覆盖。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://sharesome.com";
  },

  /** 一次性拉取的池大小(服务端上限 ~300)。可用 config.pool 覆盖。 */
  _poolSize(ctx) {
    const n = ctx.config && ctx.config.get && ctx.config.get("pool");
    const v = Number(n);
    if (v >= 20 && v <= 300) return Math.floor(v);
    return 200;
  },

  /** App 每页条数。 */
  _pageSize() {
    return 20;
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
      Accept: "application/json, text/plain, */*",
      Referer: this._base(ctx) + "/",
    };
  },

  async _getJson(ctx, path, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Sharesome HTTP " + res.status + " @ " + url);
    return res.json();
  },

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "推荐", group: "浏览" }];
    let topics = [];
    try {
      topics = await this._fetchTopics(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Sharesome 分类抓取失败:", String(e));
    }
    const asian = [];
    const other = [];
    for (const t of topics) {
      (this._asianRank(t.slug + " " + t.name) < 99 ? asian : other).push(t);
    }
    const item = (t, group) => ({ id: "cat:" + t.slug, name: t.name, group });
    for (const t of asian) sources.push(item(t, "亚洲"));
    for (const t of other) sources.push(item(t, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    const pool = await this._pool(ctx);
    let filtered = pool;
    if (id.indexOf("cat:") === 0) {
      const slug = id.slice("cat:".length).toLowerCase();
      filtered = pool.filter((v) => (v._cats || []).indexOf(slug) >= 0);
    }
    return this._slice(filtered, p);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    const pool = await this._pool(ctx);
    const filtered = pool.filter((v) => {
      const hay = (v._hay || "");
      return hay.indexOf(kw) >= 0;
    });
    return this._slice(filtered, p);
  },

  /** 对已过滤的 vod 数组做分页切片。 */
  _slice(arr, page) {
    const size = this._pageSize();
    const start = (page - 1) * size;
    const list = arr.slice(start, start + size).map((v) => v.vod);
    const hasMore = start + size < arr.length;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: arr.length,
    };
  },

  /**
   * 拉取并缓存 Quickies 大池。返回 [{ vod, _cats:[slug], _hay:searchText }]。
   * 内存缓存整会话复用(池是稳定有序的),同时把逐条解析塞 _pendingCache 供 detail。
   */
  async _pool(ctx) {
    if (this._poolCache && this._poolCache.length) return this._poolCache;

    let data;
    try {
      const raw = await this._getJson(ctx, "/api/posts", {
        quickies: 1,
        limit: this._poolSize(ctx),
      });
      data = (raw && Array.isArray(raw.data) && raw.data) || [];
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Sharesome 池抓取失败:", String(e));
      data = [];
    }

    const out = [];
    const seen = {};
    for (const it of data) {
      const parsed = this._parse(ctx, it);
      if (!parsed) continue;
      if (seen[parsed.vod.id]) continue;
      seen[parsed.vod.id] = true;
      out.push(parsed);
    }
    this._poolCache = out;
    return out;
  },

  /**
   * item → { vod: ScriptVodItem, _cats:[slug], _hay }。仅收视频。
   * 播放优先 HLS master(hls_master_playlist_url),回落 mp4(video_src/mp4_url)。
   * 顺便把解析结果塞 _pendingCache[uuid] 供 detail 命中。
   */
  _parse(ctx, it) {
    if (!it || !it.uuid) return null;
    if (it.type && String(it.type).toLowerCase() !== "video") return null;

    const hls = this._validUrl(it.hls_master_playlist_url) || this._validUrl(it.master_playlist);
    const mp4 = this._validUrl(it.video_src) || this._validUrl(it.mp4_url);
    const playUrl = hls || mp4;
    if (!playUrl) return null;

    const cats = [];
    const catNames = [];
    if (Array.isArray(it.categories)) {
      for (const c of it.categories) {
        if (c && c.slug) cats.push(String(c.slug).toLowerCase());
        if (c && c.name) catNames.push(String(c.name));
      }
    }
    const title = this._cleanTitle(it.text) || (it.user || "") || String(it.uuid);
    const typeName = catNames.length ? catNames[0] : undefined;
    const thumb = this._validUrl(it.thumb) || undefined;

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[it.uuid] = {
      playUrl,
      isHls: !!hls,
      thumb,
      title,
      desc: (it.text || "").trim(),
      typeName,
      user: it.user || "",
    };

    const vod = {
      id: String(it.uuid),
      title,
      poster: thumb,
      type_name: typeName,
      vod_remarks: it.duration || undefined,
    };
    const hay = ((it.text || "") + " " + catNames.join(" ") + " " + (it.user || "")).toLowerCase();
    return { vod, _cats: cats, _hay: hay };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      // 池未命中(如冷启动直接进详情)—— 用 single 端点拉单条。
      let it;
      try {
        const raw = await this._getJson(ctx, "/api/posts", { single: id });
        it = raw && Array.isArray(raw.data) && raw.data[0];
      } catch (e) {
        /* ignore */
      }
      const parsed = it ? this._parse(ctx, it) : null;
      info = parsed ? this._pendingCache[id] : null;
      if (!info) throw new Error("Sharesome: 未找到视频直链 @ " + id);
    }

    return {
      id,
      title: info.title,
      poster: info.thumb,
      year: "",
      desc: info.desc || info.user || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "sharesome",
          sourceName: "Sharesome",
          // playUrl 已是 HLS master 或 mp4 直链;isHls 透传给 resolvePlayUrl 定 type。
          episodes: [
            { playUrl: info.playUrl + (info.isHls ? "#hls" : "#mp4"), needResolve: true, title: "完整版" },
          ],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // detail 里用 #hls / #mp4 尾标记类型(避免二次请求探测)。
    let url = playUrl;
    let type = "mp4";
    const hashIdx = url.lastIndexOf("#");
    if (hashIdx >= 0) {
      const tag = url.slice(hashIdx + 1);
      if (tag === "hls") type = "hls";
      url = url.slice(0, hashIdx);
    } else if (/\.m3u8(\?|$)/i.test(url)) {
      type = "hls";
    }
    return {
      url,
      type,
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /** 只接受 http(s) 且不是纯目录(video_src 有时是残缺前缀 ".../videos-out/")。 */
  _validUrl(u) {
    if (!u || typeof u !== "string") return "";
    if (!/^https?:\/\//i.test(u)) return "";
    // 残缺前缀(以 / 结尾且没有文件名)视为无效
    if (/\/videos-out\/?$/i.test(u)) return "";
    if (!/\.(mp4|m4v|webm|mov|m3u8)(\?|$)/i.test(u)) return "";
    return u;
  },

  async _fetchTopics(ctx) {
    const CK = "sharesome:topics:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const data = await this._getJson(ctx, "/api/topics");
    const out = [];
    const seen = {};
    for (const t of Array.isArray(data) ? data : []) {
      if (!t || !t.slug) continue;
      const slug = String(t.slug).toLowerCase();
      if (seen[slug]) continue;
      seen[slug] = true;
      out.push({
        slug,
        name: this._decode(t.name || slug),
        posts_no: t.posts_no || 0,
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
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },

  /** 清洗帖子文本作标题:去 hashtag / URL,截断 80 字符;全是标签/链接则返空。 */
  _cleanTitle(text) {
    if (!text || typeof text !== "string") return "";
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const cleaned = this._decode(line)
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/#[^\s#]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned && cleaned.length >= 2) {
        return cleaned.length > 80 ? cleaned.slice(0, 80).trim() + "…" : cleaned;
      }
    }
    return "";
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
      .replace(/&nbsp;/g, " ")
      .trim();
  },
};
