// 二进制 blob 缓存 —— EPUB 文件 / TTS 音频块共用。
//
// MoonTVPlus 用 book-cache.client / book-tts-cache.client(IndexedDB, LRU)。DouyTV 沿用
// IndexedDB(WebView 标准、跨平台、天生适合大 blob;SQLite 存二进制不划算)。两个 store:
//   - "files"    :EPUB/PDF 原始文件,键 = cacheKey(sourceId::bookId::format)
//   - "ttsChunks":TTS 合成音频块,键 = sourceId|bookId|href|chunk|voice|rate|pitch|volume 的 hash
// 每个 store 带 LRU 上限,超限按 lastAccess 淘汰最旧的。

const DB_NAME = "douytv-book-cache";
const DB_VERSION = 1;
const FILE_STORE = "files";
const TTS_STORE = "ttsChunks";

/** 文件缓存上限(条数)。EPUB 单本可能几十 MB,条数保守。 */
const FILE_LIMIT = 40;
/** TTS 音频块上限(条数)。单块 ~1200 字 ≈ 数百 KB。 */
const TTS_LIMIT = 400;

export interface CachedFile {
  key: string;
  sourceId: string;
  bookId: string;
  title: string;
  format: "epub" | "pdf";
  blob: Blob;
  size: number;
  mimeType: string;
  updatedAt: number;
  lastAccess: number;
}

export interface CachedTtsChunk {
  key: string;
  sourceId: string;
  bookId: string;
  blob: Blob;
  mimeType: string;
  updatedAt: number;
  lastAccess: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        const store = db.createObjectStore(FILE_STORE, { keyPath: "key" });
        store.createIndex("lastAccess", "lastAccess");
      }
      if (!db.objectStoreNames.contains(TTS_STORE)) {
        const store = db.createObjectStore(TTS_STORE, { keyPath: "key" });
        store.createIndex("lastAccess", "lastAccess");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn("[blobCache] open failed", req.error);
      resolve(null);
    };
  });
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const t = db.transaction(storeName, mode);
          const req = run(t.objectStore(storeName));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) {
          console.warn("[blobCache] tx failed", e);
          resolve(null);
        }
      })
  );
}

/** 淘汰超过 limit 的最旧条目(按 lastAccess 升序删)。 */
async function enforceLimit(storeName: string, limit: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(storeName, "readwrite");
      const store = t.objectStore(storeName);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - limit;
        if (excess <= 0) {
          resolve();
          return;
        }
        let removed = 0;
        const cursorReq = store.index("lastAccess").openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || removed >= excess) {
            resolve();
            return;
          }
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
        cursorReq.onerror = () => resolve();
      };
      countReq.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ── 文件缓存 ──────────────────────────────────────────
export async function getCachedFile(key: string): Promise<CachedFile | null> {
  const file = await tx<CachedFile>(FILE_STORE, "readonly", (s) => s.get(key));
  if (file) {
    // 更新 lastAccess(不阻塞返回)
    void tx(FILE_STORE, "readwrite", (s) =>
      s.put({ ...file, lastAccess: Date.now() })
    );
  }
  return file;
}

export async function putCachedFile(
  file: Omit<CachedFile, "lastAccess">
): Promise<void> {
  await tx(FILE_STORE, "readwrite", (s) =>
    s.put({ ...file, lastAccess: Date.now() })
  );
  await enforceLimit(FILE_STORE, FILE_LIMIT);
}

export async function listCachedFiles(): Promise<CachedFile[]> {
  const all = await tx<CachedFile[]>(FILE_STORE, "readonly", (s) => s.getAll());
  return (all || []).sort((a, b) => b.lastAccess - a.lastAccess);
}

export async function deleteCachedFile(key: string): Promise<void> {
  await tx(FILE_STORE, "readwrite", (s) => s.delete(key));
}

export async function clearCachedFiles(): Promise<void> {
  await tx(FILE_STORE, "readwrite", (s) => s.clear());
}

// ── TTS 音频块缓存 ────────────────────────────────────
export async function getCachedTtsChunk(
  key: string
): Promise<CachedTtsChunk | null> {
  const chunk = await tx<CachedTtsChunk>(TTS_STORE, "readonly", (s) =>
    s.get(key)
  );
  if (chunk) {
    void tx(TTS_STORE, "readwrite", (s) =>
      s.put({ ...chunk, lastAccess: Date.now() })
    );
  }
  return chunk;
}

export async function putCachedTtsChunk(
  chunk: Omit<CachedTtsChunk, "lastAccess">
): Promise<void> {
  await tx(TTS_STORE, "readwrite", (s) =>
    s.put({ ...chunk, lastAccess: Date.now() })
  );
  await enforceLimit(TTS_STORE, TTS_LIMIT);
}

/** 稳定的 TTS 缓存键(输入相同 → 命中同一块)。 */
export function buildTtsChunkKey(input: {
  sourceId: string;
  bookId: string;
  chapterHref: string;
  text: string;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
}): string {
  const raw = [
    input.sourceId,
    input.bookId,
    input.chapterHref,
    input.voice,
    input.rate,
    input.pitch,
    input.volume,
    input.text,
  ].join("|");
  // 32-bit hash + 长度,足够避免碰撞
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return `${input.sourceId}:${input.bookId}:${h.toString(36)}:${raw.length}`;
}
