import { useEffect, useState } from "react";
import { useScriptStore } from "@/stores/scripts";
import { callDetail } from "@/source-script/runtime";
import type {
  ScriptDescriptor,
  ScriptDetailResult,
} from "@/source-script/types";

export function useDetail(scriptKey: string, vodId: string) {
  const [detail, setDetail] = useState<ScriptDetailResult | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const scripts = useScriptStore((s) => s.scripts);
  const hydrated = useScriptStore((s) => s.hydrated);
  const hydrate = useScriptStore((s) => s.hydrate);

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  const script: ScriptDescriptor | undefined = scripts.find(
    (s) => s.key === scriptKey
  );

  useEffect(() => {
    if (!script || !vodId) return;
    let aborted = false;
    setLoading(true);
    setError(undefined);
    callDetail(script, { id: vodId })
      .then((d) => {
        if (!aborted) setDetail(d);
      })
      .catch((e) => {
        if (!aborted) setError((e as Error)?.message ?? String(e));
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [script?.key, vodId]);

  return { detail, loading, error, script };
}
