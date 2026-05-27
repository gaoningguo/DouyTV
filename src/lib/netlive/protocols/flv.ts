import type { NetLiveStream } from "../types";

export interface FlvStreamOptions {
  url: string;
  qn?: string;
  qnLabel?: string;
  referer?: string;
  ua?: string;
  alternatives?: NetLiveStream["alternatives"];
}

export function flvStream(opts: FlvStreamOptions): NetLiveStream {
  return {
    url: opts.url,
    streamType: "flv",
    qn: opts.qn ?? "auto",
    qnLabel: opts.qnLabel ?? "原画",
    referer: opts.referer,
    ua: opts.ua,
    alternatives: opts.alternatives,
  };
}
