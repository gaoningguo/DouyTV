/**
 * Waptap 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - Waptap 是 "成人 TikTok" 竖屏短视频站(Next.js App Router 前端 + 独立 JSON API)。
 *  - API 基址 https://api.waptap.com,响应统一包一层 { code, status, uuid, data },
 *    真正内容在 data.{items,_links,_meta}。**匿名可读、匿名可播**(实测)。
 *  - 视频直链在 item.file(https://cdn.waptap.com/videos/*.mp4),Cloudflare CDN
 *    不校验 Referer/UA,匿名 Range 206 video/*,天生适合竖屏刷流。
 *  - 国内直连被墙,请在「设置 → 代理」配代理;scriptFetch 与播放代理会自动走它。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * API 形态 (2026-07 实测,全部经 127.0.0.1:7897 代理匿名验证):
 *  - 推荐流: GET /v1/media?type=feed-v3&show_adult_content=true&filter_content_gender=all
 *            &__Secure_uuid=<uuidv7>  → { data:{ items:[...], _links:{next:{href}}, _meta } }
 *            type 亦可为 new / old。翻页读 _links.next.href(整条 URL,含 page= 参数)。
 *            带自选 __Secure_uuid 时是"打乱推荐流",页与页有少量重叠属正常。
 *  - 标签流: GET /v1/media?type=hashtag&tag=<slug>&...  → 同结构,标签相关内容。
 *  - 详情:   GET /v1/media/<_id>  → data 即单条 media(注意用 _id,不是 slug)。
 *  - item:   { _id, slug, description, file(mp4直链), cover, length(秒), content_gender,
 *              hashtags:[{hashtag}], creator:{username,display_name,avatar},
 *              visit_count, like_count, is_livestream, __livestream:{stream:{url}} }
 *  - 直播项 (is_livestream) 拉流是 __livestream.stream.url(HLS),本脚本跳过直播只收点播。
 *  - 站内搜索走 Meilisearch(host/key 未公开),匿名不可直连;这里搜索回落为标签流。
 *  - 视频直链实测: HEAD .../videos/<hash>.mp4 → 206 video/mp4(8.2MB 样本)。
 */
