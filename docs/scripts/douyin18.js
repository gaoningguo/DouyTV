/**
 * 抖阴 (douyin18.net) 源脚本 (DouyTV / MoonTV 兼容 source-script)
 *
 * hooks: getSources / recommend / search / detail / resolvePlayUrl
 *
 * 说明:
 *  - douyin18.net(站名"抖阴")是 Nuxt 3 SPA,后端 API 【请求体与响应体都加密】
 *    (curl 直打拿不到明文)。加密方案从 /_nuxt/*.js 逆向(2026-07):
 *
 *    ── 密钥派生 ──
 *      AES key = HmacSHA256( message = Hex解码(requestId去横线),
 *                            key     = Utf8("x3t8rvtaescfe38s") )   → 32 字节(AES-256)
 *      requestId = 每请求一个 UUIDv4(小写带横线)。
 *
 *    ── 请求 body(双层加密)──
 *      内层 data  = AES-CBC( JSON(参数), key, 随机16字节IV )        【不 gzip】
 *                   → base64(IV ‖ ciphertext)
 *      外层 body  = AES-CBC( gzip(JSON({data, token, deviceId})), key, 随机IV )【gzip】
 *                   → base64(IV ‖ ciphertext),作为 POST 原始 body(Content-Type: text/plain)
 *      token = 已登录才有(this 未登录 → 空串);deviceId = 'web'(未登录默认)。
 *
 *    ── 响应 ──
 *      resp(base64) → 取前16字节为 IV,余为密文 → AES-CBC 解密 → ungzip → JSON。
 *      { status:'y', data:{...} } 成功;{ status:'n', error, errorCode } 失败。
 *
 *    ── 请求头 ──
 *      Content-Type: text/plain  /  time: Date.now().toString().slice(0,11)  /
 *      version: 1.0.0  /  deviceType: web  /  requestId: <uuid>  /  language: zh-cn
 *
 *  - 加密用 WebCrypto(crypto.subtle:HMAC-SHA256 + AES-CBC)+ CompressionStream(gzip),
 *    WebView2 / 现代浏览器 / Node 均原生支持,脚本内联实现,无需第三方库。
 *
 *  - API(POST /api/<path>,body 如上加密),2026-07 现行结构:
 *      /movie/category-list  {}                              → data:[{id, name}] 分类清单
 *      /movie/category-video {category_id, page, page_size}  → data.data:[item] 分类列表
 *      /movie/recommend      {page, page_size}               → data.data:[item] 全站推荐流
 *      /movie/search         {keyword, page, page_size}      → data.data:[item] 搜索
 *      /movie/detail         {id}                            → data:{...item} 详情
 *    item: { id, name, img, description, tags:[{id,name}], duration,
 *            play_links:[{code, name, m3u8_url}] }
 *
 *  - 【播放】item.play_links[].m3u8_url 已是【完整路径】/api/m3u8/p/<hash>.m3u8,拼上 base
 *    即得【明文】AES-128 HLS(m3u8 里的 enc.key / segment 都在 zhlsaj.2be8tv2.site 带签名,
 *    dyproxy 会重写并自动拉 key 解密;段 206、key 200,均不校验 Referer/UA)。多线路取 line1。
 *
 *  - 封面 cdn.g3ejjm8m.com 系,匿名可取。国内直连被墙 → 「设置 → 代理」配代理。
 *  - 成人内容源,正式使用需自行确认所在地区法律与站点 ToS,并在 App 侧配年龄门控。
 *
 * 实测证据 (2026-07-21,经 127.0.0.1:7897 代理,匿名):
 *  - 双向加密验证: 空 body → 解出 {"status":"n","error":"安全性错误D!","errorCode":2001};
 *    正确双层 body → /movie/recommend 返 {"status":"y","data":{"list":[{id,vod_name}...]}}。
 *  - /movie/category → 6 个分类;/movie/search {keyword:美女} → status y;
 *  - /api/m3u8/p/<hash>.m3u8 → #EXTM3U AES-128;segment 206;enc.key 200。
 */
