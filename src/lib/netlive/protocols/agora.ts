import type { NetLiveStream } from "../types";

export interface AgoraStreamOptions {
  appId: string;
  channelId: string;
  token: string;
  uid: number;
  refresh?: () => Promise<{ channelId: string; token: string; uid: number }>;
  referer?: string;
  ua?: string;
}

export function agoraStream(opts: AgoraStreamOptions): NetLiveStream {
  return {
    url: `agora-rtc://${opts.channelId}`,
    streamType: "agora-rtc",
    referer: opts.referer,
    ua: opts.ua,
    agora: {
      appId: opts.appId,
      channelId: opts.channelId,
      token: opts.token,
      uid: opts.uid,
      refresh: opts.refresh,
    },
  };
}
