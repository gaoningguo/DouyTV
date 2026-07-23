/**
 * Reddit NSFW 竖屏短视频源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 覆盖 r/tiktokporn + r/tiktokthots 两个竖屏成人短视频版块(subreddit 可 config 覆盖/扩充)。
 *
 * 【为什么走 RSS 而不是官方 .json】(2026-07 实测,经 127.0.0.1:7897 代理匿名验证)
 *  - Reddit 官方 JSON API(www/oauth/old + v.redd.it)对本机代理出口 IP 全部 403
 *    (返回站点 web-shell / "Blocked" 页,不是 JSON;oauth 也是 403 而非 401 ——
 *     确认是【数据中心 IP 段封禁】,加什么 header 都救不了)。
 *  - 但 Atom RSS 端点 `/r/<sub>/hot.rss` 匿名 200 可用(application/atom+xml)。
 *    RSS 里【没有】原生 v.redd.it 视频直链,内容几乎全是 redgifs 嵌入
 *    (redgifs.com/watch/<id>),缩略图挂在 external-preview.redd.it。
 *  - 因此:列表走 RSS,播放走 redgifs 官方 API 解析出 mp4。
 *    非 redgifs 的帖子(纯文本 / 已墙的 v.redd.it)直接跳过。
 *
 * 【网络必读】本机直连被墙 + Reddit IP 段封禁 —— 必须在「设置 → 代理」里配好代理,
 *  scriptFetch 与 dyproxy 拉流都会走它。缺代理时列表和播放都会失败。
 *  成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07-12 实测):
 *  - 列表: GET https://www.reddit.com/r/<sub>/<sort>.rss?limit=25[&after=t3_<id>][&t=week]
 *          → Atom feed。<entry> 内含:
 *            <id>t3_<postid></id>、<title>标题</title>、
 *            <link href="…/comments/<postid>/…"/>(永久链)、
 *            <media:thumbnail url="https://external-preview.redd.it/….jpeg?…"/>、
 *            content(转义 HTML)里含 redgifs watch 链接。
 *          分页:after=上一页最后一条的 t3_ id(游标式,顺序翻页)。
 *          sort ∈ hot/new/top(top 加 &t=week);带真实浏览器 UA 才 200(否则 429)。
 *          ★证据: /r/tiktokporn/hot.rss → 200 application/atom+xml, 25 entries;
 *                 after=t3_… 翻页 → 200 且首条 id 与上页尾不同。
 *  - 播放解析(redgifs):
 *      1) GET https://api.redgifs.com/v2/auth/temporary → { token }(匿名可取,约 24h)
 *      2) GET https://api.redgifs.com/v2/gifs/<id>  Authorization: Bearer <token>
 *         → { gif:{ urls:{ hd:"…​.mp4", sd:"…-mobile.mp4", poster }, hls, width, height } }
 *         id 支持词 slug(adoredrightmule)与纯数字(863928766511055471)两种。
 *      ★证据: temporary → 200 token(len 950);/v2/gifs/adoredrightmule → 200,
 *             hd=https://media.redgifs.com/AdoredRightMule.mp4 (1080x1920 竖屏);
 *             无 Bearer → 401;HEAD hd mp4 无 Referer → 200 Content-Type video/mp4。
 *             external-preview.redd.it 缩略图 → 200 image/jpeg。
 */
