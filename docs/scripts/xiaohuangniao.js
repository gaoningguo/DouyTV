/**
 * 小黄鸟 (xiaohuangniao.me / 黄推搜索) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 小黄鸟是聚合 Twitter/X 福利推的竖屏短视频站,前端 Next.js(客户端 axios/fetch),
 *    数据后端统一走 /api/requestdb?type=<type>&...(返回真实 tweet 对象,内联全档媒体)。
 *  - 【只有两个有效 type】(2026-07 逆向,经 127.0.0.1:7897 代理实测):
 *      1. type=hot-tweets&limit=12   —— 热门流,固定 12 条,【不分页】(page/offset 均被忽略)。
 *         响应: { success:true, data:[ <tweet>, ... ] }。
 *      2. type=search-tweets&query=<kw>&page=<n>&limit=<m> —— 关键词搜索,【可分页】。
 *         响应: { success:true, data:{ tweets:[...], total, page, totalPages } }。
 *    其余 type 一律 {"error":"Invalid type parameter"}。故【分类】= 预设几个中文关键词
 *    (探花/福利姬/网红/吃瓜/黑料/JK…,取自 /categories 路由)走 search-tweets。
 *  - 【媒体直链已内联在列表项里】,无需详情页二次请求:
 *      tweet.mediaUrls[] —— 简化直链,video 项 url 是最高码率 mp4(video.twimg.com/amplify_video/.../*.mp4)。
 *      tweet.extendedEntities.media[].video_info.variants[] —— 全档(m3u8 + 多档 mp4),兜底用。
 *      封面 media_url_https / mediaUrls[].url 对应的 amplify_video_thumb/*.jpg。
 *    实测 twimg mp4 带浏览器 UA → 206 video/mp4;m3u8 → 200 application/x-mpegURL(均可播)。
 *  - twimg CDN 不校验 Referer(带 UA 即可);国内直连被墙 → 「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-20,全程匿名,经代理):
 *  - LIST: GET /api/requestdb?type=hot-tweets&limit=12 → 200,data[] 12 条,10 条带 video。
 *  - SEARCH: GET /api/requestdb?type=search-tweets&query=asian&page=1&limit=20 → data.tweets 20 条,
 *            total=45 totalPages(随 limit 变);page=2/3 首条(置顶)不变、其余切换。
 *  - PLAY: mediaUrls[0].url = video.twimg.com/amplify_video/<id>/vid/avc1/1280x720/*.mp4 → 带 UA 206 video/mp4。
 */
