https://www.pornhub.com/shorties
https://tik.porn/
https://fikfap.com/
https://fyptt.to/
https://www.xfree.com/
https://xxxtik.com/
https://www.xxxfollow.com/?noterms=1
https://ogfap.com/
https://www.avrebo.com/
https://sharesome.com/news/?browse=gwux
https://www.slushy.com/
https://waptap.com/
https://fap.bar/
https://my.club/posts
https://tik.cx/
https://swipefap.com/
https://www.shorts.xxx/
https://reelsmunkey.com/
https://sexreels.net/
https://onlyscroll.com/
https://tikxxx.me/
https://flinbo.com/
https://123av.fun/
https://www.fyf.com/
https://javtrailers.com/shorts
https://bbcrec.com/
https://porntok.io/
https://freaktok.com/
https://sky.porn/
https://www.reddit.com/r/tiktokporn
https://www.reddit.com/r/tiktokthots/

https://pin.porn/
https://xhs18.net/
https://tikporn.tube/
https://onlytik.com/
https://nsfwswipe.com/
https://nudetik.com/
https://tnudes.to/
https://ogfap.com/
https://reelsmunkey.com/
https://919185.xyz/
https://fiqfuq.com/
https://xiaohuangniao.me/
https://douyin18.net/

<!-- ── 新站调研状态 (2026-07,经 127.0.0.1:7897 代理，真实接口逆向) ──
  已完成(真实接口，端到端代理验证可播):
    - nudetik.com   ✅ nudetik.js —— 【HTML 优先】首页/分类/搜索 <article> 网格 + /page/N/ 翻页(对所有 IP 都通);
                       wp-json 仅作分类清单快速路径(部分出口 IP 被 CF WAF 拦 404,失败自动降级首页导航);
                       播放抓 post 页 cheerio 解 <video><source>(xfree/reelsmunkey 自托管 mp4)或
                       sendvid iframe → embed 页 og:video(带 IP token 的 mp4,带 UA 即 206)。
    - tnudes.to     ✅ tnudes.js —— DataLife Engine 站,首页/分类 /<slug>/ + /page/N/ 网格,
                       post 页 og:video 直给 media.tnudes.to/tvids/*.mp4(206);DLE 搜索 ?do=search。
    - onlytik.com   ✅ onlytik.js —— POST /api/new-videos{limit} 随机流(直链+封面+tags);
                       分类 GET /api/tag?tid=&offset= ;直链 cdn2.onlytik.com/videos/<id>.mp4(206)。
    - fiqfuq.com    ✅ fiqfuq.js —— POST /api JSON{a,skip,limit,category,filter} 聚合 reddit/redgifs,
                       item.video_url 直给(v.redd.it CMAF mp4 206);category 走 /c/ 清单;skip 分页。
    - tikporn.tube  ✅ tikporntube.js —— KVS 站,/api/json/videos2/{lt}/str/{sort}/{cnt}/{sec}.{obj}.{pg}.all...json
                       (分类 categories.{dir});搜索 /api/videos2.php;详情 /api/json/video/{lt}/{shardM}/{shardK}/{id}.json;
                       直链固定 v.tikporn.tube/videos/{id}.mp4(206,免 KVS 解混淆)。
    - 919185.xyz    ✅ jiujiu.js —— WordPress + tikswipe 主题,WP REST /posts+/categories(list/search/分类);
                       直链走 admin-ajax wpst_media_data_fetchmeta(需首页内联 nonce,缓存复用)→ dsp.000355.xyz/*.mp4。
    - xhs18.net     ✅ xhs18.js —— Strapi 后端,GET /api/feed?offset=&limit=&q= 返回 items(offset 分页,hasMore/nextOffset);
                       feed 的 videos:[] 为空,真实 mp4 在详情 SSR /posts/{slug} 的 __next_f 里(video.twimg.com amplify mp4,206,带 UA)。
    - xiaohuangniao.me ✅ xiaohuangniao.js —— Next.js,twimg 聚合(同源 xhs18 但接口更简)。
                       热门 GET /api/requestdb?type=hot-tweets&limit=12(固定12条不翻页);
                       分类/搜索 ?type=search-tweets&query=<kw>&page=N&limit=M(返回 data.{tweets,total,totalPages});
                       列表项已内联全档直链 mediaUrls[].url / video_info.variants(twimg mp4 206,Referer 必须 x.com),
                       免详情二请;分类 = /categories 页 __next_f 里的 ~55 个中文关键词做 search-tweets。
    - nsfwswipe.com ✅ nsfwswipe.js —— Laravel SPA,POST /api/more/{page} body {category,tag,name,ids} → HTML 卡片,
                       每个 .swiper-slide 带 data-id/data-hls(v.redd.it master m3u8,带 UA 200)/data-poster/data-cleanlink;
                       全站/分类/标签靠 body 切换,分类清单从 /categories 页(738 个),无搜索。
    - pin.porn      ✅ pinporn.js —— Vue SPA。videoList 主流对数据中心出口 IP 返空、from 游标分页被屏蔽,
                       改用 /api/searchVideos?q=&ipp=N&sort_by= 浏览全库(顺序稳定 → ipp 拉批前端切片翻页);
                       分类 = tagsList 热门 tag 名 → searchVideos?q=<tag>;直链 get_file 302→privatehost.com(206,原样透传)。
    - douyin18.net  ✅ douyin18.js —— Nuxt SPA,API 双层 AES-CBC+gzip 加密(见 memory/douyin18-crypto.md)。
                       脚本内联 WebCrypto(crypto.subtle HMAC-SHA256 + AES-CBC)+ CompressionStream(gzip/ungzip)复刻协议:
                       key=HmacSHA256(hex(requestId去横线), utf8("x3t8rvtaescfe38s"));内层 data=AES-CBC(参数,不gzip),
                       外层 body=AES-CBC({data,token,deviceId},gzip);应答=AES-CBC解密→ungzip→JSON。
                       分类 /movie/category;列表 /movie/recommend|/movie/list{page,page_size,type_id?};
                       搜索 /movie/search{keyword,page,page_size};详情 /movie/detail{id};
                       播放 vod_play_url hash → /api/m3u8/p/{hash}.m3u8(明文 AES-128 HLS,dyproxy 直接吃)。
  【twimg 403 修复】xhs18 / xiaohuangniao 的 twimg 直链:CDN 拒绝非 twitter 的 Referer,
     resolvePlayUrl 必须用 Referer: https://x.com/(不能用本站),否则 403。
  【pin.porn 封面 403 修复】dyproxy /proxy/image 之前会从 Referer 推导注入 Origin 头,
     pin.porn CDN 拒绝任何带 Origin 的图片请求 → 403。已在 src-tauri/src/lib.rs 给 proxy_fetch/
     proxy_fetch_h2 加 send_origin 开关,image 路径(!is_image_path)不发 Origin(对齐浏览器 <img> 行为)。
  待逆向 / 搁置:
    - douyin18.net  Nuxt,/api/movie/recommend 请求体&响应皆 AES-CBC+gzip 加密(key x3t8rvtaescfe38s,IV=requestId);
                       ctx.utils 无 AES/gzip 原语,需内联纯 JS CryptoJS+pako —— 重活,见 memory/douyin18-crypto.md。
-->
