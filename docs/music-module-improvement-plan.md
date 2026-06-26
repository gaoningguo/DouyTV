# DouyTV 音乐模块修改计划

> 基于 `music-module-comparison.md` 的对比结论，按「实质能力缺口」优先级排序。
> 每项含：目标、为什么、改动点（具体文件）、验收标准、工作量评估、风险。
> 设计取向决定的非缺口（登录态、流媒体协议）不在计划内。

---

## 优先级总览

| # | 项目 | 价值 | 工作量 | 风险 | 建议批次 |
|---|---|---|---|---|---|
| P0-1 | 洛雪脚本沙箱执行 ✅ 已完成 | 高（兼容洛雪生态） | 大 | 中 | 批 A |
| P0-2 | 本地曲库持久化 ✅ 已完成 | 中高（体验） | 小 | 低 | 批 A |
| P1-1 | ReplayGain 响度均衡 ✅ 已完成 | 中 | 中 | 低 | 批 B |
| P1-2 | 曲间真·重叠 crossfade ✅ 已完成（双 deck） | 中 | 大 | 中 | 批 B |
| P1-3 | 桌面歌词样式可配 ✅ 已完成 | 中 | 小 | 低 | 批 B |
| P2-1 | 歌词跨源融合 ✅ 已完成（繁简暂缓） | 中低 | 中 | 低 | 批 C |
| P2-2 | 封面取色就地改进 ✅ 已完成（不引依赖） | 低 | 小 | 低 | 批 C |
| P2-3 | 音质档数细化 ✅ 已覆盖（无需改动） | 低 | 小 | 低 | 批 C |

---

## 批 A — 补齐实质能力缺口

### P0-1：洛雪脚本沙箱执行

**目标**：让靠脚本运行时算签名/MD5 的洛雪源能真正出链接，而不只是「解析元数据当模板直链」。

**为什么**：当前 `src/lib/music/lxSource.ts` 明确只解析头部 JSDoc + 抽 `apiUrl`/`urlPathTemplate`，对「链接需脚本内 MD5/签名动态计算」的洛雪源直接失效（`parseLxScript` 抽不到 apiUrl 就返回 null）。CyreneMusic 用 iframe + `new Function` 真执行 + Rust reqwest 代理网络解决了这个。本项目已有 `pluginAdapter.ts` 的 `new Function` 沙箱基建可复用。

**改动点**：
- 新增 `src/lib/music/lxRuntime.ts`：
  - 模拟 `globalThis.lx` 环境：`lx.EVENT_NAMES`、`lx.on`/`lx.send`、`lx.request`、`lx.utils.crypto`（**MD5 必须实现**，aes/rsa 视脚本需要补）、`lx.utils.buffer`。
  - 用 `new Function(scriptContent)()` 执行（参考 `pluginAdapter.ts:97-137` 的 transformExports + 垫片注入方式）。
  - `lx.request` 网络层走 `scriptFetch`（已有 Rust `script_http` 代理，**复用现成基建，无需新增 Rust 命令**——这点比 Cyrene 简单，它额外开了 `lx_http_request`）。
  - 导出 `loadLxScript(script)` / `getLxMusicUrl(source, songId, quality)`，30s 超时。
- 改 `src/lib/music/types.ts`：`lx-source` 描述符增加 `mode: 'template' | 'runtime'` 字段（默认 template，向后兼容）。
- 改 `src/lib/music/lxSource.ts`：`parseLxScript` 抽不到 apiUrl 时不再返回 null，而是标记 `mode: 'runtime'` 并保留完整脚本源码。
- 改 `src/lib/music/index.ts`：`resolveMusicSource` 对 `lx-source` 分 mode 走 template（现状）或 runtime（新路径）。
- 改导入 UI `src/pages/music/components/SourceDialog.tsx`：解析后显示「该源需脚本执行模式」提示。

**验收**：导入一个签名型洛雪源（如需 MD5 算 token 的酷狗源），搜索出歌 + 点播放能出真实直链播放成功。

**工作量**：大（MD5 实现 + 沙箱环境模拟 + 事件协议对接是主要成本）。
**风险**：中。`new Function` 执行第三方脚本有安全面，但本项目已对 plugin-js 这么做，风险等同；需复用同样的沙箱隔离约定。脚本可能依赖未实现的 `lx.utils` 方法 → 需按报错逐步补垫片。

---

### P0-1：洛雪脚本沙箱执行 ✅ 已完成