return {
  meta: {
    name: "小黄鸟",
    author: "DouyTV",
    version: "0.1.0",
    description: "小黄鸟 黄推聚合(Twitter/X 福利推,成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://xiaohuangniao.me";
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
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: this._base(ctx) + "/",
      Accept: json
        ? "application/json, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  async _getJson(ctx, query) {
    const url = ctx.utils.buildUrl(this._base(ctx) + "/api/requestdb", query);
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx, true),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("小黄鸟 HTTP " + res.status + " @ " + url);
    const data = await res.json();
    if (!data || data.success !== true) {
      throw new Error("小黄鸟 API error: " + JSON.stringify(data && data.error));
    }
    return data.data;
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  // 站点无分类接口,分类 = /categories 路由页 __next_f 里预设的中文关键词清单
  // (2026-07 从站点抓取,均已验证 search-tweets 能返回结果),走 search-tweets。
  _categories() {
    const kws = [
      "福利姬", "探花", "吃瓜", "萝莉", "抖音风", "露出", "自慰", "喷水",
      "母狗", "裸舞", "绿帽", "巨乳", "户外", "抖音", "网红", "熟女",
      "足交", "强奸", "顶胯", "四爱", "宿舍", "情侣", "推特", "反差",
      "学生", "口交", "乱伦", "调教", "制服", "白虎", "人妻", "御姐",
      "呻吟", "少妇", "骚货", "内射", "嫩模", "空姐", "双飞", "女神",
      "极品", "约炮", "偷拍", "车震", "楼凤", "少女", "网黄", "玩具",
      "群交", "肛交", "颜射", "素人", "出轨", "换妻",
    ];
    return kws.map((kw) => ({ kw, name: kw }));
  },

  async getSources() {
    const sources = [{ id: "hot", name: "热门", group: "浏览" }];
    for (const c of this._categories()) {
      sources.push({ id: "kw:" + c.kw, name: c.name, group: "分类" });
    }
    return sources;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  // 推荐流的"续页词":hot-tweets 只有 12 条且不分页,第 2 页起用覆盖面最广的
  // 宽泛 query 走 search-tweets 续接,让推荐流能持续下滑。
  _HOT_FILL_QUERY: "女",

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "hot";
    if (id.indexOf("kw:") === 0) {
      return this._search(ctx, id.slice("kw:".length), p);
    }
    // 第 1 页:hot-tweets 真·热门(12 条,不分页)。
    if (p <= 1) return this._hot(ctx);
    // 第 2 页起:hot-tweets 无更多 → 切到宽泛 search-tweets 续页(page 相对偏移 1)。
    return this._search(ctx, this._HOT_FILL_QUERY, p - 1);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._search(ctx, kw, p);
  },

  // 热门:type=hot-tweets(data 是数组,固定 ~12 条,服务端不分页)。
  // pageCount 返回 2 → 告诉 App 还有下一页,recommend 第 2 页会切到 search-tweets 续接。
  async _hot(ctx) {
    const data = await this._getJson(ctx, { type: "hot-tweets", limit: 24 });
    const arr = Array.isArray(data) ? data : [];
    const list = [];
    for (const t of arr) {
      const vod = this._toVod(t);
      if (vod) list.push(vod);
    }
    return { list, page: 1, pageCount: list.length ? 2 : 1, total: list.length };
  },

  // 搜索/分类:type=search-tweets(data.tweets + total/page/totalPages,可分页)。
  async _search(ctx, keyword, page) {
    const data = await this._getJson(ctx, {
      type: "search-tweets",
      query: keyword,
      page,
      limit: 24,
    });
    const arr = (data && Array.isArray(data.tweets) && data.tweets) || [];
    const list = [];
    for (const t of arr) {
      const vod = this._toVod(t);
      if (vod) list.push(vod);
    }
    const totalPages = parseInt((data && data.totalPages) || "0", 10) || 0;
    const hasMore = totalPages ? page < totalPages : arr.length >= 24;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: (data && data.total) || list.length,
    };
  },

  /**
   * tweet → ScriptVodItem。只保留带视频的推(纯图/纯文本跳过)。
   * 直链已内联,直接缓存供 detail/resolve 命中,免二次请求。
   */
  _toVod(t) {
    if (!t || !t.tweetId) return null;
    const media = this._pickVideo(t);
    if (!media || !media.url) return null; // 无视频 → 跳过
    const id = String(t.tweetId);
    const title = this._title(t);
    const poster = media.poster || "";

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      url: media.url,
      type: media.type,
      poster,
      title,
      author:
        (t.author && (t.author.name || t.author.username)) || "",
      desc: this._clean(t.text || ""),
    };

    return {
      id,
      title,
      poster: poster || undefined,
      type_name: (t.author && (t.author.name || t.author.username)) || undefined,
    };
  },

  async detail(ctx, { id, sourceId }) {
    const info = (this._pendingCache && this._pendingCache[id]) || {};
    // playUrl 直接存最终直链(twimg 无 token,不会过期);缺失才回退现搜。
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
          sourceId: sourceId || "xiaohuangniao",
          sourceName: "小黄鸟",
          episodes: [
            {
              playUrl,
              needResolve: true,
              title: "完整版",
              type: info.type === "hls" ? "hls" : "mp4",
            },
          ],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let url = String(playUrl || "");
    // "id:<tweetId>" → 缓存里没有直链时,靠已知直链回退(此站直链内联在列表,
    // 命中率高;真 miss 时无独立详情接口,只能报错让 App 兜底)。
    if (url.indexOf("id:") === 0) {
      const id = url.slice(3);
      const info = this._pendingCache && this._pendingCache[id];
      if (!info || !info.url) {
        throw new Error("小黄鸟: 无缓存直链,请重新进入列表 @ " + playUrl);
      }
      url = info.url;
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("小黄鸟: 无效播放地址 @ " + playUrl);
    }
    const isHls = /\.m3u8(\?|$)/i.test(url);
    // twimg CDN 拒绝非 twitter 的 Referer(带站点 Referer 会 403),
    // 用 x.com 作 Referer;非 twimg 直链也无妨。
    return {
      url,
      type: isHls ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: /\btwimg\.com/i.test(url) ? "https://x.com/" : this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 媒体解析 ───────────────────────── */

  /**
   * 从 tweet 抽取一条视频直链 + 封面。优先级:
   *  1) mediaUrls[] 里 type=video 的项(url 已是最高码率 mp4)
   *  2) extendedEntities.media[].video_info.variants[](挑最高码率 mp4;无 mp4 用 m3u8)
   * 返回 { url, type:'mp4'|'hls', poster } 或 null。
   */
  _pickVideo(t) {
    // 1) 简化直链
    const mu = Array.isArray(t.mediaUrls) ? t.mediaUrls : [];
    for (const m of mu) {
      if (m && m.type === "video" && typeof m.url === "string" && m.url) {
        return {
          url: m.url,
          type: /\.m3u8(\?|$)/i.test(m.url) ? "hls" : "mp4",
          poster: this._thumbFromMedia(t),
        };
      }
    }
    // 2) extendedEntities.variants 兜底
    const media =
      (t.extendedEntities &&
        Array.isArray(t.extendedEntities.media) &&
        t.extendedEntities.media) ||
      [];
    for (const m of media) {
      if (!m || m.type !== "video" || !m.video_info) continue;
      const variants = Array.isArray(m.video_info.variants)
        ? m.video_info.variants
        : [];
      let bestMp4 = null;
      let hls = "";
      for (const v of variants) {
        if (!v || !v.url) continue;
        if (v.content_type === "video/mp4") {
          if (!bestMp4 || (v.bitrate || 0) > (bestMp4.bitrate || 0)) bestMp4 = v;
        } else if (/mpegurl/i.test(v.content_type || "")) {
          hls = v.url;
        }
      }
      if (bestMp4) {
        return {
          url: bestMp4.url,
          type: "mp4",
          poster: m.media_url_https || this._thumbFromMedia(t),
        };
      }
      if (hls) {
        return { url: hls, type: "hls", poster: m.media_url_https || "" };
      }
    }
    return null;
  },

  _thumbFromMedia(t) {
    const media =
      (t.extendedEntities &&
        Array.isArray(t.extendedEntities.media) &&
        t.extendedEntities.media) ||
      [];
    for (const m of media) {
      if (m && m.media_url_https) return m.media_url_https;
    }
    const mu = Array.isArray(t.mediaUrls) ? t.mediaUrls : [];
    for (const m of mu) {
      if (m && m.type === "photo" && m.url) return m.url;
    }
    return "";
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  // 推文本身没标题 —— 取正文首行、去话题标签/链接,截断做标题。
  _title(t) {
    const raw = this._clean(t.text || "");
    if (raw) {
      const firstLine = raw.split(/\n/)[0].trim();
      const s = (firstLine || raw).slice(0, 40).trim();
      if (s) return s;
    }
    return String(t.tweetId || "推文");
  },

  // 清正文:去 URL、去 #话题堆、压空白。
  _clean(s) {
    if (!s || typeof s !== "string") return "";
    return s
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/#[^\s#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },
};
