/**
 * Pektino (pektino.com) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - pektino.com 是「X(Twitter)免费成人视频保存排行榜」——
 *    采集 X(twitter)上的成人视频做排行,自己不托管视频,
 *    直链最终是 video.twimg.com(与 xhs18 / xiaohuangniao 同一族)。
 *  - 【Next.js App Router】页面数据在 flight 载荷 self.__next_f.push([1,"..."]) 里,
 *    列表项挂在 "initialItems":[...] 数组(JSON 被反斜杠转义,需先反转义再解析)。
 *  - 【列表项自带直链】initialItems 每条已内联 mp4 直链 + 封面,
 *    【一次拿全、无需详情二请】(detail 命中缓存即可直接播)。
 *    item 形态(2026-08 实测):
 *      { id, url_cd, url(mp4 直链), thumbnail(pbs.twimg 封面), time(时长秒),
 *        posted_at, pv(浏览数), favorite(点赞), tweet_url, tweet_account, anime_title }
 *
 *  - 【分类 = 榜单周期,走 locale 前缀路径】(不是 query 参数!):
 *      每日榜   GET /zh-CN            (根路径即当日榜)
 *      每周榜   GET /zh-CN/weekly
 *      每月榜   GET /zh-CN/monthly
 *      所有时间 GET /zh-CN/all
 *    四者首条各不相同(实测),是真正独立的榜单。locale 段可用 config.locale 覆盖
 *    (zh-CN 出中文站名/文案;不带 locale 的 / 会出日文)。
 *  - 【翻页】?page=N,每页 50 条。深度按榜单不同:每日榜约 10 页到底,
 *    /all 极深(实测 page=500 仍满 50 条且与前几页零重叠)。故【不能硬编码上限】,
 *    以「本页解析出 0 条」为到底信号。
 *  - 【站点 20 个 /category/<slug> 全是死链】(巨乳/JK/コスプレ… 逐个实测均返回
 *    「見つかりません」空页 0 条),故【不暴露分类】,免得给用户一堆空列表。
 *  - 【无服务端搜索】/search?q= 返 0 条;/?q= /?keyword= /?s= 均被忽略(返回未过滤列表)。
 *    故搜索改为「拉前若干页 → 按 投稿者/slug/作品名 本地过滤」(同 reelsmunkey 思路)。
 *
 *  - 【url_cd 大小写敏感 —— 关键坑】详情页 /zh-CN/movie/<url_cd> 必须【原样保留大小写】:
 *      /zh-CN/movie/FCZ2PdNKtEDDpUce → 200 102KB(含 mp4)
 *      /zh-CN/movie/fcz2pdnkteddpuce → 200 21KB 空页(0 个 mp4)
 *    所以任何比较/拼接都不能 toLowerCase()。
 *  - 【twimg 403 修复】video.twimg.com CDN 【拒绝非 twitter 的 Referer】:
 *      无 Referer → 206;Referer: https://x.com/ → 206;
 *      Referer: https://pektino.com/ → 【403】。
 *    故 resolvePlayUrl 必须用 Referer: https://x.com/,绝不能用本站。
 *    封面 pbs.twimg.com 不校验 Referer(带与不带均 200),无需 poster_headers。
 *  - 站点本体国内可直连(未被墙),但 twimg 直链/封面被墙 →
 *    「设置 → 代理」配好代理,scriptFetch 与 dyproxy 拉流都会走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-08,经 127.0.0.1:7897 代理验证):
 *  - RANK:   /zh-CN /zh-CN/weekly /zh-CN/monthly /zh-CN/all → 各 200,均 50 条,
 *            首条 url_cd 四者互不相同(独立榜单)。
 *  - PAGE:   /zh-CN/all?page=1|2|3|500 → 各 50 条,两两重叠 0(翻页真实且极深);
 *            每日榜 page=10 附近开始不足 50 → 以空页判定到底。
 *  - DETAIL: /zh-CN/movie/FCZ2PdNKtEDDpUce → 200,内联同一 mp4;
 *            小写 slug → 200 但空页(大小写敏感)。
 *  - PLAY:   GET(Range 0-1023)twimg mp4 → 206 video/mp4(无 Referer / x.com 皆可);
 *            带 pektino Referer → 403。
 *  - CATS:   /category/{kyonyu,anime,jk,beautiful-girl,cosplay,hamedori,
 *            married-woman,gal,sm} → 全部 0 条(見つかりません)。
 */