> 实现：新增 `src/lib/music/lxRuntime.ts`——主上下文 `new Function` 执行洛雪脚本（与 `pluginAdapter` 同样的安全姿态，不开 iframe），模拟 `globalThis.lx` 环境（`EVENT_NAMES`/`on`/`send`/`request`/`utils.crypto.md5`+`buffer`），网络复用现有 `scriptFetch`（Rust `script_http` 代理，**无需新增 Rust 命令**，比 Cyrene 省）。MD5 照搬 Cyrene 沙箱实现。`lxSource.ts` 的 `parseLxScript` 抽不到静态 apiUrl 但脚本注册了 `lx.on('request')` 时，返回 `mode:"runtime"` 并保留完整源码；`types.ts` 加 `lxMode` 字段；`createLxSourceDescriptor` 按 mode 分流；`resolveCyrene`（cyreneApi.ts）对 `lxMode==="runtime"` 调 `getLxRuntimeMusicUrl` 执行脚本算签名取链，否则走原静态模板路径。导入 UI（SourceDialog）显示「执行模式」提示。脚本缓存按 `(id, updatedAt)` 键。

> 已知限制：`utils.crypto` 的 aes/rsa 是占位（与 Cyrene 一致），依赖 AES/RSA 的少数脚本需后续按报错补垫片。

---

### P0-2：本地曲库持久化 ✅ 已完成

> 实现：Rust 加 `list_music_files`（只列路径+mtime）+ `extract_music_metadata`（解析指定文件）两命令，`LocalTrackMeta` 加 `mtime` 字段，SQL 迁移 v3 建 `local_tracks` 表。JS 新增 `src/lib/music/localMusicDb.ts`（SQLite 缓存层），`stores/musicLocal.ts` 改为：hydrate 从 SQLite 秒读缓存 → 后台按 mtime 增量补扫（只解析新增/变更文件，删消失文件）。非 Tauri 退回全量扫描。封面 base64 直接入库（SQLite 无 localStorage 配额限制）。

**目标**：本地音乐扫描结果落库，进页面不再每次重扫。

**为什么**：当前 `localMusic.ts:scanMusicFolder` 每次调用都全量走 Rust `scan_music_folder` + lofty 解析；store 只持久化文件夹路径（`stores/music.ts` 的 persist payload 里没有本地曲目）。SPlayer/Cyrene 都落 SQLite。项目已有 SQLite 基建（`src/lib/db.ts` + `tauri-plugin-sql`，CLAUDE.md 记载 library store 已用）。

**改动点**：
- `src-tauri/src/lib.rs`：新增 SQL 迁移表 `local_tracks`（file_path PK, name, artists, album, duration, cover_data_url, lyric, folder, mtime, scanned_at）。**注意**：cover dataURL 可能较大，建议存封面缓存路径而非 base64，或单列可空。
- 新增 `src/lib/music/localMusicDb.ts`：`upsertLocalTracks` / `getLocalTracks` / `removeByFolder`，仿 `stores/library.ts` 的 SQL 用法；非 Tauri 环境回退 localStorage。
- 改 `localMusic.ts:scanMusicFolder`：扫描后 upsert 入库；新增 `loadLocalLibrary()` 进页先读库、后台增量重扫（按 mtime diff）。
- 改本地视图（`src/pages/music/views/` 里的 Local 视图）：首屏读库秒出，手动「重新扫描」才全量。

**验收**：扫描一次文件夹后重启 App / 切走再回本地页，曲目立即显示无需重扫；删除文件夹的曲目从库中清除。

**工作量**：小（SQL + upsert，模式照搬 library store）。
**风险**：低。封面 base64 入库体积是唯一要注意的点 → 优先存路径。

---

## 批 B — 播放体验增强

### P1-1：ReplayGain 响度均衡 ✅ 已完成

> 实现：在线流无内嵌 ReplayGain 标签，故走**运行时 AGC**（响度归一）。`audioGraph.ts` 利用 analyser 在 gain 节点之前的位置读原始信号，按 byteTimeDomainData 算 RMS → EMA 平滑 → 反推补偿系数（夹在 [0.5, 2.2] 防爆音/过放，0.5s 时间常数平滑落到 gain 节点）。5Hz tick。新增 `setReplayGainEnabled`/`resetReplayGain`，建图时按当前开关补启，切歌时重置估计重新收敛。`stores/music.ts` 加 `replayGainEnabled` 设置（持久化），Music.tsx 加实时开关 effect + 切歌重置，MusicDrawer 加开关 UI。受「需开稳定流代理建图」同一约束。

**目标**：不同歌曲音量拉平，避免切歌忽大忽小。