return {
  meta: {
    name: "Waptap",
    author: "DouyTV",
    version: "0.1.0",
    description: "Waptap 成人 TikTok 竖屏短视频(成人内容,需代理 + 年龄确认)",
  },

  /** API 基址,可用脚本 config.api 覆盖(万一换域名)。 */
  _api(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("api");
    return (typeof b === "string" && b) || "https://api.waptap.com";
  },

  /** 站点基址(仅用于 Referer/Origin)。 */
  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://waptap.com";
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
    const base = this._base(ctx);
    return {
      "User-Agent": this._ua(ctx),
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "application/json, text/plain, */*",
      Origin: base,
      Referer: base + "/",
    };
  },

  /**
   * 每个 App 会话生成一个 uuidv7 风格的 __Secure_uuid,让推荐流稳定分片。
   * 简化实现:随机 hex 拼成 uuid 形态(服务端只当它是游标种子,不校验版本位)。
   */
  _uuid() {
    if (this.__uuid) return this.__uuid;
    const hex = (n) => {
      let s = "";
      for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
      return s;
    };
    this.__uuid =
      hex(8) + "-" + hex(4) + "-7" + hex(3) + "-" + hex(4) + "-" + hex(12);
    return this.__uuid;
  },

  async _getJson(ctx, url) {
    const res = await ctx.request.get(url, {
      headers: this._headers(ctx),
      timeout: 20000,
    });
    if (!res.ok) throw new Error("Waptap HTTP " + res.status + " @ " + url);
    const body = res.json();
    // 统一拆包 { code, status, uuid, data }
    if (body && typeof body === "object" && "data" in body) return body.data;
    return body;
  },

  async getSources(ctx) {
    // 浏览入口 + 精选标签(亚洲相关排最前,照站点内容偏好)。
    const sources = [
      { id: "feed-v3", name: "推荐", group: "浏览" },
      { id: "new", name: "最新", group: "浏览" },
    ];
    // 站点没有公开的"标签清单"端点(trending-hashtags 均 404),
    // 用一份实测有内容的精选标签(每个都验证过 type=hashtag 返回条目)。
    const asian = [
      ["asian", "亚洲"],
      ["japanese", "日本"],
      ["korean", "韩国"],
      ["thai", "泰国"],
      ["latina", "拉丁"],
      ["ebony", "黑人"],
    ];
    const other = [
      ["amateur", "素人"],
      ["teen", "Teen"],
      ["milf", "MILF"],
      ["anal", "Anal"],
      ["creampie", "Creampie"],
      ["bigtits", "Big Tits"],
      ["hentai", "Hentai"],
      ["cosplay", "Cosplay"],
    ];
    for (const [slug, name] of asian)
      sources.push({ id: "tag:" + slug, name, group: "亚洲" });
    for (const [slug, name] of other)
      sources.push({ id: "tag:" + slug, name, group: "标签" });
    return sources;
  },

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "feed-v3";
    if (id.indexOf("tag:") === 0) {
      const tag = id.slice("tag:".length);
      return this._feed(ctx, p, "tag:" + tag, { type: "hashtag", tag });
    }
    const type = id === "new" || id === "old" ? id : "feed-v3";
    return this._feed(ctx, p, type, { type });
  },

  /**
   * 搜索:站内搜索走 Meilisearch(host/key 未公开,匿名不可直连)。
   * 回落策略:把关键词当标签流拉(tag=<keyword 归一化>)。命中率取决于该标签是否存在。
   */
  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    return this._feed(ctx, p, "q:" + kw, { type: "hashtag", tag: kw });
  },

  /**
   * 通用列表拉取。page 1 用 base 参数起头,page>1 读上一页缓存的 next href。
   * sk 为缓存分区键(区分不同分类/搜索词)。
   */
  async _feed(ctx, page, sk, extraQuery) {
    let url;
    if (page > 1) {
      let next;
      try {
        next = await ctx.cache.get("next:" + sk + ":" + page);
      } catch (e) {
        /* ignore */
      }
      if (!next) return { list: [], page, pageCount: page, total: 0 };
      url = next;
    } else {
      const q = {
        show_adult_content: "true",
        filter_content_gender: "all",
        __Secure_uuid: this._uuid(),
      };
      for (const k in extraQuery) {
        if (extraQuery[k] != null && extraQuery[k] !== "") q[k] = extraQuery[k];
      }
      url = ctx.utils.buildUrl(this._api(ctx) + "/v1/media", q);
    }

    let data;
    try {
      data = await this._getJson(ctx, url);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("Waptap 列表失败:", String(e));
      return { list: [], page, pageCount: page, total: 0 };
    }

    const items = (data && Array.isArray(data.items) && data.items) || [];
    const list = [];
    for (const it of items) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }

    const next = data && data._links && data._links.next && data._links.next.href;
    if (next) {
      try {
        await ctx.cache.set("next:" + sk + ":" + (page + 1), next, 1800);
      } catch (e) {
        /* ignore */
      }
    }

    const hasMore = !!next && items.length > 0;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total: list.length,
    };
  },

  /**
   * media item → ScriptVodItem。跳过直播(is_livestream),只收点播 mp4。
   * 用 _id 作 id(详情端点认 _id)。顺便把解析结果塞内存缓存供 detail 命中。
   */
  _toVod(it) {
    if (!it || !it._id) return null;
    if (it.is_livestream) return null; // 直播不收(拉流是 WebRTC/HLS 长连,不适合本刷流管线)
    const file = it.file;
    if (!file || typeof file !== "string" || !/\.(mp4|m4v|webm|mov)(\?|$)/i.test(file)) {
      return null;
    }
    const id = String(it._id);
    const creator = it.creator || {};
    const author = (creator.display_name || creator.username || "").trim();
    const title = this._cleanTitle(it.description) || author || id;
    const tags = Array.isArray(it.hashtags) ? it.hashtags : [];
    const typeName = tags.length ? tags[0].hashtag : undefined;

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      file,
      cover: it.cover || "",
      title,
      author,
      desc: (it.description || "").trim(),
      typeName,
    };

    return {
      id,
      title,
      poster: it.cover || undefined,
      desc: author || undefined,
      type_name: typeName,
      vod_remarks: it.visit_count ? this._fmt(it.visit_count) + " 次播放" : undefined,
    };
  },

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    if (!info) {
      const data = await this._getJson(
        ctx,
        this._api(ctx) + "/v1/media/" + encodeURIComponent(id)
      );
      // 详情 data 可能直接是 media,也可能包一层
      const media = data && (data.file ? data : data.media || data.item);
      if (!media || !media.file) {
        throw new Error("Waptap: 未找到该视频(可能已删除)@ " + id);
      }
      const creator = media.creator || {};
      const author = (creator.display_name || creator.username || "").trim();
      const tags = Array.isArray(media.hashtags) ? media.hashtags : [];
      info = {
        file: media.file,
        cover: media.cover || "",
        title: this._cleanTitle(media.description) || author || id,
        author,
        desc: (media.description || "").trim(),
        typeName: tags.length ? tags[0].hashtag : undefined,
      };
    }

    return {
      id,
      title: info.title,
      poster: info.cover || undefined,
      year: "",
      desc: info.desc || info.author || "",
      type_name: info.typeName,
      playbacks: [
        {
          sourceId: sourceId || "waptap",
          sourceName: "Waptap",
          episodes: [{ playUrl: info.file, needResolve: true, title: "完整版" }],
          episodes_titles: ["完整版"],
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    // playUrl 已是 cdn.waptap.com 上的 .mp4 直链。CDN 不校验 Referer/UA,给个像样 UA。
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

  _fmt(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(v);
  },

  /** 清洗描述作标题:去 hashtag / URL,截断 80 字符;全是标签则返空。 */
  _cleanTitle(text) {
    if (!text || typeof text !== "string") return "";
    const cleaned = text
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/#[^\s#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 2) {
      return cleaned.length > 80 ? cleaned.slice(0, 80).trim() + "…" : cleaned;
    }
    return "";
  },
};
