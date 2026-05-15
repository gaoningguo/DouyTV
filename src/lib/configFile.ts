/**
 * MoonTV 兼容的配置文件 / 订阅。
 *
 * 配置文件 JSON 结构（与 MoonTV 的 ConfigFile 完全兼容）：
 * ```
 * {
 *   "api_site": {
 *     "key1": { "name": "源1", "api": "https://...", "detail": "..." },
 *     ...
 *   },
 *   "lives": {
 *     "key1": { "name": "...", "url": "M3U订阅URL", "ua": "...", "epg": "..." }
 *   },
 *   "custom_category": [{ "name": "...", "type": "movie"|"tv", "query": "..." }]
 * }
 * ```
 *
 * api_site 中每个 entry 会注册为一个 CMS 源（type='cms'）。
 * lives 中每个 entry 的 url 视为 M3U 订阅，拉取后批量解析为直播频道。
 */
import { scriptFetch } from "@/source-script/fetch";
import bs58 from "bs58";
import { useScriptStore } from "@/stores/scripts";
import { useLiveStore } from "@/stores/live";
import type { ScriptDescriptor } from "@/source-script/types";

export interface ConfigFile {
  cache_time?: number;
  api_site?: Record<
    string,
    {
      name: string;
      api: string;
      detail?: string;
      ua?: string;
      referer?: string;
    }
  >;
  lives?: Record<
    string,
    {
      name: string;
      url: string;
      ua?: string;
      epg?: string;
    }
  >;
  custom_category?: Array<{
    name?: string;
    type: "movie" | "tv";
    query: string;
  }>;
}

export interface ApplyResult {
  sourcesAdded: number;
  livesAdded: number;
  liveErrors: string[];
}

const CFG_PREFIX = "cfg-";

export function isConfigFile(x: unknown): x is ConfigFile {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    "api_site" in o ||
    "lives" in o ||
    "custom_category" in o ||
    "cache_time" in o
  );
}

/** 应用配置文件：注册 CMS 源 + 拉取直播 M3U */
export async function applyConfigFile(cfg: ConfigFile): Promise<ApplyResult> {
  const scriptStore = useScriptStore.getState();
  const liveStore = useLiveStore.getState();
  let sourcesAdded = 0;
  let livesAdded = 0;
  const liveErrors: string[] = [];

  // 1. 视频源 (api_site → CMS 源)
  if (cfg.api_site) {
    for (const [key, site] of Object.entries(cfg.api_site)) {
      const desc: ScriptDescriptor = {
        key: `${CFG_PREFIX}${key}`,
        name: site.name,
        type: "cms",
        api: site.api,
        detail: site.detail,
        ua: site.ua,
        referer: site.referer,
        enabled: true,
      };
      scriptStore.install(desc);
      sourcesAdded++;
    }
  }

  // 2. 直播源 (lives → 拉 M3U 并批量导入)
  if (cfg.lives) {
    // 先清除之前同类别的频道（避免订阅刷新时累积）
    const liveCategory = "订阅";
    liveStore.removeByCategory(liveCategory);

    for (const [, live] of Object.entries(cfg.lives)) {
      try {
        const res = await scriptFetch(live.url, { timeout: 30_000 });
        if (!res.ok) {
          liveErrors.push(`${live.name}: HTTP ${res.status}`);
          continue;
        }
        const text = await res.text();
        const count = liveStore.importM3U(text, {
          defaultUa: live.ua,
          defaultCategory: live.name || liveCategory,
        });
        livesAdded += count;
      } catch (e) {
        liveErrors.push(`${live.name}: ${(e as Error).message}`);
      }
    }
  }

  return { sourcesAdded, livesAdded, liveErrors };
}

// Base58 字符表（Bitcoin 风格）：去掉了 0 / O / I / l 这 4 个易混字符。
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * 一些远程订阅源（如 LunaTV-config 的 jin18.txt、pz.v88 等）会把 JSON 用
 * base58 编码后再发送。MoonTV 后端通过 bs58.decode 处理，本前端仿照同一逻辑。
 *
 * 优先尝试纯 JSON；若首字符不是 `{`/`[` 且整体匹配 base58 字符表，则尝试 base58 解码。
 */
export function parseConfigFile(text: string): ConfigFile {
  const trimmed = text.trim();

  // 1) 直接 JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (!isConfigFile(parsed)) {
      throw new Error("无效的配置文件格式：缺少 api_site / lives 字段");
    }
    return parsed;
  } catch (jsonErr) {
    // 2) 尝试 base58 解码
    if (BASE58_RE.test(trimmed)) {
      try {
        const bytes = bs58.decode(trimmed);
        const decoded = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(decoded);
        if (!isConfigFile(parsed)) {
          throw new Error("base58 解码后的内容缺少 api_site / lives 字段");
        }
        return parsed;
      } catch (b58Err) {
        throw new Error(
          `订阅内容既不是合法 JSON 也无法 base58 解码：${(b58Err as Error).message}`
        );
      }
    }
    throw new Error(
      `订阅内容不是合法 JSON：${(jsonErr as Error).message}`
    );
  }
}