**为什么**：当前 `audioGraph.ts` 的 gain 节点固定 1.0，无响度归一。SPlayer 有 track/album 两模式 ReplayGain + 防削波。

**改动点**：
- `audioGraph.ts`：新增 `setReplayGain(db)` 调 `graph.gain.gain` + 软限幅（防削波，可加 DynamicsCompressor 兜底）。
- 增益来源两条路：① 歌曲元数据带 ReplayGain tag（本地 lofty 可读，扩展 Rust `scan_music_folder` 返回字段）；② 无 tag 时用 AnalyserNode 跑一段算 RMS 估算（轻量近似）。
- `stores/music.ts`：新增 `replayGainEnabled` 设置项，加入 persist payload。
- 设置 UI（`MusicDrawer` settings tab + `MusicSourcesHub` 播放器 Tab）加开关。

**验收**：开启后，一首极响和一首极轻的歌切换，主观音量接近。
**工作量**：中。**风险**：低。受现有「EQ 需开代理建图」同一约束（无图时此功能也不可用，需在 UI 标注）。

---

### P1-2：曲间真·重叠 crossfade ✅ 已完成（方案二：双 deck 混音图）

> **二次升级**：P1-2 初版做的是「非重叠淡入淡出」（保留备查见下）。用户后续明确要 **SPlayer 同款真·重叠 crossfade**（两首歌同时出声交叠），遂把播放核心从单 deck 重构成双 deck。

> 架构：`audioGraph.ts` 重写为**双 deck 混音图**——`deckA/deckB`（各 `<audio>→source→deckGain`）合流到 `bus → EQ(filters) → analyser → masterGain → destination`。EQ/频谱/ReplayGain 都在合流后，只一套，crossfade 期间两首共享。对外保留全部旧接口（`ensureAudioGraph`/`applyEqGains`/`getSpectrum`/`setReplayGainEnabled` 等），新增 `ensureDeck`/`fadeDeckGain`/`setDeckGain`/`hasDeck`。

> Music.tsx 接法（**最小爆炸半径**）：挂两个真实 `<audio>`（deck0/1，callback ref），`audioRef` 改成 getter 代理 `.current` 始终返回活动 deck → 现有 ~40 处 `audioRef.current` 读取**零改动**；事件处理器加「仅活动 deck」守卫，旧 deck 淡出尾音不会误触发 `onEnded`/`onTimeUpdate`。新增 `crossfadeToNext()`：曲尾触发时解析下一首载入**空闲 deck**、两 deck `.volume` 反向 ramp（`fadeDeckVolume` 直接动元素音量，天然可叠加、不依赖 CORS）、翻转活动指针、提交 currentSong/歌词/历史/预取，旧 deck 淡完 `pause()`。竞态用 `playRequestRef` 统一防护：crossfade 在途时手动 `playSong` 会 bump requestId 令其 commit 段失效，并清理空闲 deck 余音 + 取消其淡变 RAF。起重叠失败（解析不了/deck 不可用）回退到 P1-2 初版的单 deck 淡出 + onEnded 硬切。`crossfadeSec=0`（默认）时全程不触发，行为与改动前完全一致。

> 验证：tsc + vite build 通过。运行时仍需 `pnpm tauri dev` 实测（重点：两首交叠听感、手动切歌打断重叠、seek/试听跳过/预取不被破坏、EQ/频谱在 crossfade 中持续生效）。

<details><summary>P1-2 初版（非重叠淡入淡出，已被双 deck 取代，保留备查）</summary>

> 实现：单元素淡入淡出过渡（非重叠，不动图）：`stores/music.ts` 加 `crossfadeSec`（0=关，默认 0，最大 12s）；`Music.tsx` 加 `fadeVolume(target,sec)` RAF 音量 ramp；`handleAudioTime` 在曲尾触发淡出，新曲 `play()` 后从 0 淡入。换来零 gap 风险、不碰单例图。后被方案二双 deck 真重叠取代。

</details>

<details><summary>原计划（保留备查）</summary>

**目标**：上一首尾 N 秒与下一首头 N 秒交叉淡入淡出。

**为什么**：当前单 `<audio>` 切歌是硬切。SPlayer 用第二引擎实例实现 crossfade。

**改动点**：
- **架构决策点**：单 `<audio>` 无法 crossfade（同一元素不能同时播两首）。需引入**第二个 `<audio>` + 第二条 Web Audio 图**做交替播放（A/B 双 deck）。这会触碰 `audioGraph.ts` 的「单例图」假设（`ensureAudioGraph` 当前显式拒绝绑第二个元素）。
- 评估两方案：
  - 方案一（推荐先做）：仅在「自然播放到结尾自动切下一首」时启用 crossfade，手动切歌仍硬切 → 复杂度可控。
  - 方案二：全场景 crossfade → 要重构成 deck 管理器，工作量大。
