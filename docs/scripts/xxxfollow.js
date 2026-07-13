/**
 * XXXFollow 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - XXXFollow 是竖屏成人短视频聚合站(partnersoft/xfollow 平台的自研 SPA)。
 *  - 关键坑:打包里硬编码的 `urlBaseApi:"https://api.xxxfollow.com"` 是 **死域名(NXDOMAIN)**,
 *    不能用。SPA 运行时真正的 API base 由 setHost 用 `window.location.hostname` 拼出:
 *        urlBaseApi = `https://${location.hostname}/api/v1`
 *    也就是 **同源** `https://www.xxxfollow.com/api/v1`(实测该路径下所有端点匿名 200)。
 *  - 视频/封面/头像都直接托管在主站 www.xxxfollow.com/media/...,匿名可拉,
 *    HEAD/GET 实测 200/206 video/mp4 且支持 Range seek,不需要 Referer/UA。
 *    (付费帖 media 落在 media-secure.xfollow.com 带签名/过期,sd_url/url 为 null —— 已在脚本里过滤。)
 *  - 国内直连被墙且主站挂 Cloudflare,请在「设置 → 代理」配代理,scriptFetch 与播放代理会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (base = https://www.xxxfollow.com/api/v1,实测状态码见注释):
 *  - 首页推荐流: GET /user/public?genders=fm&limit=24&page=<p>&start_time=<ts>   → 200
 *       返回 { list:[wrapperItem], page, start_time, ... }。这是 trend-combined 推荐器,
 *       每页只回 ~4 条,但翻页会给不同内容,所以照 page 累积翻即可。
 *       start_time 是本轮快照的基准时间戳(秒),同一浏览会话内多页要用同一个值,脚本按 sourceId 缓存。
 *  - 分类流:    GET /post/tag/<tag>?genders=fm&period=all&limit=24&page=<p>&start_time=<ts> → 200
 *       正常每页 24 条,可稳定翻页。period 必须是 all(latest/new/trend 等都回空)。
 *  - 分类清单/搜索候选: GET /tag?q=<query>   → 200  { list:[{id,tag}], page }  (q 为空回热门 250 个 tag)
 *  - 单帖详情:  GET /post/public/<id>  → 200  返回一个 wrapperItem(字段同 list 项)。
 *  - limit 上限 24(>24 会 400 "The limit must not be greater than 24.")。
 *
 * wrapperItem 结构(list / 单帖通用):
 *   { is_locked, is_locked_payment, is_locked_subscription, post:{ id, slug, text, type, user:{...},
 *     media:[{ type:"video", url, fhd_url, sd_url, thumb_url, start_url, duration_in_second, ... }],
 *     tags:[{id,tag,display}] }, like_count, favorite_count, view_count }
 *   播放直链优先级: media.fhd_url || media.url || media.sd_url(免费帖至少有一个非 null)。
 *
 * 实测播放证据:
 *   HEAD https://www.xxxfollow.com/media/fans/post_public/4025/40252873/1236761.mp4
 *     → 200 video/mp4 8,474,506B / Range 206 OK(无需 Referer/UA)
 *   HEAD .../1061826_sd.mp4 → 200 video/mp4 1,569,902B Accept-Ranges: bytes
 */