return {
  meta: {
    name: "抖阴",
    author: "DouyTV",
    version: "0.1.0",
    description: "抖阴 douyin18(加密 API,成人内容,需代理 + 年龄确认)",
  },

  _AES_KEY: "x3t8rvtaescfe38s",

  _base(ctx) {
    const b = ctx.config && ctx.config.get && ctx.config.get("base");
    return (typeof b === "string" && b) || "https://douyin18.net";
  },

  _ua(ctx) {
    const u = ctx.config && ctx.config.get && ctx.config.get("ua");
    if (typeof u === "string" && u) return u;
    return (
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    );
  },

  /* ───────────────────────── 加密原语(WebCrypto + gzip)───────────────────────── */

  _hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  },

  _bytesToBase64(bytes) {
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  },

  _base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },

  /** UUIDv4(小写带横线),等价站点 generateRequestId。 */
  _uuid() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [];
    for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, "0"));
    return (
      h.slice(0, 4).join("") +
      "-" +
      h.slice(4, 6).join("") +
      "-" +
      h.slice(6, 8).join("") +
      "-" +
      h.slice(8, 10).join("") +
      "-" +
      h.slice(10, 16).join("")
    );
  },

  async _gzip(u8) {
    const cs = new CompressionStream("gzip");
    const w = cs.writable.getWriter();
    w.write(u8);
    w.close();
    const ab = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(ab);
  },

  async _ungzip(u8) {
    const ds = new DecompressionStream("gzip");
    const w = ds.writable.getWriter();
    w.write(u8);
    w.close();
    const ab = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(ab);
  },

  /** key = HmacSHA256(msg = hex解码(requestId去横线), key = utf8(AES_KEY)) → 32 字节。 */
  async _deriveKey(requestId) {
    const msg = this._hexToBytes(requestId.replace(/-/g, ""));
    const keyMat = new TextEncoder().encode(this._AES_KEY);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      keyMat,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", hmacKey, msg);
    return new Uint8Array(sig); // 32 字节 AES-256 key
  },

  async _aesKey(keyBytes) {
    return crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CBC" },
      false,
      ["encrypt", "decrypt"]
    );
  },

  /** encryptData:JSON→[gzip]→AES-CBC(随机IV前置)→base64。 */
  async _encrypt(obj, keyBytes, useGzip) {
    let plain = new TextEncoder().encode(JSON.stringify(obj));
    if (useGzip) plain = await this._gzip(plain);
    const iv = new Uint8Array(16);
    crypto.getRandomValues(iv);
    const key = await this._aesKey(keyBytes);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, plain)
    );
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return this._bytesToBase64(out);
  },

  /** decryptData:base64→前16字节IV→AES-CBC解密→[ungzip]→JSON。 */
  async _decrypt(b64, keyBytes, useGzip) {
    const raw = this._base64ToBytes(b64);
    const iv = raw.subarray(0, 16);
    const ct = raw.subarray(16);
    const key = await this._aesKey(keyBytes);
    let plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ct)
    );
    if (useGzip) plain = await this._ungzip(plain);
    return JSON.parse(new TextDecoder().decode(plain));
  },

  /* ───────────────────────── API 调用 ───────────────────────── */

  /**
   * 加密 POST。body = encrypt({data: <明文参数对象>, token, deviceId}, gzip)。应答 decrypt(gzip)。
   *
   * 【关键】站点是【单层】加密:整个 {data, token, deviceId} 一次性 gzip+AES-CBC。
   * data 字段就是【明文参数对象本身】(不是二次加密的字符串)。之前脚本对 data 做了
   * 二次加密 → 服务端读不到 cate_id/keyword,只能回退默认列表,导致"所有分类内容一样"。
   * (逆向自 /_nuxt 运行时 Cl.encryptData: JSON.stringify({data:rawParams,token,deviceId})
   *  → gzip → AES-CBC(随机IV前置) → base64,与 recommend 侥幸能用但分类失效的现象吻合。)
   */
  async _api(ctx, path, params) {
    const requestId = this._uuid();
    const keyBytes = await this._deriveKey(requestId);

    const outer = await this._encrypt(
      { data: params || {}, token: "", deviceId: "web" },
      keyBytes,
      true
    );

    const url = this._base(ctx) + "/api" + path;
    const res = await ctx.request.post(url, {
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": this._ua(ctx),
        time: Date.now().toString().slice(0, 11),
        version: "1.0.0",
        deviceType: "web",
        requestId,
        language: "zh-cn",
        Origin: this._base(ctx),
        Referer: this._base(ctx) + "/",
      },
      body: outer,
      timeout: 25000,
    });
    if (!res.ok) throw new Error("抖阴 HTTP " + res.status + " @ " + path);
    const text = (await res.text()).trim();
    if (!text) throw new Error("抖阴: 空响应 @ " + path);

    let decoded;
    try {
      decoded = await this._decrypt(text, keyBytes, true);
    } catch (e) {
      throw new Error("抖阴: 响应解密失败 @ " + path + " — " + String(e));
    }
    if (!decoded || decoded.status !== "y") {
      const msg = (decoded && (decoded.error || decoded.errorCode)) || "未知错误";
      throw new Error("抖阴 API 拒绝 @ " + path + ": " + msg);
    }
    return decoded.data;
  },

  /* ───────────────────────── 分类 ───────────────────────── */

  async getSources(ctx) {
    const sources = [{ id: "latest", name: "推荐", group: "浏览" }];
    try {
      // 分类清单来自 /system/menu(站点导航的真实数据源;category-list 已失效)。
      const cats = await this._fetchMenu(ctx);
      for (const c of cats) {
        // id 直接用 cateId(形如 "cat_id_9" / "tag_id_843"):本身唯一、不含冒号,
        // 避免 App 端 id.split(":")[0] 分组高亮把所有分类当同一大类(选一个全选中)。
        sources.push({
          id: c.cateId,
          name: c.name,
          group: c.group,
        });
      }
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("抖阴 分类抓取失败:", String(e));
    }
    return sources;
  },

  /**
   * 分类清单来自首页 __NUXT_DATA__(所有 /movie/system/category-* 端点均已 404-2;
   * 站点导航是 Vue 客户端渲染,数据只在首页 SSR 里)。
   *
   * 【关键 1】首页请求必须带 Accept: text/html,否则只返 289 字节 JS 跳转壳。
   * 【关键 2】__NUXT_DATA__ 是 Nuxt 的【索引化 flatten 数组】—— 值是指向该数组的下标,
   *   需按下标解引用。菜单项结构(实测 2026-07):
   *     flat[i]   = { name: <idx>, filter: <idx> }        (子菜单项)
   *     flat[idx] = "巨乳"                                 (名字)
   *     flat[i+1] = { cat_id: <idx> } 或 { tag_id: <idx> } (紧随的 filter 对象)
   *     flat[idx] = "9" / "843" / "833,879,889"            (cat_id/tag_id 值)
   *   顶级菜单项 { id, name, code, position, style, filter } 的 code 是
   *   "selected"/"scandals"/... ,name 做分组名。
   */
  async _fetchMenu(ctx) {
    const CK = "douyin18:menu:v3";
    try {
      const cached = await ctx.cache.get(CK);
      if (cached && Array.isArray(cached) && cached.length) return cached;
    } catch (e) {
      /* ignore */
    }
    const res = await ctx.request.get(this._base(ctx) + "/", {
      headers: {
        "User-Agent": this._ua(ctx),
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: this._base(ctx) + "/",
      },
      timeout: 20000,
    });
    if (!res.ok) throw new Error("抖阴 首页 HTTP " + res.status);
    const html = await res.text();
    const out = this._parseMenu(html);
    if (out.length) {
      try {
        await ctx.cache.set(CK, out, 86400);
      } catch (e) {
        /* ignore */
      }
    }
    return out;
  },

  /** 从首页 HTML 里解出 __NUXT_DATA__ flatten 数组,按下标解引用还原分类菜单。 */
  _parseMenu(html) {
    const out = [];
    const m = html.match(
      /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!m) return out;
    let flat = null;
    try {
      flat = JSON.parse(m[1]);
    } catch (e) {
      return out;
    }
    if (!Array.isArray(flat)) return out;

    const deref = (v) => (typeof v === "number" ? flat[v] : v);
    const seen = {};
    // 线性扫描:凡是形如 { name, filter } 的子菜单项,配对紧随的 filter 对象
    // ({cat_id} / {tag_id})即为一个分类。顶级项 {id,name,code,...} 不含 filter 键值对,
    // 但也可能匹配 name —— 用 filter 是否解引用出 {cat_id|tag_id} 来区分。
    for (let i = 0; i < flat.length; i++) {
      const node = flat[i];
      if (
        !node ||
        typeof node !== "object" ||
        Array.isArray(node) ||
        !("name" in node) ||
        !("filter" in node)
      ) {
        continue;
      }
      const name = this._decode(String(deref(node.name) || "")).trim();
      if (!name || name === "全部") continue;
      const filterObj = deref(node.filter);
      if (!filterObj || typeof filterObj !== "object") continue;
      let type = "";
      let rawVal = null;
      if ("cat_id" in filterObj) {
        type = "cat";
        rawVal = deref(filterObj.cat_id);
      } else if ("tag_id" in filterObj) {
        type = "tag";
        rawVal = deref(filterObj.tag_id);
      } else {
        continue;
      }
      const value = String(rawVal == null ? "" : rawVal).trim();
      if (!value) continue;
      // /movie/selected 的 cate_id 值 = 路由 /selected/:id 的 params.id,
      // 形如 "cat_id_9" / "tag_id_843"(带前缀的完整串,不是纯数字!传纯数字会被
      // 服务端忽略、回退成推荐流 → 所有分类内容相同)。
      const cateId = type + "_id_" + value;
      const key = cateId;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ cateId, name, group: "分类" });
    }
    return out;
  },

  /* ───────────────────────── 列表 ───────────────────────── */

  async recommend(ctx, { page, sourceId }) {
    const p = page || 1;
    const id = sourceId || "latest";
    // 分类:id 直接是 "cat_id_9" / "tag_id_843"(每个唯一,无公共前缀 —— 否则 App 用
    // id.split(":")[0] 判同类高亮时,同前缀会让选中一个就全高亮)。
    // /movie/selected 的过滤参数名是 cate_id,值 = 带前缀完整串 cat_id_9 / tag_id_843
    // (逆向自 /selected/:cate 页组件 _0x3c6013 = {cate_id: 路由段, page, page_size};
    //  实测单层加密下 cate_id=cat_id_9 → total 451、cat_id_22 → 1181、tag_id_843 → 589,
    //  各分类列表 id 互不相同 —— 修复"所有分类内容一样")。
    if (id !== "latest" && /^(cat|tag)_id_/.test(id)) {
      return this._feed(ctx, "/movie/selected", {
        cate_id: id,
        page: String(p),
        page_size: "20",
      });
    }
    return this._feed(ctx, "/movie/recommend", {
      page: String(p),
      page_size: "20",
    });
  },

  async search(ctx, { keyword, page }) {
    const p = page || 1;
    const kw = String(keyword || "").trim();
    if (!kw) return { list: [], page: p, pageCount: p, total: 0 };
    // 搜索端点是 /search/movie(不是 /movie/search —— 后者返 404-2)。
    return this._feed(ctx, "/search/movie", {
      keyword: kw,
      page: String(p),
      page_size: "20",
    });
  },

  async _feed(ctx, path, params) {
    const page = parseInt(params.page, 10) || 1;
    let data;
    try {
      data = await this._api(ctx, path, params);
    } catch (e) {
      ctx.log && ctx.log.warn && ctx.log.warn("抖阴 列表失败:", String(e));
      return { list: [], page, pageCount: page, total: 0 };
    }
    // _api 返回 decoded.data,即 {data:[...], total, current_page, last_page, page_size}。
    // 列表在 data.data[];兼容 data.list / data 直接是数组的情况。
    const arr =
      (data && Array.isArray(data.data) && data.data) ||
      (data && Array.isArray(data.list) && data.list) ||
      (Array.isArray(data) ? data : []);
    const list = [];
    for (const it of arr) {
      const vod = this._toVod(it);
      if (vod) list.push(vod);
    }
    // 翻页用服务端返回的 last_page/current_page(每页实际条数 <请求 page_size,
    // 用 arr.length>=size 会误判为尾页 → 无法翻页)。缺字段时退回启发式。
    const cur = parseInt((data && (data.current_page ?? page)), 10) || page;
    const last = parseInt((data && data.last_page), 10) || 0;
    const total = parseInt((data && data.total), 10) || list.length;
    const size = parseInt(params.page_size, 10) || 20;
    const hasMore = last ? cur < last : arr.length >= size;
    return {
      list,
      page,
      pageCount: hasMore ? page + 1 : page,
      total,
    };
  },

  /**
   * API item → ScriptVodItem。新结构字段:{ id, name, img, description, tags[],
   * duration, play_links:[{code,name,m3u8_url}] }。缓存 play_links 供 detail/resolve。
   */
  _toVod(it) {
    if (!it || it.id == null) return null;
    const id = String(it.id);
    const title = this._decode(it.name || "") || id;
    const poster = it.img || "";
    const links = this._pickLinks(it);
    const tagName = this._tagText(it.tags);

    this._pendingCache = this._pendingCache || {};
    this._pendingCache[id] = {
      title,
      poster,
      links,
      typeName: tagName,
      remarks: this._decode(it.duration || ""),
      desc: this._decode(it.description || ""),
    };

    return {
      id,
      title,
      poster: poster || undefined,
      type_name: tagName || undefined,
      remarks: this._decode(it.duration || "") || undefined,
    };
  },

  /** 从 item.play_links[] 抽 [{name, url}](m3u8_url 是 /api/m3u8/p/<hash>.m3u8 完整路径)。 */
  _pickLinks(it) {
    const out = [];
    const arr = Array.isArray(it && it.play_links) ? it.play_links : [];
    for (const l of arr) {
      if (!l || !l.m3u8_url) continue;
      out.push({
        name: this._decode(l.name || l.code || "线路"),
        url: l.m3u8_url,
      });
    }
    return out;
  },

  /** tags:[{id,name}] → "标签1 标签2"。 */
  _tagText(tags) {
    if (!Array.isArray(tags)) return "";
    const names = [];
    for (const t of tags) {
      const n = this._decode((t && t.name) || "");
      if (n) names.push(n);
    }
    return names.join(" ");
  },

  /* ───────────────────────── 详情 / 播放 ───────────────────────── */

  async detail(ctx, { id, sourceId }) {
    let info = this._pendingCache && this._pendingCache[id];
    // 缓存缺失或没有播放线路 → 调 /movie/detail 现拉(返回完整 item + play_links)。
    if (!info || !info.links || !info.links.length) {
      try {
        const data = await this._api(ctx, "/movie/detail", { id: String(id) });
        const it =
          (data && data.data) ||
          (data && Array.isArray(data.list) && data.list[0]) ||
          data ||
          {};
        info = {
          title: this._decode(it.name || "") || String(id),
          poster: it.img || "",
          links: this._pickLinks(it),
          typeName: this._tagText(it.tags),
          desc: this._decode(it.description || ""),
          remarks: this._decode(it.duration || ""),
        };
      } catch (e) {
        if (!info) info = { title: String(id), poster: "", links: [] };
      }
    }
    if (!info.links || !info.links.length) {
      throw new Error("抖阴: 无播放线路 @ " + id);
    }

    // play_links 多线路 → 多个 playback(单集)。playUrl 直接存 m3u8 完整路径。
    const playbacks = info.links.map((l) => ({
      sourceId: sourceId || "douyin18",
      sourceName: l.name || "线路",
      episodes: [{ playUrl: l.url, needResolve: true, title: "完整版" }],
      episodes_titles: ["完整版"],
    }));

    return {
      id: String(id),
      title: info.title || String(id),
      poster: info.poster || undefined,
      year: "",
      desc: info.desc || "",
      type_name: info.typeName || undefined,
      playbacks,
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    let u = String(playUrl || "");
    // m3u8_url 形如 /api/m3u8/p/<hash>.m3u8(相对路径)→ 拼站点;绝对 URL 直接用。
    const url = /^https?:\/\//i.test(u)
      ? u
      : this._base(ctx) + "/" + u.replace(/^\/+/, "");
    return {
      url,
      type: "hls",
      headers: {
        "User-Agent": this._ua(ctx),
        Referer: this._base(ctx) + "/",
      },
    };
  },

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _asianRank(text) {
    const s = String(text || "");
    if (/国产|自拍|中文|中国|台湾|香港|华人|chinese|\bchina\b/i.test(s)) return 0;
    if (/日韩|日本|无码|有码|jav|japan|korea|韩/i.test(s)) return 1;
    if (/网红|主播|素人|亚洲|asian|asia/i.test(s)) return 2;
    if (/欧美|美国|欧洲|western|american/i.test(s)) return 50;
    return 60;
  },

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
      .trim();
  },
};
