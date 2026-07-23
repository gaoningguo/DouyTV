/**
 * Pornhub Shorties 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Pornhub「Shorties」(https://www.pornhub.com/shorties) 是 PH 的竖屏短视频板块
 *    (TikTok 风竖刷)。它与主站点播视频【同一套 viewkey 体系】—— shorties 列表里的
 *    每个视频都是普通 viewkey,view_video 页里同样有 `var flashvars_XXXX = {...}`,
 *    mediaDefinitions 解析、get_media 二次展开、探活挑清晰度的逻辑与 pornhub.js 完全一致。
 *    因此本脚本【独立于 pornhub.js】(用户要求 shorties 单独成源、与点播分开),但播放
 *    解析部分照搬 PH 的 flashvars 流程。
 *  - 列表:GET /shorties?page=<n>[&isAjax=1] 服务端渲染,每页只吐 ~5 个竖屏 vkey 且
 *    页与页高度重叠(slider 式)。故用【会话级 seen-set】跨页累积去重,配合 pageCount
 *    始终 +1 让 App 持续翻页拉新,直到连续多页拿不到新 vkey 才停。
 *  - PH 有地区限制 + 反爬,国内网络通常需在「设置 → 代理」配好代理(scriptFetch 走
 *    useProxyStore),否则请求超时/被墙。探活走 scriptFetch(全局代理),播放走 dyproxy。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,经 127.0.0.1:7897 代理匿名验证):
 *  - 列表: GET /shorties?page=<n>&isAjax=1 → 200 HTML,内含 5 个 "vkey":"<key>" +
 *          videoHref 锚点(href="/view_video.php?viewkey=<key>")。页间重叠,靠 seen-set 去重。
 *  - 播放: GET /view_video.php?viewkey=<key> → flashvars_XXXX.mediaDefinitions,
 *          与普通视频完全相同(实测 shorties vkey flashvars/mediaDefinitions 齐全)。
 */
