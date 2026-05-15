import type { ScriptLog } from "./types";

export function createLog(scriptKey: string): ScriptLog {
  const tag = `[script:${scriptKey}]`;
  return {
    info: (...args) => console.log(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
}