return {
  meta: {
    name: "Pektino",
    author: "DouyTV",
    version: "0.1.0",
    description: "Pektino X(Twitter)成人视频排行榜(twimg 聚合,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://pektino.com";
  },

  /** 站点语言段。zh-CN 出中文文案;可用 config.locale 改成 ja / en 等。 */
  _locale(ctx) {
    const l = ctx.config && ctx.config.get && ctx.config.get("locale");
    if (typeof l === "string" && l.trim()) return l.trim().replace(/^\/+|\/+$/g, "");
    return "zh-CN";
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
      "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
      Referer: this._base(ctx) + "/",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  },

  /**
   * 站点自身请求(列表/详情页)。
   *
   * 【关键:本站与播放域需要相反的出口】实测(2026-08):
   *     pektino.com            直连 200 / 走代理 000(5/5 全挂)
   *     video.twimg.com        直连 000(被墙)/ 走代理 206
   *     cdn.syndication.twimg  直连 000(被墙)/ 走代理可达
   *   即:本站【不被墙、且多数机场节点不给它路由】,而 twimg【必须走代理】。
   *   所以不能让整站请求都跟随全局代理 —— 否则用户为了能播 twimg 打开代理后,
   *   连列表都拉不出来(这正是"脚本拉不到内容/播不了"的根因)。
   *
   * 策略:本站请求【先直连】(proxyOverride:null 忽略全局代理),失败再退回全局代理
   * (照顾那些本地 DNS 污染/需要代理才能访问本站的网络)。哪种通就记住,后续直接用。
   * twimg 相关请求【不走这个函数】,仍跟随全局代理(见 _freshFromTweet)。
   */
  async _get(ctx, url) {
    const modes =
      this._fetchMode === "proxy"
        ? [undefined, null]
        : this._fetchMode === "direct"
        ? [null, undefined]
        : [null, undefined]; // 未知:先直连(本站不被墙,直连最快)
    let lastErr = null;
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      try {
        const res = await ctx.request.get(url, {
          headers: this._headers(ctx),
          timeout: 20000,
          http2: true,
          proxyOverride: mode,
        });
        // 2xx/3xx/404 都算"这条出口能通"(404 是页面不存在,不是网络不通)
        if (res && (res.ok || res.status === 404)) {
          this._fetchMode = mode === null ? "direct" : "proxy";
          return res;
        }
        lastErr = new Error("HTTP " + (res && res.status));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Pektino: 请求失败 @ " + url);
  },

  /** 榜单 id → 路径后缀(daily 就是 locale 根)。 */
  _RANKS: [
    { id: "daily", name: "每日榜", path: "" },
    { id: "weekly", name: "每周榜", path: "/weekly" },
    { id: "monthly", name: "每月榜", path: "/monthly" },
    { id: "all", name: "总排行", path: "/all" },
  ],
  /* ───────────────────────── flight 数据解析 ───────────────────────── */

  /**
   * 从页面 HTML 抽出 initialItems 数组。
   * Next.js App Router 把数据塞在 self.__next_f.push([1,"...JSON..."]) 里,
   * 其中 JSON 的引号被转义成 \" —— 先整页反转义,再从 "initialItems":[ 起
   * 做括号配平截出完整数组,最后 JSON.parse。
   * 括号配平必须跳过字符串内的 [ ](标题里常有),否则会截错。
   */
  _extractItems(html) {
    if (!html || typeof html !== "string") return [];
    // flight 载荷里的 \" → " ,\\ → \
    const un = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const key = '"initialItems":';
    let from = 0;
    for (;;) {
      const k = un.indexOf(key, from);
      if (k < 0) break;
      from = k + key.length;
      const s = un.indexOf("[", k);
      if (s < 0) break;
      const arr = this._sliceArray(un, s);
      if (!arr) continue;
      let data = null;
      try {
        data = JSON.parse(arr);
      } catch (e) {
        data = null;
      }
      if (Array.isArray(data) && data.length) return data;
    }
    return [];
  },

  /**
   * 详情页【没有 initialItems】—— 本条视频挂在 flight 里的 "media":{...} 上
   * (字段名与列表项一致:url_cd/url/time/thumbnail/pv/tweet_account/anime_title)。
   * 返回所有能解析出的 media 对象(页内可能有多个:本条 + 相关推荐)。
   */
  _extractMedia(html) {
    if (!html || typeof html !== "string") return [];
    const un = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const key = '"media":';
    const out = [];
    let from = 0;
    for (;;) {
      const k = un.indexOf(key, from);
      if (k < 0) break;
      from = k + key.length;
      const s = un.indexOf("{", k);
      if (s < 0) break;
      const obj = this._sliceObject(un, s);
      if (!obj) continue;
      try {
        const o = JSON.parse(obj);
        if (o && o.url_cd && o.url) out.push(o);
      } catch (e) {
        /* ignore */
      }
    }
    return out;
  },

  /** 从 s 处的 '{' 起做花括号配平(跳过字符串/转义),返回完整对象字面量。 */
  _sliceObject(str, s) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = s; i < str.length; i++) {
      const c = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return str.slice(s, i + 1);
      }
    }
    return "";
  },

  /** 从 s 处的 '[' 起做括号配平(跳过字符串/转义),返回完整数组字面量。 */
  _sliceArray(str, s) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = s; i < str.length; i++) {
      const c = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) return str.slice(s, i + 1);
      }
    }
    return "";
  },

  /* ───────────────────────── 榜单(分类) ───────────────────────── */

  // 站点 20 个 /category/<slug> 实测全是空页,故只暴露四个真实榜单周期。
  async getSources() {
    return this._RANKS.map((r) => ({
      id: r.id,
      name: r.name,
      group: "排行榜",
    }));
  },

  /** 榜单列表页 URL:<base>/<locale><path>[?page=N]。 */
  _listUrl(ctx, rankId, page) {
    const r =
      this._RANKS.find((x) => x.id === String(rankId || "")) || this._RANKS[0];
    let url = this._base(ctx) + "/" + this._locale(ctx) + r.path;
    if (page > 1) url += "?page=" + page;
    return url;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = Math.max(1, page || 1);
    const rank = String(sourceId || "daily");
    const items = await this._fetchPage(ctx, rank, p);
    const list = [];
    for (const it of items) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    // 到底信号:本页解析出 0 条(各榜单深度不同,/all 极深,不能硬编码上限)。
    const hasMore = list.length > 0;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  /**
   * 搜索:站点无服务端搜索(/?q= 等一律返回未过滤列表)。
   * 故在「总排行」上拉若干页,按 投稿者(tweet_account)/ slug / 作品名 本地过滤。
   * 每个 App 分页扫站点 3 页(150 条),提升命中率。
   */
  async search(ctx, { keyword, page }) {
    const p = Math.max(1, page || 1);
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };

    const SCAN = 3;
    const list = [];
    let full = 0;
    for (let i = 0; i < SCAN; i++) {
      const sitePage = (p - 1) * SCAN + i + 1;
      let items = [];
      try {
        items = await this._fetchPage(ctx, "all", sitePage);
      } catch (e) {
        break;
      }
      if (!items.length) break;
      full++;
      for (const it of items) {
        if (!this._match(it, kw)) continue;
        const vod = this._toVod(it);
        if (vod) list.push(vod);
      }
    }
    // 扫满 SCAN 页说明后面还有内容可翻(命中与否与是否有下一页无关)。
    const hasMore = full === SCAN;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  /** 关键词本地匹配:投稿者 / slug / 作品名(url_cd 保持原样,匹配时才小写)。 */
  _match(it, kw) {
    const hay =
      String((it && it.tweet_account) || "") +
      " " +
      String((it && it.url_cd) || "") +
      " " +
      String((it && it.anime_title) || "");
    return hay.toLowerCase().indexOf(kw) >= 0;
  },

  /** 抓一页 → initialItems。缓存 5 分钟(翻页/搜索会重复打同一页)。 */
  async _fetchPage(ctx, rank, page) {
    const CK = "pektino:list:" + this._locale(ctx) + ":" + rank + ":" + page;
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const url = this._listUrl(ctx, rank, page);
    const res = await this._get(ctx, url);
    // 越界/不存在的页 → 视作到底(交给上层判空)。
    if (res.status === 404) return [];
    if (!res.ok) throw new Error("Pektino HTTP " + res.status + " @ " + url);
    const items = this._extractItems(await res.text());
    if (items.length) {
      try {
        await ctx.cache.set(CK, items, 300);
      } catch (e) {
        /* ignore */
      }
    }
    return items;
  },
  /* ───────────────────────── 条目转换 ───────────────────────── */

  /**
   * initialItems item → ScriptVodItem。直链已内联,顺手缓存供 detail/resolve 命中。
   * 站点条目【没有标题字段】—— 用 作品名(anime_title)> @投稿者 > slug 兜底造标题。
   * id 用 url_cd 且【严格保留大小写】(详情页大小写敏感)。
   */
  _toVod(it) {
    if (!it || !it.url_cd || !it.url) return null;
    const id = String(it.url_cd);
    const mp4 = String(it.url);
    const title = this._title(it);
    const poster = it.thumbnail ? String(it.thumbnail) : "";
    const author = String(it.tweet_account || "").trim();

    const tweetUrl = String(it.tweet_url || "");
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      url: mp4,
      poster,
      title,
      author,
      tweetUrl,
      // 原帖 status id —— 存库的 mp4 失效时,靠它走 X syndication 换新鲜直链。
      statusId: this._statusId(tweetUrl),
      time: Number(it.time || 0) || 0,
    };

    return {
      id,
      title,
      poster: poster || undefined,
      type_name: author ? "@" + author : undefined,
      vod_remarks: this._remarks(it) || undefined,
    };
  },

  /** 条目无标题字段 —— 作品名 > @投稿者 > slug。 */
  _title(it) {
    const anime = this._decode(String((it && it.anime_title) || "").trim());
    if (anime) return anime;
    const acc = String((it && it.tweet_account) || "").trim();
    if (acc) return "@" + acc;
    return String((it && it.url_cd) || "").trim() || "视频";
  },

  /** 右下角备注:时长 + 浏览数(pv 是字符串)。 */
  _remarks(it) {
    const parts = [];
    const t = Number((it && it.time) || 0) || 0;
    if (t > 0) parts.push(this._dur(t));
    const pv = parseInt(String((it && it.pv) || "0"), 10) || 0;
    if (pv > 0) parts.push(this._compact(pv) + " 次");
    return parts.join(" · ");
  },

  _dur(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    const pad = (n) => (n < 10 ? "0" + n : String(n));
    if (m >= 60) {
      return Math.floor(m / 60) + ":" + pad(m % 60) + ":" + pad(r);
    }
    return m + ":" + pad(r);
  },

  _compact(n) {
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    const slug = String(id); // 保持原样大小写
    let info = this._pendingCache && this._pendingCache[slug];
    if (!info || !info.url) {
      // 缓存 miss(直达详情):抓 /<locale>/movie/<slug>,页内同样内联 initialItems。
      const resolved = await this._resolveBySlug(ctx, slug);
      if (resolved) {
        this._pendingCache = this._pendingCache || {};
        info = Object.assign({}, info || {}, resolved);
        this._pendingCache[slug] = info;
      }
    }
    if (!info) info = { title: slug, poster: "", url: "" };

    const vod = {
      id: slug,
      title: info.title || slug,
      year: "",
      desc: info.tweetUrl ? "原帖: " + info.tweetUrl : "",
      type_name: info.author ? "@" + info.author : undefined,
      playbacks: [
        {
          sourceId: sourceId || "pektino",
          sourceName: "Pektino",
          episodes: [
            {
              // 统一存 "id:<slug>" —— 让 resolvePlayUrl 拿得到 slug/statusId,
              // 以便库里的 mp4 失效(原帖被删/换址 → twimg 403)时能走 syndication 兜底。
              playUrl: "id:" + slug,
              needResolve: true,
              title: "完整版",
            },
          ],
          episodes_titles: ["完整版"],
        },
      ],
    };
    if (info.poster) vod.poster = info.poster;
    return vod;
  },

  /**
   * 播放解析。三段式:
   *   ① 取库里存的 mp4(列表/详情页给的)
   *   ② 体检:HEAD/Range 探一下。库里的地址是采集当时的快照,
   *      【原帖被删/账号被封 → twimg 一律 403】(与 Referer 无关,实测六种
   *      Referer/Origin 组合全 403),此时 ① 的地址已是死链。
   *   ③ 死链 → 用原帖 status id 走 X 公开 syndication(tweet-result,免登录)
   *      换新鲜直链;原帖若也 404(真删了)→ 抛明确错误,别让播放器空转。
   */
  async resolvePlayUrl(ctx, { playUrl }) {
    let raw = String(playUrl || "").trim();
    if (!raw) throw new Error("Pektino: 缺少播放地址");

    let slug = "";
    let url = "";
    let info = null;

    if (raw.indexOf("id:") === 0) {
      slug = raw.slice(3);
      info = (this._pendingCache && this._pendingCache[slug]) || null;
      if (info && info.url) {
        url = info.url;
      } else {
        const resolved = await this._resolveBySlug(ctx, slug);
        if (resolved && resolved.url) {
          info = resolved;
          url = resolved.url;
          this._pendingCache = this._pendingCache || {};
          this._pendingCache[slug] = Object.assign(
            {},
            this._pendingCache[slug] || {},
            resolved
          );
        }
      }
    } else {
      url = raw; // 兼容旧库里固化的直链
    }

    // ② 库存直链只是抓站当时的快照 —— 原帖被删/账号被封后 twimg 会 403。
    //    先【轻量探活】(Range: bytes=0-0,只取 1 字节),死了才走 syndication 换新。
    //    为什么不无条件走 syndication:该接口限流很凶(实测连续请求即 429),
    //    每次播放都打会很快被封,反而把能播的也拖挂。
    //
    //    探活/兜底【绝不阻断播放】:探不通(超时/限流/代理抖动)一律当"还活着",
    //    直接把库存地址交给播放器,让 dyproxy 去试 —— 宁可让播放器报错,
    //    也不要脚本层误判把好视频拦死。
    if (url && slug) {
      const dead = await this._isDead(ctx, url);
      if (dead) {
        const fresh = await this._freshFromTweet(ctx, slug, info);
        if (fresh) {
          url = fresh;
        } else {
          throw new Error(
            "Pektino: 该条源视频已失效(原帖被删或账号被封),换一条试试"
          );
        }
      }
    }

    if (!url) {
      // 库里没地址 —— 最后再试一次 syndication。
      const fresh = await this._freshFromTweet(ctx, slug, info);
      if (!fresh) throw new Error("Pektino: 无法解析播放地址 @ " + playUrl);
      url = fresh;
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Pektino: 无效播放地址 @ " + playUrl);
    }

    return {
      url,
      type: /\.m3u8(\?|$)/i.test(url) ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        // video.twimg.com 【拒绝非 twitter 的 Referer】(带 pektino → 403),必须 x.com。
        Referer: "https://x.com/",
      },
    };
  },

  /**
   * 判断 twimg 直链是否已死(原帖被删/账号被封 → 403;不存在 → 404)。
   * 只取 1 字节(Range: bytes=0-0),开销极小。
   *
   * 【必须走全局代理】twimg 被墙,直连必然失败 —— 所以这里不传 proxyOverride,
   * 跟随用户在「设置 → 代理」里配的出口(与 dyproxy 拉流同一出口,判断才有意义)。
   * 【Referer 必须 x.com】实测 无 Referer / x.com → 206,
   * 而 movie.douban.com 或本站 Referer → 403(会把活链误判成死链)。
   *
   * 探不通(超时/限流/网络抖动)一律返回 false = "当它还活着",绝不误杀。
   */
  async _isDead(ctx, url) {
    try {
      const res = await ctx.request.get(url, {
        headers: {
          "User-Agent": this._ua(ctx),
          Referer: "https://x.com/",
          Range: "bytes=0-0",
        },
        timeout: 15000,
        http2: true,
      });
      if (!res) return false;
      return res.status === 403 || res.status === 404;
    } catch (e) {
      return false; // 探活自身失败 → 不当死链
    }
  },

  /**
   * 用原帖 status id 走 X 公开 syndication 取新鲜 mp4(react-tweet 同款,免登录):
   *   GET cdn.syndication.twimg.com/tweet-result?id=<id>&token=<t>&lang=en
   * token = ((id/1e15)*π).toString(36) 去掉全部 0 与小数点。
   * 原帖已删/受限 → 404 或无 video 字段 → 返回空串。
   */
  async _freshFromTweet(ctx, slug, info) {
    let statusId = (info && info.statusId) || "";
    if (!statusId && info && info.tweetUrl) statusId = this._statusId(info.tweetUrl);
    // 缓存里没有 → 抓详情页补一次(顺带可能拿到新 mp4)
    if (!statusId && slug) {
      const d = await this._resolveBySlug(ctx, slug);
      if (d) {
        statusId = d.statusId || this._statusId(d.tweetUrl || "");
        if (!statusId && d.url) return ""; // 详情页也只有同一个死链
      }
    }
    const id = String(statusId || "").replace(/[^0-9]/g, "");
    if (!id) return "";

    const url = ctx.utils.buildUrl(
      "https://cdn.syndication.twimg.com/tweet-result",
      { id, token: this._syndToken(id), lang: "en" }
    );
    let data = null;
    try {
      const res = await ctx.request.get(url, {
        headers: {
          "User-Agent": this._ua(ctx),
          Accept: "application/json",
          Referer: "https://platform.twitter.com/",
        },
        timeout: 20000,
        http2: true,
      });
      if (!res.ok) return ""; // 404 = 原帖已删
      data = await res.json();
    } catch (e) {
      return "";
    }
    return this._pickMp4FromTweet(data);
  },

  /** react-tweet 的 token:((id/1e15)*π).toString(36),去掉全部 0 和小数点。 */
  _syndToken(id) {
    const n = Number(id) / 1e15;
    return (n * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, "");
  },

  /** 从 syndication tweet JSON 里挑最高码率 mp4(无 mp4 退 m3u8)。 */
  _pickMp4FromTweet(data) {
    if (!data || typeof data !== "object") return "";
    const pools = [];
    const md = Array.isArray(data.mediaDetails) ? data.mediaDetails : [];
    for (const m of md) {
      const vs = m && m.video_info && m.video_info.variants;
      if (Array.isArray(vs)) pools.push(vs);
    }
    if (data.video && Array.isArray(data.video.variants)) {
      pools.push(data.video.variants);
    }
    let bestMp4 = "";
    let bestRate = -1;
    let hls = "";
    for (const variants of pools) {
      for (const v of variants) {
        if (!v || !v.url) continue;
        const type = String(v.content_type || v.type || "");
        const isMp4 = /mp4/i.test(type) || /\.mp4(\?|$)/i.test(v.url);
        const isHls = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(v.url);
        if (isMp4) {
          const rate = Number(v.bitrate || v.bit_rate || 0) || 0;
          if (rate > bestRate) {
            bestRate = rate;
            bestMp4 = v.url;
          }
        } else if (isHls && !hls) {
          hls = v.url;
        }
      }
    }
    return bestMp4 || hls || "";
  },

  /** 从 x.com 原帖链接抠 status id(syndication 的 key)。 */
  _statusId(url) {
    const m = String(url || "").match(/status(?:es)?\/(\d{5,})/i);
    return m ? m[1] : "";
  },

  /**
   * media 对象没带 tweet_url 时,从详情页 HTML 兜底找原帖 status id。
   * 优先找与本条同投稿者的 x.com/<account>/status/<id> 链接,退到页内任意 status 链接。
   */
  _statusIdFromHtml(html, it) {
    const un = String(html || "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const acc = String((it && it.tweet_account) || "").trim();
    if (acc) {
      const re = new RegExp(
        "(?:twitter|x)\\.com/" + acc.replace(/[^\w]/g, "") + "/status(?:es)?/(\\d{5,})",
        "i"
      );
      const m = un.match(re);
      if (m) return m[1];
    }
    const any = un.match(/(?:twitter|x)\.com\/[^\/"'\s]+\/status(?:es)?\/(\d{5,})/i);
    return any ? any[1] : "";
  },

  /**
   * 抓 /<locale>/movie/<slug> 详情页,取该条的 mp4 直链 + 元信息。
   * 【slug 大小写必须原样】—— 小写化会拿到空页(实测 21KB / 0 个 mp4)。
   */
  async _resolveBySlug(ctx, slug) {
    const s = String(slug || "").trim();
    if (!s) return null;
    const url =
      this._base(ctx) + "/" + this._locale(ctx) + "/movie/" + encodeURIComponent(s);
    let html = "";
    try {
      const res = await this._get(ctx, url);
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      return null;
    }
    if (!html) return null;

    const pick = (it) => {
      const tweetUrl = String(it.tweet_url || "");
      return {
        url: String(it.url),
        poster: it.thumbnail ? String(it.thumbnail) : "",
        title: this._title(it),
        author: String(it.tweet_account || "").trim(),
        tweetUrl,
        // 详情页也要带出 statusId,否则死链兜底拿不到原帖
        statusId: this._statusId(tweetUrl) || this._statusIdFromHtml(html, it),
        time: Number(it.time || 0) || 0,
      };
    };

    // ① 详情页本条挂在 "media":{...}(不是 initialItems)。按 url_cd 精确匹配,
    //    区分大小写 —— 页内还会有"相关推荐"的 media,不能盲取第一个。
    const medias = this._extractMedia(html);
    for (const it of medias) {
      if (String(it.url_cd) === s) return pick(it);
    }

    // ② 少数页面(或改版后)可能仍带 initialItems —— 同样精确匹配。
    const items = this._extractItems(html);
    for (const it of items) {
      if (it && String(it.url_cd) === s && it.url) return pick(it);
    }
    // 兜底:整页扫 twimg mp4。slug 即 mp4 文件名主体,优先同名那条。
    const un = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const all = un.match(
      /https?:\/\/video\.twimg\.com\/[^"'\s\\]+?\.mp4[^"'\s\\]*/gi
    );
    if (all && all.length) {
      const same = all.find((u) => u.indexOf("/" + s + ".mp4") >= 0);
      return { url: same || all[0], poster: "", title: s, author: "" };
    }
    return null;
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

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
      .replace(/\s+/g, " ")
      .trim();
  },
};
