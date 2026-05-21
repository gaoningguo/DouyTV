/**
 * MoonTV 兼容的配置文件 / 订阅 + TVBox JSON 兼容。
 *
 * MoonTV ConfigFile（Object 风格）：
 * ```
 * {
 *   "api_site": { "key1": { "name": "...", "api": "...", "detail": "..." }, ... },
 *   "lives":    { "key1": { "name": "...", "url": "M3U订阅URL", "ua": "...", "epg": "..." }, ... },
 *   "custom_category": [{ "name": "...", "type": "movie"|"tv", "query": "..." }]
 * }
 * ```
 *
 * TVBox（Array 风格 — FongMi / CatVod / OK 系）：
 * ```
 * {
 *   "sites": [{ "key": "...", "name": "...", "type": 0|1|3|4, "api": "...", "ext": "...", "jar": "..." }, ...],
 *   "lives": [{ "name": "...", "type": 0, "url": "...m3u", "epg": "..." }, ...],
 *   "parses": [...], "flags": [...], "spider": "...", "wallpaper": "..."
 * }
 * ```
 *
 * api_site / TVBox sites[type=0|4] 都注册为 CMS 源（type='cms'）。
 * type 1（drpy + jar）和 type 3（csp_* + jar）需要 JVM 抓取器，本端跳过 + 在 result.ignoredJarSites 计数。
 * lives 两种形态都拉 M3U 并批量导入直播频道。
 */
import { scriptFetch } from "@/source-script/fetch";
import bs58 from "bs58";
import { useScriptStore } from "@/stores/scripts";
import { useLiveStore } from "@/stores/live";
import type { ScriptDescriptor } from "@/source-script/types";

export interface ConfigFile {
  cache_time?: number;
  // ── MoonTV 风格（对象）──────────────────────────────
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
  lives?:
    | Record<
        string,
        {
          name: string;
          url: string;
          ua?: string;
          epg?: string;
        }
      >
    // TVBox 风格 lives 是数组形态 — `isConfigFile` 和 `applyConfigFile` 都需兼容
    | Array<{
        name: string;
        type?: number;
        url: string;
        ua?: string;
        epg?: string;
      }>;
  custom_category?: Array<{
    name?: string;
    type: "movie" | "tv";
    query: string;
  }>;
  // ── TVBox 风格 ──────────────────────────────────────
  sites?: Array<{
    key?: string;
    name?: string;
    /** 0 = JSON 苹果CMS；1 = drpy + jar；3 = csp_* + jar；4 = special json */
    type?: number;
    api?: string;
    ext?: string | Record<string, unknown>;
    jar?: string;
    searchable?: number;
    quickSearch?: number;
    filterable?: number;
    hide?: number;
    ua?: string;
    referer?: string;
    /** 详情页面 API URL（部分 CMS 兼容） */
    detail?: string;
  }>;
  parses?: Array<{ name?: string; type?: number; url?: string; ext?: unknown }>;
  flags?: string[];
  spider?: string;
  wallpaper?: string;
}

export interface ApplyResult {
  sourcesAdded: number;
  livesAdded: number;
  liveErrors: string[];
  /** TVBox 中跳过的需 JVM 抓取的源数量（type 1/3） */
  ignoredJarSites: number;
}

const CFG_PREFIX = "cfg-";

export function isConfigFile(x: unknown): x is ConfigFile {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    "api_site" in o ||
    "lives" in o ||
    "custom_category" in o ||
    "cache_time" in o ||
    // TVBox 标志位
    "sites" in o ||
    "parses" in o ||
    "flags" in o ||
    "spider" in o
  );
}

/** 应用配置文件：注册 CMS 源 + 拉取直播 M3U */
export async function applyConfigFile(cfg: ConfigFile): Promise<ApplyResult> {
  const scriptStore = useScriptStore.getState();
  const liveStore = useLiveStore.getState();
  let sourcesAdded = 0;
  let livesAdded = 0;
  let ignoredJarSites = 0;
  const liveErrors: string[] = [];

  // 1a. MoonTV 视频源 (api_site → CMS 源)
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

  // 1b. TVBox 视频源 (sites[] → CMS 源；只接 type 0 / 4 等纯 JSON 接口)
  if (Array.isArray(cfg.sites)) {
    for (let i = 0; i < cfg.sites.length; i++) {
      const site = cfg.sites[i];
      if (!site || site.hide === 1) continue;
      const name = site.name?.trim();
      const api = site.api?.trim();
      if (!name || !api) continue;
      const type = typeof site.type === "number" ? site.type : 0;
      // type 1 (drpy + jar) / type 3 (csp_* + jar) 需要 JVM，跳过
      if (type === 1 || type === 3) {
        ignoredJarSites++;
        continue;
      }
      // type 0 = 苹果 CMS V10 JSON，type 4 = 拓展 JSON（结构同 0），其它未知类型也尝试当 CMS
      const key = site.key?.trim() || `tvb_${i}`;
      const desc: ScriptDescriptor = {
        key: `${CFG_PREFIX}${key}`,
        name,
        type: "cms",
        api,
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

    // 两种形态都归一成 { name, url, ua, epg } 列表
    const liveList: Array<{ name: string; url: string; ua?: string; epg?: string }> = [];
    if (Array.isArray(cfg.lives)) {
      for (const live of cfg.lives) {
        if (!live || !live.url) continue;
        // TVBox 偶有 type !== 0 的实验性条目，目前只消费 type 0 / 缺省（M3U 直链）
        if (typeof live.type === "number" && live.type !== 0) continue;
        liveList.push({
          name: live.name || "直播订阅",
          url: live.url,
          ua: live.ua,
          epg: live.epg,
        });
      }
    } else {
      for (const live of Object.values(cfg.lives)) {
        liveList.push({
          name: live.name,
          url: live.url,
          ua: live.ua,
          epg: live.epg,
        });
      }
    }

    for (const live of liveList) {
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

  return { sourcesAdded, livesAdded, liveErrors, ignoredJarSites };
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
