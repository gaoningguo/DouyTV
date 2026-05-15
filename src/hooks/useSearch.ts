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

export function useSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadHistory());

  const search = useCallback(async (kw: string, p: number = 1) => {
    setKeyword(kw);
    setPage(p);
    if (!kw.trim()) {
      setResults([]);
      return;
    }
    if (p === 1) {
      setHistory((prev) => {
        const next = [kw, ...prev.filter((x) => x !== kw)].slice(
          0,
          HISTORY_LIMIT
        );
        saveHistory(next);
        return next;
      });
    }
    const enabled = useScriptStore
      .getState()
      .scripts.filter((s) => s.enabled);
    if (enabled.length === 0) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const grouped = await Promise.all(
        enabled.map(async (script) => {
          try {
            const r = await callSearch(script, { keyword: kw, page: p });
            return r.list.map((vod) => ({
              scriptKey: script.key,
              scriptName: script.name,
              vod,
            }));
          } catch (e) {
            console.warn(`[useSearch] ${script.key} failed`, e);
            return [];
          }
        })
      );
      setResults(grouped.flat());
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

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
  };
}
