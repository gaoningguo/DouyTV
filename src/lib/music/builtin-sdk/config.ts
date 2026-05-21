/**
 * 内置 SDK 共用配置访问器 —— 从 useMusicStore 读取当前 builtin backend 的 urlServers 配置，
 * 给 wy/kw/tx/kg/mg 的 musicUrl.ts 用。
 *
 * 设计：找 store 里第一个 kind === 'builtin' 的 backend；若其 urlServers[source] 为空 / 未设，
 * 回落到 BUILTIN_DEFAULT_URL_SERVERS。整个流程不依赖 active backend，让 fallback 链上的
 * builtin parse 也能拿到用户配置（参考 api.ts parseSong 的多 backend 尝试逻辑）。
 */
import { useMusicStore } from "@/stores/music";
import {
  BUILTIN_DEFAULT_URL_SERVERS,
  type BuiltinBackend,
} from "../backends/types";

export function getBuiltinUrlServer(source: "wy" | "kw" | "tx" | "kg" | "mg"): string {
  try {
    const s = useMusicStore.getState();
    const b = s.backends.find((x) => x.kind === "builtin") as
      | BuiltinBackend
      | undefined;
    const fromCfg = b?.urlServers?.[source];
    if (fromCfg && fromCfg.trim()) return fromCfg.replace(/\/+$/, "");
  } catch {
    /* 兜底走默认 */
  }
  return BUILTIN_DEFAULT_URL_SERVERS[source];
}
