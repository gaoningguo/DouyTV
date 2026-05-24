/**
 * Stripchat Mouflon 解扰密钥管理。
 *
 * Stripchat 自 2025-08 起把直播 variant playlist 里的分片 URI 加扰
 * (#EXT-X-MOUFLON:URI:),需要 `pkey:pdkey` 密钥对才能还原:
 *   - pkey 决定 master 里 6 行 `PSCH:v2:…` 用哪个变体
 *   - pdkey 是 XOR 解扰用的对称密钥
 *
 * 没有 key 也能进入房间,但直播画面会一直黑屏(分片解扰失败)
 * 或显示 stripchat 的广告 VOD。
 *
 * 密钥由用户从开源社区(streamlink scp-plugin / Kodi sc19 / 相关 TG 群)
 * 自行获取,本机不分发。
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsSubPageLayout } from "./Layout";

const STORAGE_KEY = "douytv:stripchat-mouflon-keys";
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface MouflonKeyPair {
  pkey: string;
  pdkey: string;
}

export function loadKeysFromStorage(): MouflonKeyPair[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x): MouflonKeyPair | null =>
        x && typeof x.pkey === "string" && typeof x.pdkey === "string"
          ? { pkey: x.pkey.trim(), pdkey: x.pdkey.trim() }
          : null
      )
      .filter((x): x is MouflonKeyPair => !!x && !!x.pkey && !!x.pdkey);
  } catch {
    return [];
  }
}

export async function syncKeysToRust(keys: MouflonKeyPair[]): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke<number>("set_mouflon_keys", { pairs: keys });
  } catch (e) {
    console.warn("[stripchat-keys] set_mouflon_keys failed:", e);
  }
}

function stripWrappers(s: string): string {
  // 用户可能从 JSON 字典 / Python dict / 论坛代码块复制,值会带 `"..."` `'...'`
  // 或末尾 `,`。剥到只剩裸字符串再校验。
  let out = s.trim();
  // 剥尾部逗号
  out = out.replace(/,+$/, "").trim();
  // 同时剥两端的同型引号(只剥一对,允许 key 自身末尾有引号的边缘情况不动)
  if (
    out.length >= 2 &&
    ((out.startsWith('"') && out.endsWith('"')) ||
      (out.startsWith("'") && out.endsWith("'")))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

function parseKeysText(text: string): MouflonKeyPair[] {
  const out: MouflonKeyPair[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    // 跳过纯 JSON 对象大括号行,避免 `{` `}` 行被当成"无 `:`"误判
    if (line === "{" || line === "}") continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const pkey = stripWrappers(line.slice(0, idx));
    const pdkey = stripWrappers(line.slice(idx + 1));
    if (!pkey || !pdkey || seen.has(pkey)) continue;
    seen.add(pkey);
    out.push({ pkey, pdkey });
  }
  return out;
}

function serializeKeys(keys: MouflonKeyPair[]): string {
  return keys.map((k) => `${k.pkey}:${k.pdkey}`).join("\n");
}

export default function SettingsStripchatKeys() {
  const [text, setText] = useState<string>("");
  const [keys, setKeys] = useState<MouflonKeyPair[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const loaded = loadKeysFromStorage();
    setKeys(loaded);
    setText(serializeKeys(loaded));
  }, []);

  const save = async () => {
    const parsed = parseKeysText(text);
    setKeys(parsed);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      /* private mode */
    }
    await syncKeysToRust(parsed);
    setSavedAt(Date.now());
    // 让"已保存"标签 3 秒后消失
    setTimeout(() => setSavedAt(null), 3000);
  };

  const clear = async () => {
    setText("");
    setKeys([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    await syncKeysToRust([]);
  };

  return (
    <SettingsSubPageLayout
      eyebrow="STRIPCHAT · MOUFLON KEYS"
      title="Stripchat 解扰密钥"
    >
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        Stripchat 直播 m3u8 分片用 Mouflon 算法加扰,需要 <code className="text-ember">pkey:pdkey</code>{" "}
        密钥对才能还原。<strong className="text-cream-dim">不填也能进房间,但画面会一直黑屏 / 显示广告</strong>。
        密钥从开源社区(streamlink <code>scp-plugin</code> / Kodi <code>sc19</code> / 相关 Telegram 群)自行获取,本应用不分发。
        密钥会轮换,如果某天忽然失效,需要重新获取最新的对。
      </p>

      <section
        className="rounded-xl p-4 space-y-3"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <div>
          <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
            密钥列表(每行一对,格式 PKEY:PDKEY,# 开头为注释)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"# 示例(非真实可用 key):\n1Dzcc6OjP73LKbtI:abcdefghijklmnop\nFq6m2TO2ZeBkRPm9:0123456789abcdef"}
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg text-xs outline-none text-cream placeholder:text-cream-faint font-mono"
            style={{
              background: "var(--ink-3)",
              border: "1px solid var(--cream-line)",
              minHeight: 160,
              resize: "vertical",
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            className="flex-1 py-2.5 rounded-lg text-xs font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            保存并同步
          </button>
          <button
            type="button"
            onClick={clear}
            className="px-4 py-2.5 rounded-lg text-xs font-display font-semibold tap"
            style={{
              background: "var(--ink-3)",
              color: "var(--cream-dim)",
              border: "1px solid var(--cream-line)",
            }}
          >
            清空
          </button>
        </div>

        {savedAt && (
          <p className="text-[10px] text-phosphor font-mono">
            ✓ 已保存 {keys.length} 对密钥(已同步到后端解扰器)
          </p>
        )}

        <div
          className="rounded-lg p-3 text-[10px] text-cream-faint leading-relaxed"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <strong className="text-cream-dim">当前生效:</strong> {keys.length} 对密钥
          <br />
          <strong className="text-cream-dim">工作原理:</strong> Stripchat master playlist 顶部有
          6 行候选 <code>pkey</code>,后端会从你的列表里挑第一个匹配的,用对应 <code>pdkey</code>{" "}
          解扰分片名。pkey 任意一个加进 URL 就能让 CDN 不发广告,但解扰必须 pkey 和 pdkey 配对。
          <br />
          <strong className="text-cream-dim">不持久化到 Rust:</strong> 密钥只存浏览器
          localStorage,应用启动时会自动同步到后端解扰器。
        </div>
      </section>
    </SettingsSubPageLayout>
  );
}
