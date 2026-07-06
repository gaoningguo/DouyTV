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

  async getSources(ctx) {
    // 从 /categories 页抓【真实分类】(锚点 href="/video?c=<id>"),亚洲相关排前面。
    // 分类 sourceId 形如 "c:111";另有 video/hd/verified 三个非分类的浏览入口。
    const cats = await this._fetchCategories(ctx);
    const asian = [];
    const other = [];
    for (const c of cats) {
      // rank<99 = 命中亚洲(_asianKw 超集);同时带回 rank 供亚洲内部排序
      const r = this._asianRank(c.name);
      (r < 99 ? asian : other).push({ c, r });
    }
    // 亚洲内部: 中文/台/港 → 日 → 韩 → 其它亚洲(稳定,同档保原顺序)
    asian.sort((a, b) => a.r - b.r);
    const item = (c, group) => ({
      id: "c:" + c.id,
      name: this._zhName(c.name),
      group,
    });
    const sources = [];
    // ① 亚洲分类打头(已按 中→日→韩→其它 排好)
    for (const { c } of asian) sources.push(item(c, "亚洲"));
    // ② 通用浏览入口
    sources.push({ id: "video", name: "最新(全部)", group: "浏览" });
    sources.push({ id: "hd", name: "HD", group: "浏览" });
    sources.push({ id: "verified", name: "认证", group: "浏览" });
    // ③ 其余真实分类(other 里也是 { c, r },同样要解构)
    for (const { c } of other) sources.push(item(c, "分类"));
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    // 无 sourceId 时,动态从站点分类里挑第一个亚洲分类(不写死 id)。
    // 挑不到(抓取失败)才回落到全部列表 + 亚洲关键词加权。
    let id = sourceId;
    if (!id) {
      id = (await this._firstAsianCategoryId(ctx)) || "video";
    }

    let path;
    if (id.indexOf("c:") === 0) {
      // 真实分类: ?c=<id> + 按最多观看排序
      const cid = id.slice(2);
      path = "/video?c=" + encodeURIComponent(cid) + "&o=mv";
    } else if (id === "hd") {
      path = "/hd";
    } else if (id === "verified") {
      path = "/video?o=cm"; // community verified
    } else {
      path = "/video"; // 全部(最新)
    }

    const url = ctx.utils.joinUrl(
      "https://www.pornhub.com",
      path + (path.includes("?") ? "&" : "?") + "page=" + p
    );
    const html = await this._fetchHtml(ctx, url);
    let list = this._parseVideoList(ctx, html);
    // 分类页已按 c= 过滤,再按亚洲关键词加权兜底(把漏网条目往后压)
    list = this._asianSort(list);
    return { list, page: p, pageCount: list.length ? p + 1 : p, total: list.length };
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const url = ctx.utils.buildUrl("https://www.pornhub.com/video/search", {
      search: keyword,
      page: p,
    });
    const html = await this._fetchHtml(ctx, url);
    let list = this._parseVideoList(ctx, html);
    // 搜索结果里也把亚洲相关的排前面
    list = this._asianSort(list);
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
    const cands = await this._collectCandidates(ctx, mediaDefs);
    if (!cands.length) {
      throw new Error("Pornhub: mediaDefinitions 为空或无可用清晰度");
    }
    // 逐个探活,跳过 401/410 死链,返回第一个能拉的。
    // 注意: 探活走 scriptFetch(用户全局代理),播放走 dyproxy(带 proxy 参数)。
    // 若 Clash 多节点轮换导致出口 IP 漂移,探活通过的 URL 播放时仍可能 401/410 ——
    // 这种情况需在 Clash 固定单节点。
    const best = await this._firstLiveUrl(ctx, cands);
    if (!best) {
      throw new Error("Pornhub: 所有清晰度均被拒(可能是会员/受限视频,匿名无法播放)");
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
   * 亚洲关键词正则(getSources 分类分区 + _asianSort 排序共用)。
   * 每次 new 一个,避免共享 /g regex 的 lastIndex 副作用。
   */
  _asianKw() {
    return /japan|japanese|jav|asian|asia|korean|korea|china|chinese|taiwan|thai|hentai|tokyo|desi|filipina|vietnam|東京|日本|亚洲|亞洲|中文|中国|中國|台湾|台灣|香港|韩国|韓国|한국|日本語/i;
  },

  /**
   * 亚洲【内部】优先级: 中文/台湾/港 → 日本 → 韩国 → 其它亚洲。
   * 返回 0/1/2/3;完全不含亚洲关键词返回 99。数字越小越靠前。
   * getSources 分区、_firstAsianCategoryId 选择、_asianSort 排序共用。
   * 注意: 0~2 档各有独立正则(含 _asianKw 未覆盖的 taiwan/香港 等),
   * 3 档回落到 _asianKw —— 故"命中亚洲(rank<99)"是旧 _asianKw 判定的超集,
   * 只会把更多华语条目也算作亚洲,不会漏掉原先命中的。
   */
  _asianRank(text) {
    const s = String(text || "");
    if (/chinese|\bchina\b|taiwan|\btw\b|hongkong|hong\s*kong|\bhk\b|中文|中国|中國|华人|華人|台湾|台灣|台北|香港|粤语|粵語/i.test(s)) return 0;
    if (/japan|japanese|jav|tokyo|hentai|東京|日本|里番|日本語/i.test(s)) return 1;
    if (/korean|korea|韩国|韓国|한국/i.test(s)) return 2;
    if (this._asianKw().test(s)) return 3; // 其它亚洲(asian/thai/desi/filipina/vietnam…)
    return 99; // 非亚洲
  },

  /**
   * 亚洲加权排序: 分类页/搜索页里,标题或作者含亚洲关键词的条目排前面,
   * 其余保持原有相对顺序(稳定排序)。用于把分类漏网的欧美条目往后压。
   * 注意: 这是标题启发式,不改变列表内容,只调顺序 —— 分类页本身已经是亚洲片,
   * 这里主要给 search / verified / 全部列表兜底。
   */
  _asianSort(list) {
    if (!Array.isArray(list) || list.length < 2) return list;
    // 亚洲命中(rank<99)在前、非亚洲(99)在后;亚洲内部再按 中→日→韩→其它 分档。
    // 用带原始下标的稳定排序: 同档保持原相对顺序(不改列表内容,只调顺序)。
    return list
      .map((it, i) => {
        const hay = ((it && it.title) || "") + " " + ((it && it.vod_remarks) || "");
        return { it, i, r: this._asianRank(hay) };
      })
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.it);
  },

  /**
   * 抓 /categories 页的【真实分类】。锚点形如 <a href="/video?c=111">Japanese</a>
   * 或 href="/categories/japanese"。提取 { id, name },按 c= 数字 id 去重。
   * 缓存一天(分类基本不变)。抓不到时回退到一组常见亚洲分类硬编 id。
   */
  async _fetchCategories(ctx) {
    const CK = "ph:categories:v1";
    try {
      const cached = ctx.cache && (await ctx.cache.get(CK));
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore cache miss */
    }

    let cats = [];
    try {
      const html = await this._fetchHtml(ctx, "https://www.pornhub.com/categories");
      // 首选: 页内 `allCategoriesCombined = JSON.parse('[...]')` 内联清单 ——
      // 权威且干净,一条含 id/name/english/url/parent_id/linked_to_tag,
      // 不用从菜单锚点里抠(锚点文本常混入 "46,526 Videos" 计数,难清洗)。
      cats = this._parseCategoriesJson(html);
      // 兜底: 内联 JSON 变形时退回锚点抓取(DOM 更易变,质量差些)。
      if (!cats.length) cats = this._parseCategoriesAnchors(ctx, html);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Pornhub 分类抓取失败:", String(e));
    }

    // 抓不到就返回空 —— 不写死 id,也不缓存空结果(下次仍会重试)。
    // 上层(getSources / recommend)对空分类有优雅降级:回落到 /video 浏览入口。
    if (!cats.length) {
      ctx.log && ctx.log.warn &&
        ctx.log.warn("Pornhub /categories 未解析到分类(DOM/JSON 可能已变),本次降级到全部列表。");
      return [];
    }

    try {
      if (ctx.cache) await ctx.cache.set(CK, cats, 86400);
    } catch (e) {
      /* ignore */
    }
    return cats;
  },

  /**
   * 解析页内 `allCategoriesCombined = JSON.parse('[...]');` 内联清单。
   * 注意: 单引号之间是 JS 单引号字符串字面量,不是直接的 JSON —— 名字含撇号时
   * (如 "Amateur's Choice")PH 输出 `\'`,而 `\'` 不是合法 JSON 转义,直接
   * JSON.parse 会抛错、丢掉整份分类表。故先把 `\'` 还原成 `'` 再 parse。
   * (`\/` JSON 本身允许,无需处理。)
   * 过滤规则:
   *  - 只要顶层分类(parent_id == null),跳过子分类 / 末尾的"组合项"(如 "3P 18-25歲");
   *  - 跳过 linked_to_tag(那是标签不是分类,站点自己走 /video/search,?c=<id> 未必有效);
   *  - 按 id 去重(保留首个出现的干净条目)。
   * 返回 { id, name },name 取 english(便于 _zhName 映射 + _asianKw 命中),
   * 无 english 时退到本地化 name。
   */
  _parseCategoriesJson(html) {
    const m = html.match(/allCategoriesCombined\s*=\s*JSON\.parse\('([\s\S]*?)'\)\s*;/);
    if (!m) return [];
    let arr;
    try {
      // 还原 JS 单引号字符串里的 \' → ' (JSON 不认 \'),其余 JSON 合法转义保持不变
      arr = JSON.parse(m[1].replace(/\\'/g, "'"));
    } catch (e) {
      return [];
    }
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = {};
    for (const c of arr) {
      if (!c || c.id == null) continue;
      const id = String(c.id);
      if (seen[id]) continue;
      if (c.parent_id != null) continue; // 子分类 / 组合项
      if (c.linked_to_tag) continue; // 标签(走搜索),非真实分类
      const name = (c.english || c.name || "").toString().trim();
      if (!name || name.length > 40) continue;
      seen[id] = true;
      out.push({ id, name });
    }
    return out;
  },

  /**
   * 兜底: 从 /categories 菜单锚点抓分类。锚点形如 <a href="/video?c=111">名字</a>。
   * 菜单里同一分类会出现多处(汉堡菜单文本最干净,网格项混入计数),按 id 去重
   * 保留首个,并尽量清洗掉尾部的 "Videos/视频" 计数。质量不如内联 JSON,仅兜底用。
   */
  _parseCategoriesAnchors(ctx, html) {
    const cats = [];
    const $ = ctx.html.load(html);
    const seen = {};
    $('a[href*="?c="], a[href*="&c="]').each((_, el) => {
      const href = $(el).attr("href") || "";
      const mk = href.match(/[?&]c=(\d+)/);
      if (!mk) return;
      const id = mk[1];
      if (seen[id]) return;
      // 名字优先取锚点内文本,退到 title/aria-label
      let name =
        ($(el).text() || "").trim() ||
        ($(el).attr("title") || "").trim() ||
        ($(el).attr("aria-label") || "").trim();
      // 清洗: 去多余空白 + 去掉尾部 "12,345 Videos / 视频 / 视頻" 计数
      name = name
        .replace(/\s+/g, " ")
        .replace(/\d[\d,]*\s*(?:videos?|视频|視頻)?\s*$/i, "")
        .trim();
      if (!name || name.length > 40) return;
      seen[id] = true;
      cats.push({ id, name });
    });
    return cats;
  },

  /**
   * 从站点真实分类里挑【优先级最高】的亚洲分类 sourceId(形如 "c:111")。
   * 优先级: 中文/台/港 → 日 → 韩 → 其它亚洲(_asianRank),同档取首个出现的。
   * 抓不到 / 无亚洲分类时返回 null,调用方自行降级。不写死任何 id。
   */
  async _firstAsianCategoryId(ctx) {
    const cats = await this._fetchCategories(ctx);
    if (!Array.isArray(cats) || !cats.length) return null;
    let best = null;
    let bestRank = 99;
    for (const c of cats) {
      if (!c || !c.name) continue;
      const r = this._asianRank(c.name);
      if (r < bestRank) {
        bestRank = r;
        best = c;
        if (r === 0) break; // 已是最高档(中文),无需再找
      }
    }
    return best ? "c:" + best.id : null;
  },

  /** 常见分类英文名 → 中文(命不中原样返回)。 */
  _zhName(name) {
    const map = {
      Japanese: "日本",
      Asian: "亚洲",
      Korean: "韩国",
      Chinese: "中文",
      Amateur: "素人",
      Anal: "后庭",
      "Big Ass": "翘臀",
      "Big Dick": "大屌",
      "Big Tits": "巨乳",
      Blonde: "金发",
      Blowjob: "口交",
      Brunette: "褐发",
      Cartoon: "动画",
      Casting: "试镜",
      Compilation: "合集",
      Creampie: "内射",
      Cumshot: "颜射",
      "Ebony": "黑人",
      Fetish: "恋物",
      Hardcore: "硬核",
      "HD Porn": "高清",
      Hentai: "里番",
      Latina: "拉丁",
      Lesbian: "女同",
      MILF: "熟女",
      Massage: "按摩",
      Mature: "成熟",
      "Popular With Women": "女性向",
      POV: "第一视角",
      "Public": "户外",
      "Red Head": "红发",
      "Rough Sex": "激烈",
      School: "校园",
      Solo: "单人",
      Squirt: "潮吹",
      Teen: "青年",
      Threesome: "3P",
      Toys: "玩具",
      Uniform: "制服",
      Verified: "认证",
      Vintage: "复古",
      Webcam: "直播",
    };
    return map[name] || name;
  },

  /**
   * 抽取 `var flashvars_XXXXXX = { ... };` 的 JSON 对象。
   * 用括号配平取完整对象 —— 不能用非贪婪 /\{[\s\S]*?\}/,那会在 flashvars
   * 内部第一个嵌套对象的 `}` 处截断(mediaDefinitions 里全是嵌套对象),
   * 导致复杂视频解析失败、退回坏兜底 URL。
   */
  _extractFlashvars(ctx, html) {
    const decl = /var\s+flashvars_\d+\s*=\s*\{/g;
    let d;
    while ((d = decl.exec(html)) !== null) {
      // 从声明里第一个 `{` 开始做括号配平(忽略字符串内的括号)
      const start = d.index + d[0].length - 1;
      const json = this._sliceBalanced(html, start);
      if (!json) continue;
      try {
        const obj = JSON.parse(json);
        if (obj && obj.mediaDefinitions) return obj;
      } catch (e) {
        // 个别对象内联了非法 JSON(函数/单引号),跳过继续找下一个 flashvars
      }
    }
    // 兜底: 直接括号配平抠 "mediaDefinitions": [ ... ]
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

  /**
   * 从 html[start] 处的 open 字符开始,做括号配平,返回含配对 close 的完整子串。
   * 跳过字符串字面量内的括号与转义。open/close 默认 `{`/`}`。失败返回 null。
   */
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
          i++; // 跳过转义字符
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

  /**
   * 从 mediaDefinitions 收集【有序候选播放地址】(去重),不做探活。
   * 排序策略: 自适应 master(quality 为数组的那条,时效最长最稳)优先,
   * 再按各清晰度 高→低。调用方逐个探活挑第一个能拉的,规避 401/410 死链。
   * 条目形态:
   *  - { format:"hls", videoUrl:".../master.m3u8?...", quality:[1080,720,...] }  ← 自适应入口
   *  - { format:"hls"/"mp4", videoUrl:".../get_media?...", quality:"1080" }        ← get_media 聚合
   *  - { format:"mp4", videoUrl:".../1080P_..mp4?...", quality:"1080" }            ← 单码率直链
   */
  async _collectCandidates(ctx, mediaDefs) {
    const cands = []; // { q, url, hls }
    const push = (url, q, hls) => {
      if (url && typeof url === "string") cands.push({ q: q || 0, url, hls: !!hls });
    };

    // 1) 自适应 master(videoUrl 直接是 .m3u8 且 quality 是数组)—— 最优先,时效最稳
    for (const d of mediaDefs) {
      if (!d || typeof d.videoUrl !== "string") continue;
      if (Array.isArray(d.quality) && /\.m3u8/i.test(d.videoUrl)) {
        push(d.videoUrl, 99999, true); // 极高优先级
      }
    }

    // 2) quality 是数组但 videoUrl 指向 get_media JSON 聚合 → 二次请求展开
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
            // HLS 项额外加权(自适应/兼容性更好),清晰度其次
            push(x.videoUrl, hls ? q + 100000 : q, hls);
          }
        }
      } catch (e) {
        ctx.log && ctx.log.warn && ctx.log.warn("Pornhub get_media 失败:", String(e));
      }
    }

    // 3) 单码率直链(quality 是字符串/数字)
    for (const d of mediaDefs) {
      if (!d || typeof d.videoUrl !== "string" || Array.isArray(d.quality)) continue;
      const q = parseInt(String(d.quality).replace(/\D/g, ""), 10) || 0;
      const hls = /\.m3u8/i.test(d.videoUrl) || d.format === "hls";
      push(d.videoUrl, hls ? q + 100000 : q, hls);
    }

    // 去重 + 按优先级降序
    const seen = {};
    return cands
      .filter((c) => (seen[c.url] ? false : (seen[c.url] = true)))
      .sort((a, b) => b.q - a.q);
  },

  /**
   * 逐个探活候选,返回第一个未被拒(非 401/403/410/404)的 URL。
   * 用轻量 Range 请求探头,只读 1 字节,避免整段下载。
   * 全部被拒时回退到第一个候选(让播放器自己再试一次,至少不空手)。
   */
  async _firstLiveUrl(ctx, cands) {
    if (!cands.length) return null;
    for (const c of cands) {
      try {
        const res = await ctx.request.get(c.url, {
          headers: { ...this._headers(ctx), Range: "bytes=0-1" },
          timeout: 12000,
        });
        // 200/206 正常; 302 会被 ureq follow; 401/403/404/410 视为死链跳过
        if (res.ok || res.status === 206) return c.url;
        if ([401, 403, 404, 410].includes(res.status)) {
          ctx.log && ctx.log.warn &&
            ctx.log.warn("Pornhub 候选被拒 " + res.status + ",跳过:", c.url.slice(0, 90));
          continue;
        }
        // 其它状态(如 5xx)也跳过继续试
      } catch (e) {
        // 网络错误 → 继续下一个候选
        ctx.log && ctx.log.warn && ctx.log.warn("Pornhub 候选探活异常,跳过:", String(e));
      }
    }
    // 全被拒: 回退第一个(可能是 premium/受限视频,匿名无法播放)
    return cands[0].url;
  },
};
