import { useCallback, useState } from "react";
import { useScriptStore } from "@/stores/scripts";
import { callSearch } from "@/source-script/runtime";
import type { ScriptVodItem } from "@/source-script/types";

export interface SearchResult {
  scriptKey: string;
  scriptName: string;
  vod: ScriptVodItem;
}

const HISTORY_KEY = "douytv:search-history";
const HISTORY_LIMIT = 12;
const CACHE_PREFIX = "douytv:search-cache:";

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {}
}

/** sessionStorage 缓存 —— 同关键词来回切页保留结果，重启 Tauri 自动清。 */
function loadCache(kw: string): SearchResult[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + kw);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveCache(kw: string, results: SearchResult[]) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + kw, JSON.stringify(results));
  } catch {
    /* quota / private */
  }
}

export function useSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [totalScripts, setTotalScripts] = useState(0);
  const [completedScripts, setCompletedScripts] = useState(0);
  const [fromCache, setFromCache] = useState(false);

  /**
   * 搜索 —— 流式追加：每个 script 返回就立即 setResults，让用户秒看到结果。
   * 之前用 Promise.all 等齐，慢源会拖整体几秒。
   *
   * @param force 强制忽略 sessionStorage 缓存（刷新按钮调用）
   */
  const search = useCallback(
    async (kw: string, p: number = 1, opts?: { force?: boolean }) => {
      const force = !!opts?.force;
      setKeyword(kw);
      setPage(p);
      setError(undefined);
      if (!kw.trim()) {
        setResults([]);
        setTotalScripts(0);
        setCompletedScripts(0);
        setFromCache(false);
        return;
      }

      // 缓存命中（仅 page=1）
      if (p === 1 && !force) {
        const cached = loadCache(kw);
        if (cached && cached.length > 0) {
          setResults(cached);
          setFromCache(true);
          setLoading(false);
          // 历史也要记
          setHistory((prev) => {
            const next = [kw, ...prev.filter((x) => x !== kw)].slice(0, HISTORY_LIMIT);
            saveHistory(next);
            return next;
          });
          return;
        }
      }
      setFromCache(false);

      if (p === 1) {
        setHistory((prev) => {
          const next = [kw, ...prev.filter((x) => x !== kw)].slice(0, HISTORY_LIMIT);
          saveHistory(next);
          return next;
        });
      }
      const enabled = useScriptStore.getState().scripts.filter((s) => s.enabled);
      setTotalScripts(enabled.length);
      setCompletedScripts(0);
      if (enabled.length === 0) {
        setResults([]);
        return;
      }
      setLoading(true);
      // 累积器：每个 script 完成 push 进来；全部完成后写入 cache
      const accumulated: SearchResult[] = [];
      if (p === 1) setResults([]);
      await Promise.all(
        enabled.map(async (script) => {
          try {
            const r = await callSearch(script, { keyword: kw, page: p });
            const newRows = r.list.map((vod) => ({
              scriptKey: script.key,
              scriptName: script.name,
              vod,
            }));
            accumulated.push(...newRows);
            // 立即追加，让用户秒看到这批；其它源继续跑
            setResults((prev) => (p === 1 ? [...prev, ...newRows] : [...prev, ...newRows]));
          } catch (e) {
            console.warn(`[useSearch] ${script.key} failed`, e);
          } finally {
            setCompletedScripts((c) => c + 1);
          }
        })
      );
      setLoading(false);
      // page 1 才写 cache；分页结果不缓存以免错乱
      if (p === 1) saveCache(kw, accumulated);
    },
    []
  );

  const removeHistory = useCallback((kw: string) => {
    setHistory((prev) => {
      const next = prev.filter((x) => x !== kw);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  return {
    results,
    loading,
    error,
    page,
    keyword,
    search,
    history,
    removeHistory,
    clearHistory,
    totalScripts,
    completedScripts,
    fromCache,
  };
}
