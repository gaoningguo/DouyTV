import type { NetLiveStream } from "../types";

export interface ChunkedMp4StreamOptions {
  url: string;
  qn?: string;
  qnLabel?: string;
  referer?: string;
  ua?: string;
}

export function chunkedMp4Stream(opts: ChunkedMp4StreamOptions): NetLiveStream {
  return {
    url: opts.url,
    streamType: "chunked-mp4",
    qn: opts.qn ?? "auto",
    qnLabel: opts.qnLabel ?? "auto",
    referer: opts.referer,
    ua: opts.ua,
  };
}

export function sampleAesMp4Stream(opts: ChunkedMp4StreamOptions): NetLiveStream {
  return {
    url: opts.url,
    streamType: "sample-aes-mp4",
    qn: opts.qn ?? "auto",
    qnLabel: opts.qnLabel ?? "auto",
    referer: opts.referer,
    ua: opts.ua,
  };
}
