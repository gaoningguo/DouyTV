/**
 * 抖音 (Douyin) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * ── 关于抖音反爬的实话 ────────────────────────────────────────────
 * 抖音 Web 的 /aweme/v1/web/ 系列 XHR 接口(搜索 / feed / 详情)现在几乎
 * 全部强制要求:
 *   - a_bogus  (URL query 签名,由一段混淆 JS 生成)
 *   - msToken  (前端上报的 token)
 *   - ttwid / odin_tt 等指纹 cookie
 * 缺任意一项,接口会返回 status 200 但 aweme_list 为空,或直接跳验证码。
 * 本脚本【不】内联伪造签名算法(离线无法验证,写错只会静默失效)。
 *
 * 因此真正稳定、无需签名的路径是【SSR 页面 render data】:
 *   https://www.douyin.com/video/{aweme_id}
 * 服务端直出 `window._ROUTER_DATA`(部分老页面是 <script id="RENDER_DATA">),
 * 里面含完整 aweme 数据 + 播放地址。detail / resolvePlayUrl 走这条。
 *
 * search 智能分流:
 *   - 关键词是抖音链接 / 短链 v.douyin.com / 纯数字 aweme_id → 直接解析成单条(可用)
 *   - 普通关键词 → 尝试搜索接口(无签名大概率空),失败返回空并 log
 *
 * 注意: 抖音页面结构 / 字段命名(snake_case vs camelCase)会变,下面做了
 * 双命名兜底 + 递归查找,但线上跑不通时优先怀疑 render data 结构变化。
 * ─────────────────────────────────────────────────────────────────
 */