return {
  meta: {
    name: "Reddit 竖屏",
    author: "DouyTV",
    version: "0.1.0",
    description:
      "Reddit r/tiktokporn + r/tiktokthots 竖屏短视频(redgifs 播放;成人内容,需代理 + 年龄确认)",
  },

  /* ───────────────────────── 基址 / UA / header ───────────────────────── */

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://www.reddit.com";
  },

  _rgApi(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("redgifsApi");
    return (typeof b === "string" && b) || "https://api.redgifs.com";
  },

  /**
   * Reddit RSS 的 base 池 —— 用于 429 轮换(「CDN 代理池」)。
   *  - 第一个永远是 _base(config.base 或官方 www.reddit.com);
   *  - config.mirrors(逗号分隔)追加 Reddit RSS 兼容镜像/反代前缀,例如
   *      https://old.reddit.com , https://www.reddit.com  或用户自建的 CF Worker 反代。
   *    要求:镜像必须把 /r/<sub>/<sort>.rss?... 原样透传并返回同款 Atom XML。
   *  - 不填 mirrors → 池里只有官方 base,行为与旧版完全一致,不退化。
   *
   * 【为什么这样做代理池】站点注释说明 429 是数据中心出口 IP 段被 Reddit 限速,
   * 单靠退避只能等复位窗口(~24s)。真正分摊压力要靠【不同出口 IP / 不同前端域】——
   * 即多个反代镜像轮换。脚本侧无法自带公共镜像清单(时效性差、无法在此验证可用性),
   * 故做成 config 驱动:你在「脚本设置」填自己可用的反代前缀,脚本负责轮换 + 遇 429 换下一个。
   */
  _baseList(ctx) {
    const list = [this._base(ctx)];
    const raw = ctx.config && ctx.config.get && ctx.config.get("mirrors");
    if (typeof raw === "string" && raw.trim()) {
      for (const m of raw.split(",")) {
        const b = m.trim().replace(/\/+$/, "");
        if (b && /^https?:\/\//i.test(b) && list.indexOf(b) < 0) list.push(b);
      }
    }
    return list;
  },

  /**
   * 从 429 响应头解出复位秒数(x-ratelimit-reset,值形如 "9" / "9.0")。
   * 拿不到 / 非法则返 0(调用方退回固定退避档位)。响应头 key 已被 fetch 层小写化。
   */
  _parseResetSeconds(res) {
    try {
      const h = res && res.headers;
      if (!h) return 0;
      const raw =
        h["x-ratelimit-reset"] ||
        h["X-Ratelimit-Reset"] ||
        (typeof h.get === "function" && h.get("x-ratelimit-reset"));
      const n = parseFloat(String(raw || ""));
      return isFinite(n) && n > 0 ? Math.ceil(n) : 0;
    } catch (e) {
      return 0;
    }
  },

  /**
   * 必须是【真实浏览器 UA】—— Reddit RSS 对空/脚本 UA 会 429。可 config.ua 覆盖。
   */
  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx, accept) {
    return {
      "User-Agent": this._ua(ctx),
      Accept:
        accept ||
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
  },

  /**
   * 配置的版块清单。默认两个;config.subreddits(逗号分隔)可覆盖/扩充。
   */
  _subs(ctx) {
    const custom = ctx.config && ctx.config.get && ctx.config.get("subreddits");
    if (typeof custom === "string" && custom.trim()) {
      const arr = custom
        .split(",")
        .map((s) => s.trim().replace(/^r\//i, ""))
        .filter(Boolean);
      if (arr.length) return arr;
    }
    return ["tiktokporn", "tiktokthots"];
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const subs = this._subs(ctx);
    const sorts = [
      { key: "hot", name: "热门" },
      { key: "new", name: "最新" },
      { key: "top", name: "本周精选" },
    ];
    const sources = [];
    for (const sub of subs) {
      for (const s of sorts) {
        sources.push({
          id: "sub:" + sub + ":" + s.key,
          name: "r/" + sub + " · " + s.name,
          group: "r/" + sub,
        });
      }
    }
    return sources;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    let sub = this._subs(ctx)[0];
    let sort = "hot";
    if (typeof sourceId === "string" && sourceId.indexOf("sub:") === 0) {
      const rest = sourceId.slice(4);
      const idx = rest.lastIndexOf(":");
      if (idx > 0) {
        sub = rest.slice(0, idx);
        sort = rest.slice(idx + 1);
      } else {
        sub = rest;
      }
    }
    return this._feed(ctx, sub, sort, p);
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = (keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    // 在配置的所有版块内搜索:q 里附加 subreddit: 过滤,走全站 search.rss。
    const subs = this._subs(ctx);
    const subFilter = subs.map((s) => "subreddit:" + s).join(" OR ");
    const q = kw + " (" + subFilter + ")";
    const sk = "search:" + kw;
    const query = {
      q: q,
      sort: "relevance",
      include_over_18: "on",
      limit: 25,
      restrict_sr: "",
    };
    return this._rssList(ctx, "/search.rss", query, sk, p);
  },

  /**
   * 版块推荐流 —— /r/<sub>/<sort>.rss,after 游标翻页。
   */
  async _feed(ctx, sub, sort, page) {
    const sortKey = /^(hot|new|top|rising)$/.test(sort) ? sort : "hot";
    const path = "/r/" + encodeURIComponent(sub) + "/" + sortKey + ".rss";
    const query = { limit: 25 };
    if (sortKey === "top") query.t = "week";
    const sk = "feed:" + sub + ":" + sortKey;
    return this._rssList(ctx, path, query, sk, page);
  },

  /**
   * 通用 RSS 列表拉取 + after 游标顺序翻页。
   * page 1 不带 after;page>1 读上一页缓存的 after(=上页最后一条 t3_ id)。
   * 拿到本页后把最后一条 id 存为「下一页」游标(TTL 30 分钟)。
   */
  async _rssList(ctx, path, baseQuery, sk, page) {
    const query = {};
    for (const k in baseQuery) query[k] = baseQuery[k];

    if (page > 1) {
      let after;
      try {
        after = await ctx.cache.get("after:" + sk + ":" + page);
      } catch (e) {
        /* ignore */
      }
      if (!after) {
        // 缺游标(缓存过期 / 非顺序翻页)—— 无法定位该页。
        return { list: [], page, pageCount: page, total: 0 };
      }
      query.after = after;
    }

    // Reddit RSS 按【出口 IP】限流(所有 reddit 子域 www/old/np/new 共享同一个桶,
    // 实测每窗口只放 1 次请求;命中后 x-ratelimit-remaining=0,复位窗口【实测 ~20s】
    // ——比旧注释的 24s 略短,但旧的 6s/12s 退避档位累计才 18s,几乎每次都在窗口内
    // 重试 → 仍 429,这是"切分类必 429"的直接原因)。用户每点一次标签/排序发一次请求
    // → 立刻 429。四道防护:
    //  1) 本页 XML 缓存(RESP:<sk>:<page>,TTL 10 分钟)—— 反复点同一标签直接命中缓存,
    //     不打网络。这是最有效的一道:429 主因就是切来切去重复拉同一 sub/sort。
    //  2) 【代理池轮换】遇 429 先换 _baseList 里的下一个镜像(不同出口 IP / 前端域)——
    //     不同 IP 有独立限流桶,能真正分摊。池只有官方 base(未配 mirrors)时退化成单域。
    //     ★ reddit 官方各子域共享 IP 桶,轮换它们无效;真正有效的是用户自建的
    //       不同出口反代(CF Worker / VPS),填在「脚本设置 → mirrors」。
    //  3) 用响应里的 x-ratelimit-reset 秒数做【精确退避】(拿不到头才退回固定档位),
    //     退避档位对齐实测 ~20s 复位窗口(0 → 20s → 22s),而非之前不够长的 6s/12s。
    //  4) 全部尝试仍 429 → 若有本页【过期缓存】则降级返回它(过期总比空列表 + 报错好)。
    const RK = "resp:" + sk + ":" + page;
    let xml;
    try {
      const cached = await ctx.cache.get(RK);
      if (cached && typeof cached === "string") xml = cached;
    } catch (e) {
      /* ignore */
    }

    if (xml == null) {
      const bases = this._baseList(ctx);
      // 轮换起点按 sk 散列错开 —— 不同 sub/sort 从不同镜像起步,避免都挤第一个。
      let rot = 0;
      for (let i = 0; i < sk.length; i++) rot = (rot + sk.charCodeAt(i)) % bases.length;

      let res;
      let lastErr;
      // 每个退避档位跑「一整轮镜像」;档位 0 不等待,后续档位对齐实测 ~20s 复位窗口
      // (旧的 6s/12s 累计 18s < 20s,几乎必落在窗口内 → 仍 429)。
      const delays = [0, 20000, 22000];
      outer: for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) {
          try {
            await ctx.utils.sleep(delays[attempt]);
          } catch (e) {
            /* ignore */
          }
        }
        for (let j = 0; j < bases.length; j++) {
          const base = bases[(rot + j) % bases.length];
          const url = ctx.utils.buildUrl(base + path, query);
          try {
            res = await ctx.request.get(url, {
              headers: this._headers(ctx),
              timeout: 25000,
            });
          } catch (e) {
            // 单个镜像网络异常(反代挂了/超时)不致命,记下换下一个。
            lastErr = e;
            ctx.log && ctx.log.warn &&
              ctx.log.warn("Reddit RSS 镜像请求失败,换下一个:", base, String(e));
            continue;
          }
          if (res.status !== 429) break outer; // 拿到非 429(含 2xx/其它错误)即结束轮换
          // 429:若本轮是最后一个镜像且还有下一档退避,用响应头的精确复位秒数覆盖固定档位。
          if (j === bases.length - 1 && attempt + 1 < delays.length) {
            const reset = this._parseResetSeconds(res);
            if (reset > 0) delays[attempt + 1] = Math.min(reset * 1000 + 1500, 30000);
          }
          ctx.log && ctx.log.warn &&
            ctx.log.warn("Reddit RSS 429,换镜像:", base, "(轮", attempt + 1, ")");
        }
      }
      if (!res) throw new Error("Reddit RSS 无可用镜像 @ " + path + (lastErr ? " — " + String(lastErr) : ""));
      if (res.status === 429) {
        // 仍被限流 —— 有过期缓存就降级用它,避免直接空列表 + 报错。
        let stale;
        try {
          stale = await ctx.cache.get(RK + ":stale");
        } catch (e) {
          /* ignore */
        }
        if (stale && typeof stale === "string") {
          ctx.log && ctx.log.warn && ctx.log.warn("Reddit RSS 持续 429,降级返回过期缓存");
          xml = stale;
        }
      }
      if (xml == null) {
        if (!res.ok) throw new Error("Reddit RSS HTTP " + res.status + " @ " + path);
        xml = await res.text();
        try {
          await ctx.cache.set(RK, xml, 600);
          // 另存一份长效副本(6 小时)供持续限流时降级。
          await ctx.cache.set(RK + ":stale", xml, 21600);
        } catch (e) {
          /* ignore */
        }
      }
    }

    const entries = this._parseEntries(xml);
    const list = [];
    let lastId = "";
    for (const e of entries) {
      if (e.fullId) lastId = e.fullId; // 记录最后一条(含 t3_ 前缀)供 after 用
      const vod = this._entryToVod(ctx, e);
      if (vod) list.push(vod);
    }

    // 缓存下一页游标。
    if (lastId) {
      try {
        await ctx.cache.set("after:" + sk + ":" + (page + 1), lastId, 1800);
      } catch (e) {
        /* ignore */
      }
    }

    // RSS 满页(接近 limit)才认为还有下一页。
    const hasMore = entries.length >= 20 && !!lastId;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /* ───────────────────────── RSS 解析 ───────────────────────── */

  /**
   * 拆 Atom feed 的 <entry>…</entry>,逐条抽字段。
   * 返回 [{ fullId:"t3_xxx", id:"xxx", title, permalink, thumb, redgifsId }]。
   */
  _parseEntries(xml) {
    const out = [];
    if (!xml || typeof xml !== "string") return out;
    const re = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];

      const idM = block.match(/<id>\s*(t3_[A-Za-z0-9]+)\s*<\/id>/);
      const fullId = idM ? idM[1] : "";
      const postId = fullId ? fullId.replace(/^t3_/, "") : "";

      const titleM = block.match(/<title>([\s\S]*?)<\/title>/);
      const title = titleM ? this._decodeEntities(titleM[1]).trim() : "";

      const linkM = block.match(/<link\s+href="([^"]+)"/);
      const permalink = linkM ? this._decodeEntities(linkM[1]) : "";

      const thumbM = block.match(/<media:thumbnail\s+url="([^"]+)"/);
      const thumb = thumbM ? this._decodeEntities(thumbM[1]) : "";

      // redgifs id:URL 本体未转义(只有外层标签被转义),直接正则即可。
      // 形态: redgifs.com/watch/<id> / www./v3. 前缀; id 为词 slug 或纯数字。
      const rgM = block.match(
        /(?:https?:\/\/)?(?:www\.|v3\.)?redgifs\.com\/(?:watch|ifr)\/([A-Za-z0-9]+)/i
      );
      const redgifsId = rgM ? rgM[1] : "";

      out.push({ fullId, id: postId, title, permalink, thumb, redgifsId });
    }
    return out;
  },

  /**
   * entry → ScriptVodItem。只接受能解析出 redgifs id 的帖子(其余跳过)。
   * 同时把 redgifs id / 元信息缓存到 post:<id>,供 detail 命中。
   */
  _entryToVod(ctx, e) {
    if (!e || !e.redgifsId || !e.id) return null;
    const title = e.title && e.title !== "_" ? e.title : "r/ 短视频 " + e.id;

    const meta = {
      redgifsId: e.redgifsId,
      title,
      poster: e.thumb || undefined,
      permalink: e.permalink || undefined,
    };
    this._pendingCache = this._pendingCache || {};
    this._pendingCache[e.id] = meta;
    try {
      ctx.cache.set("post:" + e.id, meta, 7200);
    } catch (err) {
      /* ignore */
    }

    return {
      id: e.id,
      title,
      poster: e.thumb || undefined,
      // 缩略图 CDN 带上浏览器 UA(防盗链兜底)。
      poster_headers: e.thumb ? { "User-Agent": this._ua(ctx) } : undefined,
      type_name: "redgifs",
    };
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info;
    try {
      info = await ctx.cache.get("post:" + id);
    } catch (e) {
      /* ignore */
    }
    if (!info && this._pendingCache && this._pendingCache[id]) {
      info = this._pendingCache[id];
    }
    if (!info || !info.redgifsId) {
      throw new Error(
        "Reddit: 未找到该帖子的 redgifs 视频(缓存过期,请回列表重新进入)@ " + id
      );
    }

    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster,
      year: "",
      desc: info.permalink || "",
      type_name: "redgifs",
      playbacks: [
        {
          sourceId: sourceId || "reddit",
          sourceName: "Reddit",
          // playUrl 只放 redgifs id;resolvePlayUrl 现拉新鲜 mp4。
          episodes: [
            { playUrl: "rg:" + info.redgifsId, needResolve: true, title: "完整版" },
          ],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const rid = String(playUrl || "").replace(/^rg:/, "").trim();
    if (!rid) throw new Error("Reddit: 空的 redgifs id");

    const token = await this._redgifsToken(ctx);
    const url = this._rgApi(ctx) + "/v2/gifs/" + encodeURIComponent(rid);
    const res = await ctx.request.get(url, {
      headers: {
        "User-Agent": this._ua(ctx),
        Accept: "application/json, text/plain, */*",
        Authorization: "Bearer " + token,
        Referer: "https://www.redgifs.com/",
      },
      timeout: 20000,
    });
    if (!res.ok) {
      throw new Error("Reddit/redgifs 解析 HTTP " + res.status + " @ " + rid);
    }
    const data = await res.json();
    const gif = data && data.gif;
    const urls = gif && gif.urls;
    if (!urls) throw new Error("Reddit/redgifs: 无播放地址 @ " + rid);

    const mp4 = urls.hd || urls.sd || urls.silent;
    if (!mp4) throw new Error("Reddit/redgifs: 无 mp4 地址 @ " + rid);

    // redgifs mp4 走 media.redgifs.com,不校验 Referer/UA(实测无 Referer 也 206),
    // 但带上浏览器 UA + Referer 更稳。直连被墙 → App 侧 dyproxy 自动带全局代理拉流。
    return {
      url: mp4,
      type: "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: "https://www.redgifs.com/",
      },
    };
  },

  /**
   * redgifs 匿名临时 token —— GET /v2/auth/temporary → { token }。缓存 1 小时。
   * /v2/gifs/<id> 必须带 Bearer(无 token → 401)。
   */
  async _redgifsToken(ctx) {
    const CK = "redgifs:token";
    try {
      const t = await ctx.cache.get(CK);
      if (t && typeof t === "string") return t;
    } catch (e) {
      /* ignore */
    }
    const url = this._rgApi(ctx) + "/v2/auth/temporary";
    const res = await ctx.request.get(url, {
      headers: {
        "User-Agent": this._ua(ctx),
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.redgifs.com/",
      },
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Reddit/redgifs token HTTP " + res.status);
    const data = await res.json();
    const token = data && data.token;
    if (!token) throw new Error("Reddit/redgifs: 临时 token 缺失");
    try {
      await ctx.cache.set(CK, token, 3600);
    } catch (e) {
      /* ignore */
    }
    return token;
  },

  /* ───────────────────────── 工具 ───────────────────────── */

  /** 解 HTML/XML 实体(RSS 标题与 URL 都被转义过)。 */
  _decodeEntities(s) {
    if (!s || typeof s !== "string") return "";
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&#0*32;/g, " ")
      .replace(/&apos;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#(\d+);/g, (m, d) => {
        try {
          return String.fromCodePoint(parseInt(d, 10));
        } catch (e) {
          return m;
        }
      })
      .replace(/&#x([0-9a-f]+);/gi, (m, h) => {
        try {
          return String.fromCodePoint(parseInt(h, 16));
        } catch (e) {
          return m;
        }
      })
      .replace(/&amp;/g, "&"); // 最后解 &,避免二次解码
  },
};
