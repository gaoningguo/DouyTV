/**
 * FreakTok 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - FreakTok (freaktok.com) 是 Reddit NSFW 短视频聚合站(Netlify SPA + Supabase 后端)。
 *  - 数据全在 Supabase 的公开 `feed` 表里,前端用内置的 anon JWT(apikey + Bearer)
 *    直读 PostgREST。该 anon key 对所有访客一样、写死在 bundle 里,匿名可读。
 *  - 视频直链 = feed.video,指向 BunnyCDN(anon-pull-zone.b-cdn.net)的 .mp4,
 *    实测匿名 206 video/mp4、支持 Range、不校验 Referer/UA。
 *  - `feed` 表无缩略图字段,poster 留空,App 会用视频首帧兜底(captureFirstFrame)。
 *  - 国内直连 Supabase/CDN 可能被墙,请在「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 列表: GET {supa}/rest/v1/feed?select=*&is_active=eq.true&order=score.desc
 *            &limit=<n>&offset=<n>
 *          Header: apikey: <anon>, Authorization: Bearer <anon>
 *          → [{ id, user, permalink, video, score, subreddit, title,
 *               userImage, userVerified, tags, is_active }]
 *  - 分类: subreddit=eq.<name> 过滤;分类清单从 feed 抽样 facet 出来(缓存一天)。
 *  - 搜索: title=ilike.*<kw>* (PostgREST 大小写不敏感模糊)。
 *  - 翻页: offset += limit(offset-based)。
 *  - 播放实测: HEAD https://anon-pull-zone.b-cdn.net/<name>.mp4 → 206 video/mp4。
 */
return {
  meta: {
    name: "FreakTok",
    author: "DouyTV",
    version: "0.1.0",
    description: "FreakTok Reddit NSFW 短视频聚合(成人内容,需代理 + 年龄确认)",
  },

  /** Supabase 基址,可用脚本 config.supa 覆盖(万一换项目)。 */
  _supa(ctx) {
    const s = ctx.config && ctx.config.get && ctx.config.get("supa");
    return (typeof s === "string" && s) || "https://rhyfzzhzvbwvzcptfesu.supabase.co";
  },

  /** 内置 anon JWT(apikey + Bearer),可用脚本 config.anonKey 覆盖(万一轮换)。 */
  _anonKey(ctx) {
    const k = ctx.config && ctx.config.get && ctx.config.get("anonKey");
    if (typeof k === "string" && k) return k;
    return (
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoeWZ6emh6dmJ3dnpjcHRmZXN1Iiwicm9sZSI6ImFub24i" +
      "LCJpYXQiOjE3NDA1MTA4OTEsImV4cCI6MjA1NjA4Njg5MX0." +
      "mMHnp7iyTHu3XTG9eSN9K7pN69qrJqxspXBf4Nno5eA"
    );
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
    const key = this._anonKey(ctx);
    return {
      "User-Agent": this._ua(ctx),
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      apikey: key,
      Authorization: "Bearer " + key,
    };
  },

  async _getRows(ctx, query) {
    const url = ctx.utils.buildUrl(this._supa(ctx) + "/rest/v1/feed", query);
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("FreakTok HTTP " + res.status + " @ " + url);
    const data = res.json ? await res.json() : null;
    return Array.isArray(data) ? data : [];
  },

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "热门", group: "浏览" }];
    let subs = [];
    try {
      subs = await this._fetchSubreddits(ctx);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("FreakTok 分类抓取失败:", String(e));
    }
    // 亚洲相关排前面(照站点内容偏好)。
    const asian = [];
    const other = [];
    for (const s of subs) {
      (this._asianRank(s.name) < 99 ? asian : other).push(s);
    }
    const item = (s, group) => ({ id: "sub:" + s.name, name: s.name, group });
    for (const s of asian) sources.push(item(s, "亚洲"));
    for (const s of other) sources.push(item(s, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    const extra = {};
    if (id.indexOf("sub:") === 0) {
      extra.subreddit = "eq." + id.slice("sub:".length);
    }
    return this._feed(ctx, p, extra);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    // PostgREST ilike:*kw* —— 大小写不敏感模糊匹配 title。
    return this._feed(ctx, p, {
      title: "ilike.*" + kw.replace(/[*,()]/g, " ").trim() + "*",
    });
  },

  /**
   * 通用列表:offset 翻页,order=score.desc,只取 is_active=true。
   * extra 里放额外 PostgREST 过滤(subreddit=eq.x / title=ilike.*kw*)。
   */
  async _feed(ctx, page, extra) {
    const LIMIT = 30;
    const query = {
      select: "*",
      is_active: "eq.true",
      order: "score.desc",
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
    };
    for (const k in extra) {
      if (extra[k] != null && extra[k] !== "") query[k] = extra[k];
    }
    let rows;
    try {
      rows = await this._getRows(ctx, query);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("FreakTok 列表失败:", String(e));
      return { list: [], page, pageCount: page, total: 0 };
    }
    const list = [];
    for (const r of rows) {
      const vod = this._toVod(r);
      if (vod) list.push(vod);
    }
    const hasMore = rows.length >= LIMIT;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * feed 行 → ScriptVodItem。id 用 feed.id(detail 靠它回查)。
   * 无缩略图字段 → poster 留空,App 用视频首帧兜底。
   */
  _toVod(r) {
    if (!r || r.id == null || !r.video) return null;
    const id = String(r.id);
    const title = (r.title || r.user || id).toString().trim();

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      video: String(r.video),
      title,
      author: (r.user || "").toString(),
      subreddit: (r.subreddit || "").toString(),
    };

    return {
      id,
      title,
      poster: undefined,
      type_name: r.subreddit || undefined,
      vod_remarks: r.user ? "@" + r.user : undefined,
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      const rows = await this._getRows(ctx, {
        select: "*",
        id: "eq." + id,
        limit: 1,
      });
      const r = rows[0];
      if (!r || !r.video) {
        throw new Error("FreakTok: 未找到该视频(可能已删除)@ " + id);
      }
      info = {
        video: String(r.video),
        title: (r.title || r.user || id).toString().trim(),
        author: (r.user || "").toString(),
        subreddit: (r.subreddit || "").toString(),
      };
    }
    return {
      id,
      title: info.title,
      poster: undefined,
      year: "",
      desc: info.author ? "@" + info.author : "",
      type_name: info.subreddit || undefined,
      playbacks: [
        {
          sourceId: sourceId || "freaktok",
          sourceName: "FreakTok",
          episodes: [{ playUrl: info.video, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 BunnyCDN .mp4 直链,实测不校验 Referer/UA,给个像样 UA 即可。
    return {
      url: playUrl,
      type: "mp4",
      headers: { "User-Agent": this._ua(ctx) },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  /**
   * 从 feed 抽样(取 score 靠前若干行的 subreddit)facet 出分类清单,按出现次数排序。
   * Supabase REST 不便做 DISTINCT,这里抽 500 行统计,够覆盖热门 subreddit。缓存一天。
   */
  async _fetchSubreddits(ctx) {
    const CK = "freaktok:subs:v1";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const rows = await this._getRows(ctx, {
      select: "subreddit",
      is_active: "eq.true",
      order: "score.desc",
      limit: 500,
    });
    const count = {};
    for (const r of rows) {
      const s = r && r.subreddit;
      if (!s) continue;
      count[s] = (count[s] || 0) + 1;
    }
    const out = Object.keys(count)
      .map((name) => ({ name, count: count[name] }))
      .sort((a, b) => b.count - a.count);
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
};
