/**
 * Pornhub 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - 成人内容源。正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *  - PH 有地区限制,国内网络通常需要在「设置 → 代理」里配好代理(scriptFetch 会走
 *    useProxyStore),否则请求会超时/被墙。
 *  - 播放地址走 view_video 页里的 `var flashvars_XXXX = {...}` 内联 JSON,解析
 *    mediaDefinitions。有的条目直接给 HLS master(.m3u8),有的 quality 是数组、
 *    videoUrl 指向 get_media JSON 接口,需要二次请求拿真实清单。
 *
 * 注意: PH 前端标记 / 反爬会变,下面的正则与选择器可能需要按线上实际微调。
 */
return {
  meta: {
    name: "Pornhub",
    author: "DouyTV",
    version: "0.1.0",
    description: "Pornhub 视频源(成人内容,需代理 + 年龄确认)",
  },

  async getSources() {
    // PH 首页推荐 + 若干常见分类。id 用于 recommend 的 sourceId。
    return [
      { id: "recommended", name: "推荐", group: "分类" },
      { id: "video", name: "最新", group: "分类" },
      { id: "hd", name: "HD", group: "分类" },
      { id: "verified", name: "认证", group: "分类" },
    ];
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "recommended";
    // 分类 → 列表页路径
    const pathMap = {
      recommended: "/video/incategories", // 回退到通用视频列表下方处理
      video: "/video",
      hd: "/hd",
      verified: "/video?o=cm", // community verified
    };
    // 简化: 统一用 /video 列表,认证/hd 用 filter 参数
    let path = "/video";
    if (id === "hd") path = "/hd";
    else if (id === "verified") path = "/video?o=tr"; // trending as a proxy

    const url = ctx.utils.joinUrl(
      "https://www.pornhub.com",
      path + (path.includes("?") ? "&" : "?") + "page=" + p
    );
    const html = await this._fetchHtml(ctx, url);
    const list = this._parseVideoList(ctx, html);
    return { list, page: p, pageCount: list.length ? p + 1 : p, total: list.length };
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const url = ctx.utils.buildUrl("https://www.pornhub.com/video/search", {
      search: keyword,
      page: p,
    });
    const html = await this._fetchHtml(ctx, url);
    const list = this._parseVideoList(ctx, html);
    return { list, page: p, pageCount: list.length ? p + 1 : p, total: list.length };
  },

  async detail(ctx, { id, sourceId }) {
    // id === viewkey。详情信息从 view_video 页拿。
    const viewkey = id;
    const url = "https://www.pornhub.com/view_video.php?viewkey=" + encodeURIComponent(viewkey);
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
          sourceId: sourceId || "recommended",
          sourceName: "Pornhub",
          // 播放交给 resolvePlayUrl: playUrl 直接用 viewkey,needResolve=true
          episodes: [{ playUrl: viewkey, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 是 viewkey(detail 里塞的),也兼容传完整 view_video URL 的情况。
    let viewkey = playUrl;
    const m = String(playUrl).match(/viewkey=([a-z0-9]+)/i);
    if (m) viewkey = m[1];

    const pageUrl =
      /^https?:\/\//.test(playUrl) && playUrl.includes("view_video")
        ? playUrl
        : "https://www.pornhub.com/view_video.php?viewkey=" + encodeURIComponent(viewkey);

    const html = await this._fetchHtml(ctx, pageUrl);
    const flash = this._extractFlashvars(ctx, html);
    if (!flash) {
      throw new Error("Pornhub: 未找到 flashvars(可能被反爬拦截 / 需要登录 / 该视频已删除)");
    }

    const mediaDefs = Array.isArray(flash.mediaDefinitions) ? flash.mediaDefinitions : [];
    const best = await this._pickBestMedia(ctx, mediaDefs);
    if (!best) {
      throw new Error("Pornhub: mediaDefinitions 为空或无可用清晰度");
    }

    const isHls = /\.m3u8/i.test(best) || /format=hls|\/hls\//i.test(best);
    return {
      url: best,
      type: isHls ? "hls" : "mp4",
      // 防盗链: 段/清单请求带 Referer,交给 dyproxy 处理(proxyMode 描述符开启时)
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
    if (!res.ok) throw new Error("Pornhub HTTP " + res.status + " @ " + url);
    return res.text();
  },

  /**
   * 从视频列表页解析卡片。PH 列表项典型为:
   *   <li class="pcVideoListItem" data-video-vkey="ph5f...">
   *     <div class="phimage"><a href="/view_video.php?viewkey=ph5f..." title="...">
   *       <img data-src="..." /> or <img src="..." />
   * 这里用 cheerio 兜多种结构。
   */
  _parseVideoList(ctx, html) {
    const $ = ctx.html.load(html);
    const out = [];
    const seen = {};

    $("li.pcVideoListItem, li.videoBox, div.phimage").each((_, el) => {
      const $el = $(el);
      const $a = $el.find('a[href*="viewkey="]').first();
      const href = $a.attr("href") || "";
      const mk = href.match(/viewkey=([a-z0-9]+)/i);
      if (!mk) return;
      const viewkey = mk[1];
      if (seen[viewkey]) return;
      seen[viewkey] = true;

      const $img = $el.find("img").first();
      const poster =
        $img.attr("data-src") ||
        $img.attr("data-thumb_url") ||
        $img.attr("src") ||
        undefined;
      const title =
        ($a.attr("title") || "").trim() ||
        $img.attr("alt") ||
        $el.find(".title a").first().text().trim() ||
        viewkey;
      const duration = $el.find(".duration").first().text().trim();

      out.push({
        id: viewkey,
        title: title.replace(/\s+/g, " "),
        poster,
        vod_remarks: duration || undefined,
      });
    });

    return out;
  },

  /**
   * 抽取 `var flashvars_XXXXXX = { ... };` 的 JSON 对象。
   * PH 会有多个变量,取第一个能 JSON.parse 成功且含 mediaDefinitions 的。
   */
  _extractFlashvars(ctx, html) {
    const re = /var\s+flashvars_\d+\s*=\s*(\{[\s\S]*?\});/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const obj = JSON.parse(m[1]);
        if (obj && obj.mediaDefinitions) return obj;
      } catch (e) {
        // 有的对象内联了不合法 JSON(函数/单引号),跳过继续找
      }
    }
    // 兜底: 直接找 mediaDefinitions 数组片段
    const md = html.match(/"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
    if (md) {
      try {
        return { mediaDefinitions: JSON.parse(md[1]) };
      } catch (e) {
        /* ignore */
      }
    }
    return null;
  },

  /**
   * 从 mediaDefinitions 选最佳可播地址。
   * 条目形态:
   *  - { format:"hls", videoUrl:"https://.../master.m3u8?...", quality:[1080,720,...] }
   *  - { format:"hls"/"mp4", videoUrl:"https://.../get_media?...", quality:"1080" }
   *  - quality 为数组的那条通常是聚合入口(videoUrl 指向 get_media,返回 JSON 清单)
   */
  async _pickBestMedia(ctx, mediaDefs) {
    if (!mediaDefs.length) return null;

    // 1) 直接就是 m3u8 master 的优先
    const directHls = mediaDefs.find(
      (d) => d && typeof d.videoUrl === "string" && /\.m3u8/i.test(d.videoUrl)
    );
    if (directHls) return directHls.videoUrl;

    // 2) quality 是数组 → get_media 聚合入口,二次请求
    const aggregator = mediaDefs.find(
      (d) => d && Array.isArray(d.quality) && typeof d.videoUrl === "string"
    );
    if (aggregator) {
      try {
        const res = await ctx.request.get(aggregator.videoUrl, {
          headers: this._headers(ctx),
          timeout: 20000,
        });
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length) {
          // 每项 { quality:"1080", videoUrl:"...", format:"hls"/"mp4" }
          const withQ = arr
            .filter((x) => x && x.videoUrl)
            .map((x) => ({
              q: parseInt(String(x.quality).replace(/\D/g, ""), 10) || 0,
              url: x.videoUrl,
              hls: /\.m3u8/i.test(x.videoUrl) || x.format === "hls",
            }));
          if (withQ.length) {
            // 偏好 HLS(自适应),否则取最高清 mp4
            const hls = withQ.filter((x) => x.hls).sort((a, b) => b.q - a.q)[0];
            if (hls) return hls.url;
            withQ.sort((a, b) => b.q - a.q);
            return withQ[0].url;
          }
        }
      } catch (e) {
        ctx.log && ctx.log.warn && ctx.log.warn("Pornhub get_media 失败:", String(e));
      }
    }

    // 3) 退而求其次: 任意带 videoUrl 的条目,按 quality 数值降序
    const plain = mediaDefs
      .filter((d) => d && typeof d.videoUrl === "string" && d.videoUrl)
      .map((d) => ({
        q: parseInt(String(d.quality).replace(/\D/g, ""), 10) || 0,
        url: d.videoUrl,
      }))
      .sort((a, b) => b.q - a.q);
    return plain.length ? plain[0].url : null;
  },
};
