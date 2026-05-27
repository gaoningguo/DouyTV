import type { NetLiveStream } from "../types";

export interface Mp4StreamOptions {
  url: string;
  qn?: string;
  qnLabel?: string;
  referer?: string;
  ua?: string;
  alternatives?: NetLiveStream["alternatives"];
}

export function mp4Stream(opts: Mp4StreamOptions): NetLiveStream {
  return {
    url: opts.url,
    streamType: "mp4",
    qn: opts.qn ?? "auto",
    qnLabel: opts.qnLabel ?? "原画",
    referer: opts.referer,
    ua: opts.ua,
    alternatives: opts.alternatives,
  };
}
