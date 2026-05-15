import { scriptFetch } from "./fetch";
import { loadHtml } from "./html";
import { createCache } from "./cache";
import { createLog } from "./log";
import { utils } from "./utils";
import type { ScriptContext, ScriptFetchInit } from "./types";

interface CreateContextOpts {
  scriptKey: string;
  sourceId?: string;
  config?: Record<string, unknown>;
}

export function createContext(opts: CreateContextOpts): ScriptContext {
  const config = opts.config ?? {};
  return {
    fetch: scriptFetch,
    request: {
      get: (url, init) => scriptFetch(url, { ...init, method: "GET" }),
      getJson: async <T = unknown>(url: string, init?: ScriptFetchInit) => {
        const res = await scriptFetch(url, { ...init, method: "GET" });
        return res.json<T>();
      },
      getHtml: async (url, init) => {
        const res = await scriptFetch(url, { ...init, method: "GET" });
        return res.text();
      },
      post: (url, init) => scriptFetch(url, { ...init, method: "POST" }),
    },
    html: { load: loadHtml },
    cache: createCache(opts.scriptKey),
    log: createLog(opts.scriptKey),
    utils,
    config: {
      get: (key) => config[key],
      require: (key) => {
        if (!(key in config)) {
          throw new Error(
            `script "${opts.scriptKey}" requires config key "${key}" but it was not provided`
          );
        }
        return config[key];
      },
      all: () => ({ ...config }),
    },
    runtime: { scriptKey: opts.scriptKey, sourceId: opts.sourceId },
  };
}
