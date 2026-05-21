#!/usr/bin/env node
/**
 * 从 icon.svg 渲染所有 Tauri 需要的 PNG 尺寸。
 *
 * 用法：
 *   pnpm add -D sharp
 *   node src-tauri/icons/source/build.mjs
 *
 * ICO / ICNS 需要额外工具手动跑（一次性）：
 *   npx --yes png-to-ico src-tauri/icons/icon.png > src-tauri/icons/icon.ico
 *   npx --yes png2icons src-tauri/icons/icon.png src-tauri/icons/icon -allp
 *
 * 详见同目录 README.md。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "icon.svg");
const ICONS_DIR = join(__dirname, "..");
const IOS_DIR = join(ICONS_DIR, "ios");

// Tauri / Windows / macOS / Linux / Android / iOS 所需的尺寸映射。
const TARGETS = [
  // Linux / Tauri 内部
  { name: "32x32.png", size: 32 },
  { name: "64x64.png", size: 64 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
  { name: "icon.png", size: 512 },

  // Windows MSIX / Square Logos
  { name: "Square30x30Logo.png", size: 30 },
  { name: "Square44x44Logo.png", size: 44 },
  { name: "Square71x71Logo.png", size: 71 },
  { name: "Square89x89Logo.png", size: 89 },
  { name: "Square107x107Logo.png", size: 107 },
  { name: "Square142x142Logo.png", size: 142 },
  { name: "Square150x150Logo.png", size: 150 },
  { name: "Square284x284Logo.png", size: 284 },
  { name: "Square310x310Logo.png", size: 310 },
  { name: "StoreLogo.png", size: 50 },
];

// iOS Asset Catalog — `tauri ios init` 把这里的 PNG 拷到
// src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/ 并写 Contents.json。
// 命名沿用 tauri-cli / cargo-mobile2 约定：`AppIcon-{size}@{scale}x[-1].png`
// 其中 `-1` 后缀是 iPad variant（iPhone 和 iPad 实际像素相同但 idiom 不同时）。
const IOS_TARGETS = [
  { name: "AppIcon-20x20@1x.png", size: 20 },
  { name: "AppIcon-20x20@2x.png", size: 40 },
  { name: "AppIcon-20x20@2x-1.png", size: 40 },
  { name: "AppIcon-20x20@3x.png", size: 60 },
  { name: "AppIcon-29x29@1x.png", size: 29 },
  { name: "AppIcon-29x29@2x.png", size: 58 },
  { name: "AppIcon-29x29@2x-1.png", size: 58 },
  { name: "AppIcon-29x29@3x.png", size: 87 },
  { name: "AppIcon-40x40@1x.png", size: 40 },
  { name: "AppIcon-40x40@2x.png", size: 80 },
  { name: "AppIcon-40x40@2x-1.png", size: 80 },
  { name: "AppIcon-40x40@3x.png", size: 120 },
  { name: "AppIcon-60x60@2x.png", size: 120 },
  { name: "AppIcon-60x60@3x.png", size: 180 },
  { name: "AppIcon-76x76@2x.png", size: 152 },
  { name: "AppIcon-83.5x83.5@2x.png", size: 167 },
  { name: "AppIcon-512@2x.png", size: 1024 },
];

// Apple Asset Catalog Contents.json — 写到 src-tauri/icons/ios/Contents.json，
// tauri ios init 会原样拷到 Assets.xcassets/AppIcon.appiconset/ 里。
// 字段含义见 https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/AppIconType.html
const IOS_CONTENTS = {
  images: [
    { size: "20x20", idiom: "iphone", filename: "AppIcon-20x20@2x.png", scale: "2x" },
    { size: "20x20", idiom: "iphone", filename: "AppIcon-20x20@3x.png", scale: "3x" },
    { size: "29x29", idiom: "iphone", filename: "AppIcon-29x29@2x.png", scale: "2x" },
    { size: "29x29", idiom: "iphone", filename: "AppIcon-29x29@3x.png", scale: "3x" },
    { size: "40x40", idiom: "iphone", filename: "AppIcon-40x40@2x.png", scale: "2x" },
    { size: "40x40", idiom: "iphone", filename: "AppIcon-40x40@3x.png", scale: "3x" },
    { size: "60x60", idiom: "iphone", filename: "AppIcon-60x60@2x.png", scale: "2x" },
    { size: "60x60", idiom: "iphone", filename: "AppIcon-60x60@3x.png", scale: "3x" },
    { size: "20x20", idiom: "ipad", filename: "AppIcon-20x20@1x.png", scale: "1x" },
    { size: "20x20", idiom: "ipad", filename: "AppIcon-20x20@2x-1.png", scale: "2x" },
    { size: "29x29", idiom: "ipad", filename: "AppIcon-29x29@1x.png", scale: "1x" },
    { size: "29x29", idiom: "ipad", filename: "AppIcon-29x29@2x-1.png", scale: "2x" },
    { size: "40x40", idiom: "ipad", filename: "AppIcon-40x40@1x.png", scale: "1x" },
    { size: "40x40", idiom: "ipad", filename: "AppIcon-40x40@2x-1.png", scale: "2x" },
    { size: "76x76", idiom: "ipad", filename: "AppIcon-76x76@2x.png", scale: "2x" },
    { size: "83.5x83.5", idiom: "ipad", filename: "AppIcon-83.5x83.5@2x.png", scale: "2x" },
    { size: "512x512", idiom: "ios-marketing", filename: "AppIcon-512@2x.png", scale: "2x" },
  ],
  info: { version: 1, author: "xcode" },
};

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error(
      "[icon-build] sharp 未安装。请先运行：\n  pnpm add -D sharp\n"
    );
    process.exit(1);
  }

  const svg = await readFile(SRC);
  await mkdir(ICONS_DIR, { recursive: true });
  await mkdir(IOS_DIR, { recursive: true });

  const render = (size) =>
    sharp(svg, { density: 384 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

  for (const { name, size } of TARGETS) {
    await writeFile(join(ICONS_DIR, name), await render(size));
    console.log(`  ✓ ${name} (${size}×${size})`);
  }

  console.log("\n[icon-build] iOS AppIcon.appiconset：");
  for (const { name, size } of IOS_TARGETS) {
    await writeFile(join(IOS_DIR, name), await render(size));
    console.log(`  ✓ ios/${name} (${size}×${size})`);
  }
  await writeFile(
    join(IOS_DIR, "Contents.json"),
    JSON.stringify(IOS_CONTENTS, null, 2) + "\n"
  );
  console.log("  ✓ ios/Contents.json");

  console.log("\n[icon-build] 完成。下一步（一次性）：");
  console.log("  npx --yes png-to-ico src-tauri/icons/icon.png > src-tauri/icons/icon.ico");
  console.log("  npx --yes png2icons src-tauri/icons/icon.png src-tauri/icons/icon -allp");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
