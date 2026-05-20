import Database from "@tauri-apps/plugin-sql";

const DB_URI = "sqlite:douytv.db";

let dbPromise: Promise<Database> | undefined;

/**
 * 是否可用 Tauri SQLite。
 *
 * 注意：必须实时读 `window.__TAURI_INTERNALS__`，**不能**在模块加载时缓存。
 * Tauri v2 的 internals 是 webview 启动后异步注入的，模块顶级求值可能
 * 跑在 internals 就绪之前 —— 一旦缓存为 false，整个会话都走 localStorage，
 * 重启后收藏 / 历史就会丢失（v2 dev/prod 路径下 localStorage 有可能被清）。
 */
export function isSqlAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getDb(): Promise<Database> {
  if (!isSqlAvailable()) {
    throw new Error("SQLite unavailable: not running in Tauri");
  }
  if (!dbPromise) {
    dbPromise = Database.load(DB_URI);
  }
  return dbPromise;
}
