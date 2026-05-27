import type { NetLiveStream } from "../types";

export interface DashStreamOptions {
  url: string;
  qn?: string;
  qnLabel?: string;
  referer?: string;
  ua?: string;
  alternatives?: NetLiveStream["alternatives"];
}

export function dashStream(opts: DashStreamOptions): NetLiveStream {
  return {
    url: opts.url,
    streamType: "dash",
    qn: opts.qn ?? "auto",
    qnLabel: opts.qnLabel ?? "自适应",
    referer: opts.referer,
    ua: opts.ua,
    alternatives: opts.alternatives,
  };
}
