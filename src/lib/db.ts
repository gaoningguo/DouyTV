import Database from "@tauri-apps/plugin-sql";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const DB_URI = "sqlite:douytv.db";

let dbPromise: Promise<Database> | undefined;

/**
 * 是否可用 Tauri SQLite。
 * 浏览器 dev 环境返回 false，调用方应 fallback 到 localStorage。
 */
export function isSqlAvailable(): boolean {
  return isTauri;
}

export async function getDb(): Promise<Database> {
  if (!isTauri) {
    throw new Error("SQLite unavailable: not running in Tauri");
  }
  if (!dbPromise) {
    dbPromise = Database.load(DB_URI);
  }
  return dbPromise;
}
