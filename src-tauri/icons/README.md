# DouyTV 应用图标 — 设计与构建

应用图标基于 CRT 复古电视美学：圆角电视外壳 + 渐变橙红屏幕 + 米黄色「Y」字母 + 扫描线 overlay + V 形天线。色调与 UI 配色完全一致（`--ember` 主屏幕、`--cream` 字母、`--phosphor` 旋钮 LED）。

## 文件

- `source/icon.svg` — 1024×1024 矢量源文件（唯一手维护的资产）
- `source/build.mjs` — Node 脚本，用 `sharp` 渲染所有 PNG 尺寸
- 其它 `*.png` / `*.ico` / `*.icns` — 由脚本生成，不要直接编辑

## 重新生成（修改 icon.svg 后）

```bash
# 一次性安装依赖
pnpm add -D sharp

# 渲染所有 PNG
node src-tauri/icons/source/build.mjs

# 生成 Windows ICO（需要 png-to-ico，10MB 一次性下载）
npx --yes png-to-ico src-tauri/icons/icon.png > src-tauri/icons/icon.ico

# 生成 macOS ICNS（需要 png2icons）
npx --yes png2icons src-tauri/icons/icon.png src-tauri/icons/icon -allp
```

iOS 子目录 `ios/` 的全套 AppIcon（18 个尺寸 + `Contents.json`）已由 `build.mjs` 一并生成。CI 跑 `tauri ios init` 时会把这些拷到 `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/`。如果换了 `icon.svg`，重跑 `node src-tauri/icons/source/build.mjs` 即可全量刷新（含 iOS）。

## 设计 token

- 屏幕主色：`#FF6B35`（`--ember`）
- 字母 Y：`#F2E8D5`（`--cream`）
- 外壳：`#0E0F11` → `#2A2F3A`（`--ink` → `--ink-edge`）
- LED 旋钮：`#7CFFB2`（`--phosphor`）
- REC 红点：`#FF3B30`

修改 SVG 时保持这些色值与 `src/styles.css` 同步。
