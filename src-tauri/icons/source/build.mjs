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

  for (const { name, size } of TARGETS) {
    const out = join(ICONS_DIR, name);
    const buf = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(out, buf);
    console.log(`  ✓ ${name} (${size}×${size})`);
  }

  console.log("\n[icon-build] 完成。下一步（一次性）：");
  console.log("  npx --yes png-to-ico src-tauri/icons/icon.png > src-tauri/icons/icon.ico");
  console.log("  npx --yes png2icons src-tauri/icons/icon.png src-tauri/icons/icon -allp");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