- 改 `audioGraph.ts`：支持双图实例（去掉单例硬限制，改为 deckA/deckB）。
- `stores/music.ts`：`crossfadeSec` 设置（0=关，默认 0）。

**验收**：设 crossfade=4s，自动连播两首歌在衔接处听到交叉淡化无静音断点。
**工作量**：中（方案一）/ 大（方案二）。
**风险**：中。触碰核心播放假设，需回归测试现有播放/seek/试听跳过逻辑不被破坏。**建议先做方案一，且单独成 commit 便于回退。**

---

### P1-3：桌面歌词样式可配 ✅ 已完成

> 实现：`stores/music.ts` 加 `desktopLyricStyle {fontSize, color, strokeColor}`（持久化 + 归一钳制）。`desktopLyricBridge.ts` 加 `pushDesktopLyricStyle`（独立 `desktop-lyric-style` event）。`DesktopLyric.tsx` 监听该 event，把样式写成 CSS 变量 `--dl-font-size/--dl-color/--dl-stroke`；`styles.css` 桌面歌词类改用这些变量（带 fallback）。Music.tsx 在样式变化 / 窗口 ready 时推送。MusicDrawer 加字号滑块 + 主色/描边色 color picker（仅桌面歌词开启时显示）。

<details><summary>原计划（保留备查）</summary>

**目标**：桌面歌词字号/颜色/描边色可调（现仅开关）。

**为什么**：当前 `desktopLyricBridge.ts` 桌面歌词只有开关，无样式项。Cyrene 有字号/颜色/描边。

**改动点**：
- `stores/music.ts`：新增 `desktopLyricStyle: { fontSize, color, strokeColor }`，加 persist。
- `desktopLyricBridge.ts`：推送样式给桌面歌词窗口（沿用现有「主窗口推整行 + 时间锚点」通道，加 style payload）。
- `src/pages/music/DesktopLyric.tsx`（桌面歌词路由组件）：消费 style 渲染。
- 设置 UI 加三个控件。

**验收**：在设置里改字号/颜色，桌面歌词窗口实时变化。
**工作量**：小。**风险**：低。

</details>

---

## 批 C — 锦上添花

### P2-1：歌词跨源融合 ✅ 已完成（繁简转换：暂缓，见下）

> 实现：`neteaseApi.ts` 导出 `fetchNeteaseLyric`，并新增 `fetchNeteaseLyricByMatch(source, title, artist)`——用网易源搜「歌名 歌手」，按归一化文本（去括号注释/标点/大小写）匹配同名同歌手的网易歌后取其逐字+翻译歌词。`Music.tsx` 在播放结果 `play.yrc` 为空且当前源不是网易源时，异步（不阻塞播放）调它补歌词，按 `playRequestRef` 防竞态，只填空缺字段（不覆盖原源已有歌词）。`extrasSource` 经 ref 路由进 `playSong`，不扩 useCallback 依赖。
>
> 效果：LX/聚合源常返回空歌词或纯 LRC 的歌，现在能自动从网易补上逐字歌词 + 翻译。这就是「多源融合」的核心价值（网易歌词库最全），比强接 QQ QRC 端点更省、覆盖更广。
>
> **繁简转换暂缓**：需引入 opencc 字典依赖（增包体）或维护简版映射表（质量差）。价值偏低、收益与成本不匹配，暂不做；若日后要做，加 `stores/music.ts` 的 `lyricConvert` 设置 + 解析后转换即可，不影响现有结构。

<details><summary>原计划（保留备查）</summary>

**目标**：网易歌词缺失/质量差时回退 QQ QRC；可选繁简转换。

**为什么**：当前歌词单源。SPlayer 三源融合（网易+QQ QRC+AMLL TTML DB）带时长校验 + 繁简/括号/脏词后处理。

**改动点**：
- `src/pages/music/lyric/` 新增 `fetchMultiSourceLyric`：主源失败/为空时按平台调备用源歌词端点（QQ QRC、cyrene 后端歌词），时长差 >5s 视为不匹配丢弃。
- 繁简转换：引入轻量 opencc-js 或简版映射表，`stores/music.ts` 加 `lyricConvert: 'off'|'s2t'|'t2s'` 设置。
- 解析层 `lyric/parse.ts` 已支持 QRC，无需大改。

**验收**：一首网易无歌词的歌，能自动从 QQ 取到逐字歌词显示。
**工作量**：中。**风险**：低。