return {
  meta: {
    name: "抖音 Douyin",
    author: "DouyTV",
    version: "0.1.0",
    description: "抖音视频源(走 SSR render data;搜索支持粘贴分享链接/视频ID)",
  },

  async getSources() {
    return [
      { id: "link", name: "链接解析", group: "分类" },
      { id: "recommend", name: "推荐", group: "分类" },
    ];
  },

  async recommend(ctx, { page }) {
    const p = page || 1;
    // feed 流需要登录态 + a_bogus 签名,无签名基本拿不到。
    // 尽力从首页 SSR render data 抓初始 aweme,拿不到就空。
    if (p > 1) return { list: [], page: p, pageCount: p, total: 0 };
    try {
      const html = await this._fetchHtml(ctx, "https://www.douyin.com/");
      const data = this._extractRenderData(html);
      const items = [];
      this._collectAwemes(data, items, {});
      const list = items.map((it) => this._toVod(it)).filter(Boolean);
      if (!list.length) {
        ctx.log && ctx.log.warn &&
          ctx.log.warn("抖音 recommend: 首页无可解析 aweme(feed 需登录+签名)。请用搜索粘贴分享链接。");
      }
      return { list, page: 1, pageCount: 1, total: list.length };
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("抖音 recommend 失败:", String(e));
      return { list: [], page: 1, pageCount: 1, total: 0 };
    }
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();

    // ① 输入是链接 / 短链 / 纯 aweme_id → 直接解析成单条(最可靠)
    const awemeId = await this._resolveAwemeId(ctx, kw);
    if (awemeId) {
      try {
        const item = await this._fetchAwemeById(ctx, awemeId);
        const vod = item && this._toVod(item);
        return {
          list: vod ? [vod] : [],
          page: 1,
          pageCount: 1,
          total: vod ? 1 : 0,
        };
      } catch (e) {
        ctx.log && ctx.log.warn && ctx.log.warn("抖音 链接解析失败:", String(e));
        return { list: [], page: 1, pageCount: 1, total: 0 };
      }
    }

    // ② 普通关键词 → 尝试搜索接口(无 a_bogus 大概率空)
    try {
      const url = ctx.utils.buildUrl(
        "https://www.douyin.com/aweme/v1/web/general/search/single/",
        {
          keyword: kw,
          search_channel: "aweme_general",
          offset: (p - 1) * 20,
          count: 20,
          device_platform: "webapp",
          aid: 6383,
          channel: "channel_pc_web",
          pc_client_type: 1,
          version_code: "170400",
          version_name: "17.4.0",
        }
      );
      const res = await ctx.request.get(url, {
        headers: this._apiHeaders(ctx),
        timeout: 15000,
      });
      let json = {};
      try {
        json = await res.json();
      } catch (_) {
        json = {};
      }
      const raw = (json && (json.data || json.aweme_list)) || [];
      const items = [];
      this._collectAwemes(raw, items, {});
      const list = items.map((it) => this._toVod(it)).filter(Boolean);
      if (!list.length) {
        ctx.log && ctx.log.warn &&
          ctx.log.warn(
            "抖音 关键词搜索为空 —— 该接口需 a_bogus/msToken 签名。" +
              "可改为粘贴视频分享链接(如 https://v.douyin.com/xxx/ 或 .../video/71234...)。"
          );
      }
      return {
        list,
        page: p,
        pageCount: list.length ? p + 1 : p,
        total: list.length,
      };
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("抖音 search 失败:", String(e));
      return { list: [], page: p, pageCount: p, total: 0 };
    }
  },

  async detail(ctx, { id, sourceId }) {
    const awemeId = (await this._resolveAwemeId(ctx, id)) || id;
    const item = await this._fetchAwemeById(ctx, awemeId);
    if (!item) throw new Error("抖音 detail: 未能解析视频数据 id=" + id);
    const vod = this._toVod(item);
    return {
      id: awemeId,
      title: (vod && vod.title) || awemeId,
      poster: vod && vod.poster,
      year: "",
      desc: (vod && vod.desc) || "",
      playbacks: [
        {
          sourceId: sourceId || "link",
          sourceName: (item.author && (item.author.nickname || item.author.nickName)) || "抖音",
          // 播放地址交给 resolvePlayUrl 现取,避免 CDN 链接过期
          episodes: [{ playUrl: awemeId, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    const awemeId = (await this._resolveAwemeId(ctx, playUrl)) || String(playUrl);
    const item = await this._fetchAwemeById(ctx, awemeId);
    if (!item) throw new Error("抖音 resolve: 未找到播放数据 id=" + awemeId);
    const url = this._bestPlayUrl(item);
    if (!url) throw new Error("抖音 resolve: 无可用播放地址(可能是图文/直播/已删除)");
    const isHls = /\.m3u8/i.test(url);
    return {
      url,
      type: isHls ? "hls" : "mp4",
      // 抖音 CDN 校验 Referer;proxyMode 描述符开启时由 dyproxy 带上
      headers: {
        "User-Agent": this._ua(),
        Referer: "https://www.douyin.com/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _ua() {
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  _pageHeaders() {
    return {
      "User-Agent": this._ua(),
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://www.douyin.com/",
    };
  },

  _apiHeaders() {
    return {
      "User-Agent": this._ua(),
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://www.douyin.com/",
    };
  },

  async _fetchHtml(ctx, url) {
    const res = await ctx.request.get(url, {
      headers: this._pageHeaders(),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("抖音 HTTP " + res.status + " @ " + url);
    return res.text();
  },

  /**
   * 把用户输入(短链 / 完整链接 / 纯数字 id / 含链接的分享文案)归一成 aweme_id。
   * 返回 null 表示这是普通关键词(不是链接)。
   */
  async _resolveAwemeId(ctx, input) {
    const s = String(input || "").trim();
    if (!s) return null;

    // 纯数字 id
    if (/^\d{6,}$/.test(s)) return s;

    // 直接含 /video/{id} 或 /note/{id}
    let m = s.match(/\/(?:video|note|share\/video)\/(\d{6,})/);
    if (m) return m[1];

    // modal_id / aweme_id query
    m = s.match(/[?&](?:modal_id|aweme_id|item_id|item_ids)=(\d{6,})/);
    if (m) return m[1];

    // 短链 v.douyin.com / iesdouyin 分享 → 跟随重定向拿最终 URL
    const linkMatch = s.match(/https?:\/\/[^\s]+/);
    if (linkMatch) {
      const link = linkMatch[0];
      if (/v\.douyin\.com|iesdouyin\.com|douyin\.com/.test(link)) {
        try {
          const res = await ctx.request.get(link, {
            headers: this._pageHeaders(),
            timeout: 15000,
          });
          const finalUrl = res.url || "";
          let mm = finalUrl.match(/\/(?:video|note|share\/video)\/(\d{6,})/) ||
            finalUrl.match(/[?&](?:modal_id|aweme_id|item_ids?)=(\d{6,})/);
          if (mm) return mm[1];
          // 重定向没带 id 时,从落地页 HTML 里再找
          const body = await res.text();
          mm = body.match(/["']?(?:aweme_id|awemeId|item_id)["']?\s*[:=]\s*["']?(\d{10,})/);
          if (mm) return mm[1];
        } catch (_) {
          /* 忽略,当作关键词 */
        }
      }
    }
    return null;
  },

  /**
   * 按 aweme_id 抓取单条视频数据。优先走 SSR 页面 render data(无需签名)。
   */
  async _fetchAwemeById(ctx, awemeId) {
    const url = "https://www.douyin.com/video/" + encodeURIComponent(awemeId);
    const html = await this._fetchHtml(ctx, url);
    const data = this._extractRenderData(html);
    if (data) {
      const items = [];
      this._collectAwemes(data, items, {});
      // 优先精确匹配 id,否则取第一条
      const hit =
        items.find((it) => String(this._awemeId(it)) === String(awemeId)) ||
        items[0];
      if (hit) return hit;
    }
    // 兜底: 直接从 HTML 里抠 play_addr(render data 结构变动时的救急)
    return this._salvageFromHtml(html, awemeId);
  },

  /**
   * 提取 SSR render data:
   *  - 新版: <script>window._ROUTER_DATA = {...}</script>
   *  - 老版: <script id="RENDER_DATA" type="application/json">{URI-encoded JSON}</script>
   */
  _extractRenderData(html) {
    // 新版 _ROUTER_DATA
    let m = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]+?)<\/script>/);
    if (m) {
      let raw = m[1].trim().replace(/;+\s*$/, "");
      try {
        return JSON.parse(raw);
      } catch (_) {
        /* 继续尝试其它形态 */
      }
    }
    // 老版 RENDER_DATA(URI 编码)
    m = html.match(
      /<script[^>]*id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/
    );
    if (m) {
      try {
        return JSON.parse(decodeURIComponent(m[1].trim()));
      } catch (_) {
        try {
          return JSON.parse(m[1].trim());
        } catch (_) {
          /* ignore */
        }
      }
    }
    // 其它内联 state
    m = html.match(/window\.__INIT_PROPS__\s*=\s*([\s\S]+?)<\/script>/);
    if (m) {
      try {
        return JSON.parse(m[1].trim().replace(/;+\s*$/, ""));
      } catch (_) {
        /* ignore */
      }
    }
    return null;
  },

  _awemeId(it) {
    return it && (it.aweme_id || it.awemeId || it.awemeId || it.group_id || it.groupId);
  },

  /**
   * 递归收集像 aweme 的对象(含 desc + video,且有 id)。去重。
   */
  _collectAwemes(node, out, seen, depth) {
    depth = depth || 0;
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const el of node) this._collectAwemes(el, out, seen, depth + 1);
      return;
    }
    const id = this._awemeId(node);
    const hasVideo = node.video && typeof node.video === "object";
    if (id && hasVideo && (node.desc !== undefined || node.author)) {
      const key = String(id);
      if (!seen[key]) {
        seen[key] = true;
        out.push(node);
      }
      // aweme 内部一般不再嵌套别的 aweme,停止下钻
      return;
    }
    for (const k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      const v = node[k];
      if (v && typeof v === "object") this._collectAwemes(v, out, seen, depth + 1);
    }
  },

  _firstUrl(x) {
    if (!x) return undefined;
    if (typeof x === "string") return x;
    const list = x.url_list || x.urlList || x.URLList;
    if (Array.isArray(list) && list.length) return list[0];
    if (Array.isArray(x) && x.length) return typeof x[0] === "string" ? x[0] : this._firstUrl(x[0]);
    return undefined;
  },

  _toVod(item) {
    if (!item) return null;
    const id = this._awemeId(item);
    if (!id) return null;
    const video = item.video || {};
    const cover =
      this._firstUrl(video.cover) ||
      this._firstUrl(video.origin_cover) ||
      this._firstUrl(video.originCover) ||
      this._firstUrl(video.dynamic_cover) ||
      this._firstUrl(video.dynamicCover) ||
      undefined;
    const author = item.author || {};
    const nick = author.nickname || author.nickName || "";
    const desc = (item.desc || "").trim();
    const dur = video.duration || (video.play_addr && video.play_addr.duration);
    return {
      id: String(id),
      title: (desc || nick || String(id)).replace(/\s+/g, " ").slice(0, 80),
      poster: cover,
      desc: desc,
      vod_remarks: nick ? "@" + nick : undefined,
    };
  },

  /**
   * 从 aweme 里挑最佳播放地址。
   * 结构双命名兜底:
   *   video.play_addr.url_list  /  video.playAddr.urlList
   *   video.bit_rate[].play_addr.url_list  /  video.bitRateList[].playAddr.urlList
   */
  _bestPlayUrl(item) {
    const video = (item && item.video) || {};

    // 1) bit_rate / bitRateList 里挑码率最高
    const brList = video.bit_rate || video.bitRateList || video.bitrate || [];
    if (Array.isArray(brList) && brList.length) {
      const sorted = brList
        .map((b) => ({
          br: b.bit_rate || b.bitRate || b.gear || 0,
          url:
            this._firstUrl(b.play_addr || b.playAddr || b.playApi) ||
            this._firstUrl(b),
        }))
        .filter((x) => x.url)
        .sort((a, b) => b.br - a.br);
      if (sorted.length) return this._normalizeUrl(sorted[0].url);
    }

    // 2) play_addr / playAddr 直接给
    const direct =
      this._firstUrl(video.play_addr) ||
      this._firstUrl(video.playAddr) ||
      this._firstUrl(video.play_addr_h264) ||
      this._firstUrl(video.playApi) ||
      this._firstUrl(video.download_addr) ||
      this._firstUrl(video.downloadAddr);
    if (direct) return this._normalizeUrl(direct);

    return null;
  },

  _normalizeUrl(u) {
    if (!u) return u;
    let url = u.replace(/^http:\/\//, "https://");
    // 去水印老技巧(部分线路仍有效): playwm → play
    url = url.replace("/playwm/", "/play/").replace("ratio=540p", "ratio=1080p");
    return url;
  },

  /**
   * render data 完全变结构时的救急: 直接从 HTML 里正则抠一个 mp4/m3u8。
   */
  _salvageFromHtml(html, awemeId) {
    const m =
      html.match(/"url_list"\s*:\s*\[\s*"([^"]+\.mp4[^"]*)"/) ||
      html.match(/"playAddr"\s*:\s*"([^"]+\.mp4[^"]*)"/) ||
      html.match(/(https?:\\?\/\\?\/[^"']+?\.(?:mp4|m3u8)[^"']*)/);
    if (!m) return null;
    const url = m[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
    return {
      aweme_id: awemeId,
      desc: "",
      author: {},
      video: { play_addr: { url_list: [url] } },
    };
  },
};