return {
  meta: {
    name: "Pornhub Shorties",
    author: "DouyTV",
    version: "0.1.0",
    description: "Pornhub 竖屏短视频 Shorties(成人内容,需代理 + 年龄确认)",
  },

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://www.pornhub.com";
  },

  async getSources() {
    // Shorties 只有单一竖屏流(站点无 shorties 分类维度)。
    return [{ id: "shorties", name: "竖屏短视频", group: "浏览" }];
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    // 会话级已见 vkey(page===1 视为新会话清空),避免 slider 重叠导致列表全是重复。
    const SEEN = "shorties:seen";
    let seen = {};
    try {
      const s = await ctx.cache.get(SEEN);
      if (s && typeof s === "object") seen = s;
    } catch (e) {
      /* ignore */
    }
    if (p <= 1) seen = {};

    const url = ctx.utils.buildUrl(this._base(ctx) + "/shorties", {
      page: p,
      isAjax: 1,
    });
    const html = await this._fetchHtml(ctx, url);
    // 富解析:cheerio 抽 viewkey + 封面(与 pornhub.js 列表同款);
    // 结构不匹配时回落到纯 viewkey 正则(此时 poster 留空,交 App 首帧兜底)。
    const cards = this._parseCards(ctx, html);

    const list = [];
    for (const c of cards) {
      const vkey = c.id;
      if (!vkey || seen[vkey]) continue;
      seen[vkey] = 1;
      list.push({
        id: vkey,
        title: c.title || "Shorties " + vkey,
        poster: c.poster || undefined,
        // PH 缩略图 CDN(ci.phncdn.com)可能校验 Referer,带上头走代理更稳。
        poster_headers: c.poster
          ? { "User-Agent": this._ua(ctx), Referer: "https://www.pornhub.com/" }
          : undefined,
        vod_remarks: c.duration || undefined,
      });
    }

    try {
      await ctx.cache.set(SEEN, seen, 1800);
    } catch (e) {
      /* ignore */
    }

    // 页间重叠 —— 只要本页 HTML 里还有 vkey(不管是否新),就认为还能继续翻。
    const hasMore = cards.length > 0;
    return {
      list,
      page: p,
      pageCount: hasMore ? p + 1 : p,
      total: list.length,
    };
  },

  async search(ctx, { keyword, page }) {
    // Shorties 无独立搜索端点;走主站搜索(结果是普通 viewkey,同样能解),
    // 竖屏与横屏混排,仅作补充。
    const p = page || 1;
    const url = ctx.utils.buildUrl(this._base(ctx) + "/video/search", {
      search: keyword,
      page: p,
    });
    const html = await this._fetchHtml(ctx, url);
    const keys = this._parseViewkeys(html);
    const seen = {};
    const list = [];
    for (const vkey of keys) {
      if (seen[vkey]) continue;
      seen[vkey] = 1;
      list.push({ id: vkey, title: "Shorties " + vkey });
    }
    return {
      list,
      page: p,
      pageCount: list.length ? p + 1 : p,
      total: list.length,
    };
  },

  async detail(ctx, { id, sourceId }) {
    const viewkey = id;
    const url =
      this._base(ctx) +
      "/view_video.php?viewkey=" +
      encodeURIComponent(viewkey);
    const html = await this._fetchHtml(ctx, url);
    const $ = ctx.html.load(html);

    const title =
      ($('meta[property="og:title"]').attr("content") || "").trim() ||
      $("h1.title span").first().text().trim() ||
      viewkey;
    const poster =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      undefined;

    return {
      id: viewkey,
      title,
      poster,
      year: "",
      desc: ($('meta[property="og:description"]').attr("content") || "").trim(),
      playbacks: [
        {
          sourceId: sourceId || "shorties",
          sourceName: "Pornhub Shorties",
          episodes: [{ playUrl: viewkey, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // 与 pornhub.js 完全一致:viewkey → view_video 页 → flashvars → mediaDefinitions →
    // 收集候选 → 逐个探活挑第一个能拉的。
    let viewkey = playUrl;
    const m = String(playUrl).match(/viewkey=([a-z0-9]+)/i);
    if (m) viewkey = m[1];

    const pageUrl =
      /^https?:\/\//.test(playUrl) && playUrl.includes("view_video")
        ? playUrl
        : this._base(ctx) +
          "/view_video.php?viewkey=" +
          encodeURIComponent(viewkey);

    const html = await this._fetchHtml(ctx, pageUrl);
    const flash = this._extractFlashvars(ctx, html);
    if (!flash) {
      throw new Error(
        "Pornhub Shorties: 未找到 flashvars(可能被反爬拦截 / 需要登录 / 该视频已删除)"
      );
    }

    const mediaDefs = Array.isArray(flash.mediaDefinitions)
      ? flash.mediaDefinitions
      : [];
    const cands = await this._collectCandidates(ctx, mediaDefs);
    if (!cands.length) {
      throw new Error("Pornhub Shorties: mediaDefinitions 为空或无可用清晰度");
    }
    const best = await this._firstLiveUrl(ctx, cands);
    if (!best) {
      throw new Error(
        "Pornhub Shorties: 所有清晰度均被拒(可能是会员/受限视频,匿名无法播放)"
      );
    }

    const isHls = /\.m3u8/i.test(best) || /format=hls|\/hls\//i.test(best);
    return {
      url: best,
      type: isHls ? "hls" : "mp4",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: "https://www.pornhub.com/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _ua(ctx) {
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _headers(ctx) {
    return {
      "User-Agent": this._ua(ctx),
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.pornhub.com/",
      // 绕过年龄确认 interstitial
      Cookie:
        "age_verified=1; accessAgeDisclaimerPH=1; accessAgeDisclaimerUK=1; platform=pc; cookiesBannerSeen=1",
    };
  },

  async _fetchHtml(ctx, url) {
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Pornhub Shorties HTTP " + res.status + " @ " + url);
    return res.text();
  },

  /**
   * 从 shorties / 搜索页 HTML 抽取所有 viewkey(去重保序)。
   * shorties slider 里 vkey 同时出现在 "vkey":"<key>" 内联 JSON 与
   * href="/view_video.php?viewkey=<key>" 锚点里 —— 两路都抓,取并集。
   */
  _parseViewkeys(html) {
    const out = [];
    const seen = {};
    const push = (k) => {
      if (k && !seen[k]) {
        seen[k] = 1;
        out.push(k);
      }
    };
    if (typeof html !== "string") return out;
    let m;
    const reJson = /"vkey"\s*:\s*"([a-z0-9]+)"/gi;
    while ((m = reJson.exec(html)) !== null) push(m[1]);
    const reHref = /viewkey=([a-z0-9]+)/gi;
    while ((m = reHref.exec(html)) !== null) push(m[1]);
    return out;
  },

  /**
   * 富解析 shorties 列表卡片 —— 抽 { id(viewkey), title, poster, duration }。
   *
   * 【实测 2026-07】shorties 列表【不是】主站的 li.pcVideoListItem DOM 卡片,而是页面里
   * 一段内联 JS 数组 `JSON_SHORTIES = insertAfterNthPosition([{...}, ...], ...)`,每个元素
   * 带 { vkey, videoTitle, imageUrl(封面), largePreviewUrl, mediaDefinitions, ... }。
   * 之前脚本找 li.pcVideoListItem 选择器全都匹配不到 → 回落纯 vkey 正则 → 封面为空
   * (用户报的"没有封面")。现优先解 JSON_SHORTIES 拿到 imageUrl 封面。
   *
   * 解不出 JSON_SHORTIES(结构又变)时,依次回落 DOM 卡片 / 纯 vkey 正则,保证不退化。
   */
  _parseCards(ctx, html) {
    // 1) 优先:内联 JSON_SHORTIES 数组(带 vkey + imageUrl 封面)。
    const fromJson = this._parseShortiesJson(html);
    if (fromJson.length) return fromJson;

    // 2) 回落:主站式 DOM 卡片(结构若回归旧版时仍可用)。
    const out = [];
    const seen = {};
    let $ = null;
    try {
      $ = ctx.html.load(html);
    } catch (e) {
      $ = null;
    }
    if ($) {
      const self = this;
      $("li.pcVideoListItem, li.videoBox, div.phimage, div.pcVideoListItem").each(
        function () {
          const $el = $(this);
          const $a = $el.find('a[href*="viewkey="]').first();
          const href = $a.attr("href") || "";
          const mk = href.match(/viewkey=([a-z0-9]+)/i);
          if (!mk) return;
          const vkey = mk[1];
          if (seen[vkey]) return;
          seen[vkey] = true;

          const $img = $el.find("img").first();
          // 懒加载图片真图优先取 data-src / data-thumb_url,回落 src;跳过 data: 占位。
          let poster =
            $img.attr("data-src") ||
            $img.attr("data-thumb_url") ||
            $img.attr("data-mediabook") ||
            $img.attr("src") ||
            "";
          if (/^data:/i.test(poster)) poster = "";
          if (poster && poster.indexOf("//") === 0) poster = "https:" + poster;

          const title =
            ($a.attr("title") || "").trim() ||
            ($img.attr("alt") || "").trim() ||
            $el.find(".title a").first().text().trim() ||
            "";
          const duration = $el.find(".duration").first().text().trim();

          out.push({
            id: vkey,
            title: title.replace(/\s+/g, " "),
            poster: poster || "",
            duration: duration || "",
          });
        }
      );
    }
    if (out.length) return out;

    // 3) 兜底:纯 viewkey 正则,poster 留空(由 App 首帧兜底)。
    return this._parseViewkeys(html).map((vkey) => ({
      id: vkey,
      title: "",
      poster: "",
      duration: "",
    }));
  },

  /**
   * 解页面内联 `JSON_SHORTIES = insertAfterNthPosition([ {...}, ... ]`。
   * 从 "JSON_SHORTIES" 处找到第一个 '[',括号配平(跳过字符串内的括号)截出数组,
   * JSON.parse 后逐条抽 { vkey, videoTitle, imageUrl }。
   * imageUrl 是 pix-cdn77.phncdn.com 带 hash/validto 的封面直链(需 UA/Referer 走代理)。
   */
  _parseShortiesJson(html) {
    const out = [];
    if (typeof html !== "string") return out;
    const at = html.indexOf("JSON_SHORTIES");
    if (at < 0) return out;
    const br = html.indexOf("[", at);
    if (br < 0) return out;
    const json = this._sliceBalanced(html, br, "[", "]");
    if (!json) return out;
    let arr;
    try {
      arr = JSON.parse(json);
    } catch (e) {
      return out;
    }
    if (!Array.isArray(arr)) return out;
    const seen = {};
    for (const it of arr) {
      const vkey = it && (it.vkey || it.viewkey);
      if (!vkey || seen[vkey]) continue;
      seen[vkey] = true;
      let poster = (it.imageUrl || it.largePreviewUrl || "").toString();
      poster = this._decodeEntities(poster);
      if (poster.indexOf("//") === 0) poster = "https:" + poster;
      out.push({
        id: String(vkey),
        title: this._decodeEntities((it.videoTitle || "").toString()).replace(/\s+/g, " ").trim(),
        poster: /^https?:\/\//i.test(poster) ? poster : "",
        duration: "",
      });
    }
    return out;
  },

  /** 解 HTML 实体(JSON_SHORTIES 的 imageUrl/title 里 & 被转义成 &amp;)。 */
  _decodeEntities(s) {
    if (!s || typeof s !== "string") return "";
    return s
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  },

  /* ─── 以下 flashvars / 候选收集 / 探活,与 pornhub.js 同源 ─── */

  _extractFlashvars(ctx, html) {
    const decl = /var\s+flashvars_\d+\s*=\s*\{/g;
    let d;
    while ((d = decl.exec(html)) !== null) {
      const start = d.index + d[0].length - 1;
      const json = this._sliceBalanced(html, start);
      if (!json) continue;
      try {
        const obj = JSON.parse(json);
        if (obj && obj.mediaDefinitions) return obj;
      } catch (e) {
        /* 跳过继续找下一个 flashvars */
      }
    }
    const mi = html.indexOf('"mediaDefinitions"');
    if (mi >= 0) {
      const br = html.indexOf("[", mi);
      if (br >= 0) {
        const arr = this._sliceBalanced(html, br, "[", "]");
        if (arr) {
          try {
            return { mediaDefinitions: JSON.parse(arr) };
          } catch (e) {
            /* ignore */
          }
        }
      }
    }
    return null;
  },

  _sliceBalanced(html, start, open, close) {
    open = open || "{";
    close = close || "}";
    if (html[start] !== open) return null;
    let depth = 0;
    let inStr = false;
    let quote = "";
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inStr) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === quote) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        quote = c;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return html.slice(start, i + 1);
      }
    }
    return null;
  },

  async _collectCandidates(ctx, mediaDefs) {
    const cands = [];
    const push = (url, q, hls) => {
      if (url && typeof url === "string") cands.push({ q: q || 0, url, hls: !!hls });
    };

    for (const d of mediaDefs) {
      if (!d || typeof d.videoUrl !== "string") continue;
      if (Array.isArray(d.quality) && /\.m3u8/i.test(d.videoUrl)) {
        push(d.videoUrl, 99999, true);
      }
    }

    const aggregator = mediaDefs.find(
      (d) =>
        d &&
        Array.isArray(d.quality) &&
        typeof d.videoUrl === "string" &&
        !/\.m3u8/i.test(d.videoUrl)
    );
    if (aggregator) {
      try {
        const res = await ctx.request.get(aggregator.videoUrl, {
          headers: this._headers(ctx),
          timeout: 20000,
        });
        const arr = await res.json();
        if (Array.isArray(arr)) {
          for (const x of arr) {
            if (!x || !x.videoUrl) continue;
            const q = parseInt(String(x.quality).replace(/\D/g, ""), 10) || 0;
            const hls = /\.m3u8/i.test(x.videoUrl) || x.format === "hls";
            push(x.videoUrl, hls ? q + 100000 : q, hls);
          }
        }
      } catch (e) {
        ctx.log && ctx.log.warn && ctx.log.warn("Pornhub Shorties get_media 失败:", String(e));
      }
    }

    for (const d of mediaDefs) {
      if (!d || typeof d.videoUrl !== "string" || Array.isArray(d.quality)) continue;
      const q = parseInt(String(d.quality).replace(/\D/g, ""), 10) || 0;
      const hls = /\.m3u8/i.test(d.videoUrl) || d.format === "hls";
      push(d.videoUrl, hls ? q + 100000 : q, hls);
    }

    const seen = {};
    return cands
      .filter((c) => (seen[c.url] ? false : (seen[c.url] = true)))
      .sort((a, b) => b.q - a.q);
  },

  async _firstLiveUrl(ctx, cands) {
    if (!cands.length) return null;
    for (const c of cands) {
      try {
        const res = await ctx.request.get(c.url, {
          headers: { ...this._headers(ctx), Range: "bytes=0-1" },
          timeout: 12000,
        });
        if (res.ok || res.status === 206) return c.url;
        if ([401, 403, 404, 410].includes(res.status)) continue;
      } catch (e) {
        /* 继续下一个候选 */
      }
    }
    return cands[0].url;
  },
};