</details>

---

### P2-2：封面取色就地改进 ✅ 已完成（不引依赖）

> 结论：诚实工程判断——**不引** `@material/material-color-utilities`。它能让取色「更准」但属纯视觉、主观、低价值改动；项目依赖很精简、build 已在警告 chunk 体积、且无测试运行器，为 cosmetic 功能加几十 KB 依赖不划算。
>
> 改为零依赖就地改进 `coverColor.ts`：色相桶从 30°（12 桶）细化到 15°（24 桶）；每桶分别累计 population（像素计数）与饱和度加权颜色；打分用「融合相邻桶后的 population × 饱和权重」（借鉴 Material Score 的「面积 × 鲜艳度」思路，但不引库），融合左右相邻桶避免主色被切在桶边界落选，同时代表色只取中心桶（不混邻桶，避免被拉灰）。修掉了原「取单个最高权重桶」在繁杂封面上易被小撮高饱和噪点带偏的弱点。`{accent, deep}` 输出契约不变，CRT 主题注入逻辑不动。

<details><summary>原计划（保留备查）</summary>

**目标**：取色更准、更接近主色调。

**为什么**：当前 `coverColor.ts` 用 HSL 分桶启发式。SPlayer 用 `@material/material-color-utilities` 的 QuantizerCelebi + Score 评分，结果更稳。

**改动点**：
- 评估引入 `@material/material-color-utilities`（体积约几十 KB）；或保留现有 HSL 方案仅调参。
- 若引入：`coverColor.ts` 改用 `QuantizerCelebi.quantize` + `Score.score` 取主色，再映射到现有 `{accent, deep}` 输出契约（**保持输出接口不变**，CSS 变量写入逻辑 Music.tsx 不动）。

**验收**：多张封面取色主观更贴合主视觉色。
**工作量**：小。**风险**：低。**注意**：保持 `{accent, deep}` 输出契约不变，否则牵连 CRT 主题变量注入。

</details>

---

### P2-3：音质档数细化 ✅ 已覆盖（无需改动）

> 结论：UI 已暴露 128k/320k/flac/flac24bit 四档（`constants.tsx` QUALITY_OPTIONS），覆盖了匿名音源能给到的全部有意义档位。SPlayer 的 9 档含杜比全景声/母带需登录态后端，匿名拿不到；`192k` 是中间档，加进 UI 价值不大。底层降级链 `flac24bit→flac→320k→192k→128k` 已在 `resolveMusicSourceWithFallback` 实现，选 flac24bit 不支持的源会自动降级。故视为已满足，不强凑档数。

<details><summary>原计划（保留备查）</summary>

**目标**：4 档 → 增加无损 flac / Hi-Res 细分（视音源支持）。

**为什么**：当前音质 4 档，SPlayer 9 档（含杜比/母带）。本项目音质已有降级链 `flac24bit→flac→320k→192k→128k`（`index.ts:resolveMusicSourceWithFallback`），底层其实支持更多档，只是 UI/设置暴露 4 档。

**改动点**：
- `stores/music.ts`：`quality` 选项扩展暴露 flac/flac24bit（受音源能力限制，洛雪 runtime 源可从脚本读支持音质）。
- 设置 UI（`MusicSourcesHub` 播放器 Tab + PlayerView 工具条 select）扩展选项。
- 无需动解析层（降级链已支持）。

**验收**：选 flac24bit，对支持的源能出无损链接，不支持的自动降级。
**工作量**：小。**风险**：低。

</details>

---

## 不在计划内（设计取向决定）

- **账号登录态**（真私人FM/云盘/签到/收藏云同步）：与项目「匿名优先」取向冲突，且属视频 App 子模块的范围外。
- **自建流媒体服务器协议**（Subsonic/Jellyfin/Emby）：SPlayer 独有，与本项目定位无关。
- **多 UI 设计系统 / 改 CRT 风格**：CRT/After Hours 是本项目独有辨识度，不改。

---

## 建议执行顺序

1. **批 A 先行**（P0-2 本地持久化先做——小、低风险、立竿见影；再 P0-1 洛雪沙箱）。
2. **批 B 按需**（P1-3 桌面歌词样式最易；P1-1 ReplayGain 次之；P1-2 crossfade 触碰核心假设，单独成 commit 谨慎做）。
3. **批 C 有空再做**。

每批独立成 commit；触碰 `audioGraph.ts` 单例假设的改动（P1-2）务必单独提交便于回退。改动后按 CLAUDE.md 用 `pnpm build`（tsc + vite）做唯一静态门禁。
