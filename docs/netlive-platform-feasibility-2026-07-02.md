# 网络直播平台接入可行性调研（2026-07-02）

目标平台：

- `https://swag.live`
- `https://zh.mycamtv.com`
- `https://zh.myavlive.com`
- `https://www.lemoncams.com/zh/china`

## 现有 DouyTV 接入边界

- NetLive 现已完全走外部 JS 插件注册；插件可直接返回 `hls / flv / dash / mp4 / chunked-mp4 / sample-aes-mp4 / agora-rtc` 流。
- 插件可调用的原生命令白名单很小，目前只有 `fc2_*`、`mfc_*`、`get_stream_proxy_port`、`open_cf_challenge`、`set_mouflon_keys`、`get_mouflon_keys`。
- 仓库已有 Stripchat 专用 Mouflon 解扰能力：可解析 `doppiocdn` HLS master/variant、注入 `pkey`、用用户录入的 `pdkey` 解扰分片名。
- 仓库当前没有 Tencent WebRTC / BytePlus RTM 专用播放协议，也没有对应插件原生命令。

对应代码：

- `src/lib/netlive/external/runtime.ts`
- `src/lib/netlive/types.ts`
- `src-tauri/src/mouflon.rs`
- `src-tauri/src/lib.rs`

## 站点结论

### 1. Mycamtv

结论：**可以接，优先级高，预计低到中等成本。**

依据：

- 首页响应头出现 `x-backend: ... sc-wl-fw`。
- 首页脚本全部来自 `assets.chapturist.com`，与 Stripchat 白标体系一致。
- 首页 HTML 直接带 `https://stripchat.com` 多语言跳转链接。
- 主 bundle 内部 telemetry 资源属性写死 `stripchat`。
- 页面内容/关键词中可见 `doppiocdn / m3u8 / hls / webrtc`。

实现建议：

- 直接复用现有 Stripchat 解流思路做一个白标插件。
- 插件侧主要工作应是：
  - 房间列表 / 搜索 / 房间详情接口定位；
  - 房间 URL / 用户名规则适配；
  - 解析出 master playlist 后走现有 Mouflon 解扰链路；
  - 沿用 `set_mouflon_keys` / `get_mouflon_keys`。

风险：

- `pdkey` 仍然无法自动获取，用户要自行录入。
- 白标域名可能有自己的 referer / cookie / CF 挑战策略，需要单独测一次。

### 2. Myavlive

结论：**可以接，优先级高，预计低到中等成本。**

依据与 Mycamtv 基本一致：

- 同样的 `assets.chapturist.com` 脚本。
- 同样的 `sc-wl-fw` 后端标记。
- 首页包含 Stripchat 多语言链接。
- 主 bundle 同样出现 `stripchat` 标识。

实现建议：

- 基本可与 `mycamtv` 共享 90% 以上插件代码，抽成一个 `stripchat-whitelabel` 基类最合适。

### 3. Lemoncams

结论：**不建议当成“单一直播平台”接入；更像聚合目录站。**

依据：

- `robots.txt` 明确暴露大量 provider 路由：`/chaturbate/*`、`/stripchat/*`、`/myfreecams/*`、`/cam4/*` 等。
- `sitemap-general.xml` 也有大量 `*-cams` provider 页面。
- 前端 bundle 内置 provider 枚举，覆盖 `chaturbate / stripchat / myfreecams / amateurtv / streamate ...` 多个平台。
- 站点存在独立 API 域名 `https://api-v2-prod.lemoncams.com`，但直接探测返回 API Gateway 风格 `Missing Authentication Token`，说明还需要进一步逆向真实路由。

建议：

- 不要把 Lemoncams 当作一个新的“源站”来做播放插件。
- 更合理的做法是：
  - 继续分别接入其背后的上游平台；
  - 如果需要，可单独做一个 **目录插件**，只拿 Lemoncams 的聚合列表，播放时跳转或映射到已接入 provider。

风险：

- 目录页和真实播放源可能并不在同一协议链路上。
- 即使做出来，最终会与已有/计划中的 Stripchat、MFC、AmateurTV 等插件重复。

### 4. SWAG

结论：**理论可接，但当前成本最高，不适合先做。**

依据：

- 首页 SSR 配置中直接出现：
  - `WATCH_TENCENT_URL_PREFIX = webrtc://watch01-tclive-swag02.7umom.cn`
  - `WATCH_URL_PREFIX = https://watch.swag.live`
  - `WATCH_BYTEPLUS_URL_PREFIX = https://watch-bp.swag.live`
  - `BYTEPLUS_RTM_URL_TEMPLATE = {base_url}/{app_name}/{stream_name}_sdp.sdp`
  - `BYTEPLUS_RTM_FLV_URL_TEMPLATE = {base_url}/{app_name}/{stream_name}.flv`
  - `AGORA_RTC_APP_ID` / `AGORA_RTC_VERSION`
- 说明其直播播放至少混用了 Tencent WebRTC、BytePlus RTM/FLV，可能还有 Agora 相关能力。
- 但当前 DouyTV 仅支持 `agora-rtc`，没有 Tencent / BytePlus 专门协议层。
- 已探测到 feed alias `user_livestream-v2`，但公开 API 路径没有直接猜中，仍需继续逆向前端请求链。

实现前提：

- 至少新增一类播放协议：
  - Tencent WebRTC player bridge；或
  - BytePlus RTM/FLV 低延迟拉流适配。
- 同时还要完成：
  - feed 列表接口逆向；
  - 房间详情 / stream token / app_name / stream_name 提取；
  - 可能的鉴权、签名或地区限制处理。

建议：

- 如果目标是尽快扩平台数量，不要先做 SWAG。
- 如果目标是补齐“亚洲成人直播”头部平台，可以排到第二阶段，单独立项。

## 优先级建议

1. `mycamtv`
2. `myavlive`
3. `swag.live`
4. `lemoncams`（仅当目录聚合有明确需求时）

## 推荐落地方案

第一阶段：

- 先做一个 `stripchat-whitelabel` 插件基底。
- 派生两个平台：
  - `mycamtv`
  - `myavlive`

第二阶段：

- 如需补目录能力，再评估 Lemoncams 是否只做列表聚合。

第三阶段：

- 单独攻坚 SWAG：
  - 先抓公开 feed；
  - 再确认实际播放走 Tencent 还是 BytePlus；
  - 最后决定是加新协议还是外接官方 Web 播放器。