return {
  meta: {
    name: "XXXFollow",
    author: "DouyTV",
    version: "0.1.0",
    description: "XXXFollow 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** 站点基址,可用脚本 config.base 覆盖(万一换域名)。API 走同源 /api/v1。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://www.xxxfollow.com";
  },

  _api(ctx) {
    return this._base(ctx) + "/api/v1";
  },

  /** 内容性别过滤,默认 fm(女+男),可用 config.genders 覆盖。 */
  _genders(ctx) {
    const g = ctx.config && ctx.config.get && ctx.config.get("genders");
    return (typeof g === "string" && g) || "fm";
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
    const url = ctx.utils.buildUrl(this._api(ctx) + path, query || {});
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("XXXFollow HTTP " + res.status + " @ " + url);
    return res.json();
  },

  /**
   * 取(并缓存)一个 source 的 start_time 快照基准。
   * 首页/分类流分页时同一会话要用同一个 start_time,否则内容会乱跳。
   */
  async _startTime(ctx, key) {
    const ck = "xxxfollow:st:" + key;
    try {
      const cached = await ctx.cache.get(ck);
      if (cached) return cached;
    } catch (e) {
      /* ignore */
    }
    const ts = Math.floor(Date.now() / 1000);
    try {
      await ctx.cache.set(ck, ts, 1800);
    } catch (e) {
      /* ignore */
    }
    return ts;
  },

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "推荐", group: "浏览" }];
    let tags = [];
    try {
      const data = await this._getJson(ctx, "/tag", { q: "" });
      tags = (data && Array.isArray(data.list) && data.list) || [];
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("XXXFollow 分类抓取失败:", String(e));
    }
    // 亚洲相关排前面。
    const asian = [];
    const other = [];
    for (const t of tags) {
      if (!t || !t.tag) continue;
      (this._asianRank(t.tag) < 99 ? asian : other).push(t);
    }
    const item = (t, group) => ({
      id: "tag:" + t.tag,
      name: t.tag,
      group,
    });
    for (const t of asian) sources.push(item(t, "亚洲"));
    for (const t of other) sources.push(item(t, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    const genders = this._genders(ctx);
    if (id.indexOf("tag:") === 0) {
      const tag = id.slice("tag:".length);
      const st = await this._startTime(ctx, id);
      const data = await this._getJson(
        ctx,
        "/post/tag/" + encodeURIComponent(tag),
        { genders, period: "all", limit: 24, page: p, start_time: st }
      );
      return this._toFeed(ctx, data, p, 24);
    }
    // 首页推荐流(每页 ~4 条,但会翻)。
    const st = await this._startTime(ctx, "latest");
    const data = await this._getJson(ctx, "/user/public", {
      genders,
      limit: 24,
      page: p,
      start_time: st,
    });
    return this._toFeed(ctx, data, p, 1);
  },

  /**
   * 搜索:站点是标签制的,没有帖子全文搜索端点。
   * 做法:先 /tag?q=<kw> 找最匹配的 tag,再拉该 tag 的帖子流。
   */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };

    // 第 1 页时解析出目标 tag 并缓存,后续页复用。
    const tagKey = "xxxfollow:search-tag:" + kw.toLowerCase();
    let tag = null;
    try {
      tag = await ctx.cache.get(tagKey);
    } catch (e) {
      /* ignore */
    }
    if (!tag) {
      try {
        const td = await this._getJson(ctx, "/tag", { q: kw });
        const list = (td && Array.isArray(td.list) && td.list) || [];
        tag = this._pickTag(list, kw);
      } catch (e) {
        ctx.log && ctx.log.warn && ctx.log.warn("XXXFollow 搜索 tag 失败:", String(e));
      }
      if (tag) {
        try {
          await ctx.cache.set(tagKey, tag, 1800);
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (!tag) return { list: [], page: p, pageCount: p, total: 0 };

    const st = await this._startTime(ctx, "search:" + tag);
    let data;
    try {
      data = await this._getJson(ctx, "/post/tag/" + encodeURIComponent(tag), {
        genders: this._genders(ctx),
        period: "all",
        limit: 24,
        page: p,
        start_time: st,
      });
    } catch (e) {
      return { list: [], page: p, pageCount: p, total: 0 };
    }
    return this._toFeed(ctx, data, p, 24);
  },

  /** 从 tag 候选里挑一个最贴 keyword 的(优先精确 > 前缀 > 包含 > 第一个)。 */
  _pickTag(list, kw) {
    const k = kw.toLowerCase().replace(/\s+/g, "");
    let contains = null;
    let prefix = null;
    for (const t of list) {
      if (!t || !t.tag) continue;
      const name = String(t.tag).toLowerCase().replace(/^#/, "");
      if (name === k) return t.tag;
      if (!prefix && name.indexOf(k) === 0) prefix = t.tag;
      if (!contains && name.indexOf(k) >= 0) contains = t.tag;
    }
    if (prefix) return prefix;
    if (contains) return contains;
    return list[0] && list[0].tag;
  },

  /** API 返回体 → { list, page, pageCount, total }。fullPageSize 用于判断是否还有下一页。 */
  _toFeed(ctx, data, page, fullPageSize) {
    const arr = (data && Array.isArray(data.list) && data.list) || [];
    const list = [];
    for (const it of arr) {
      const vod = this._toVod(ctx, it);
      if (vod) list.push(vod);
    }
    // 首页流每页很小(~4),只要还有内容就继续翻;分类流按满页判断。
    const hasMore =
      fullPageSize <= 1 ? arr.length > 0 : arr.length >= fullPageSize;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * wrapperItem → ScriptVodItem。过滤付费/无视频直链的帖子。
   * 顺便把解析结果塞内存缓存供 detail 命中。
   */
  _toVod(ctx, item) {
    const info = this._extract(item);
    if (!info) return null;

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[info.id] = info;

    return {
      id: info.id,
      title: info.title,
      poster: info.poster,
      poster_headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
      type_name: info.typeName,
      vod_remarks: info.remarks,
    };
  },

  /**
   * 从 wrapperItem 抽出播放所需的一切。付费/无免费直链返回 null。
   */
  _extract(item) {
    if (!item) return null;
    const post = item.post || item;
    if (!post || !post.id) return null;

    // 付费/订阅锁的帖子拿不到匿名直链,跳过。
    if (
      item.is_locked ||
      item.is_locked_payment ||
      item.is_locked_subscription ||
      (post.access && post.access !== "free")
    ) {
      return null;
    }

    const media = Array.isArray(post.media) ? post.media : [];
    let video = null;
    for (const m of media) {
      if (!m || m.type !== "video") continue;
      const u = m.fhd_url || m.url || m.sd_url;
      if (u) {
        video = { url: u, media: m };
        break;
      }
    }
    if (!video) return null;

    const m = video.media;
    const poster =
      m.thumb_url || m.start_url || m.thumb_webp_url || m.start_webp_url || undefined;
    const user = post.user || {};
    const title =
      this._clean(post.text) ||
      (user.display_name || user.username || "") ||
      String(post.id);
    const tags = Array.isArray(post.tags) ? post.tags : [];
    const typeName = tags.length ? tags[0].display || tags[0].tag : undefined;
    const likes = item.like_count || 0;
    const remarks = likes ? this._fmtCount(likes) + " 赞" : undefined;

    return {
      id: String(post.id),
      title,
      poster,
      typeName,
      remarks,
      url: video.url,
      desc: this._clean(post.text),
      author: user.display_name || user.username || "",
      duration: m.duration_in_second || 0,
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      let item;
      try {
        item = await this._getJson(ctx, "/post/public/" + encodeURIComponent(id));
      } catch (e) {
        throw new Error("XXXFollow: 详情请求失败 @ " + id + " — " + String(e));
      }
      info = this._extract(item);
      if (!info) {
        throw new Error("XXXFollow: 该帖无免费视频直链(可能付费/已删)@ " + id);
      }
    }
    return {
      id,
      title: info.title,
      poster: info.poster,
      year: "",
      desc: info.desc || info.author || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "xxxfollow",
          sourceName: "XXXFollow",
          episodes: [{ playUrl: info.url, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是主站 media 上的 .mp4 直链,匿名 200/206,给个像样 UA + Referer。
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

  _fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  },

  _clean(s) {
    if (!s || typeof s !== "string") return "";
    return s.replace(/\s+/g, " ").trim();
  },

  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hong\s*kong|中文|中国|中國|台湾|台灣|香港/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|日本|里番/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (/asian|asia|thai|desi|filipina|filipino|vietnam|indian|亚洲|亞洲/i.test(s)) return 3;
    return 99;
  },
};
