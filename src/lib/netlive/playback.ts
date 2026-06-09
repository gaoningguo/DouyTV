import type { MediaItem } from "@/types/media";
import type { NetLiveRoom, NetLiveStream } from "@/lib/netlive/types";

export function netLiveHeaders(stream: NetLiveStream): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (stream.ua) headers["User-Agent"] = stream.ua;
  if (stream.referer) headers["Referer"] = stream.referer;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function netLiveRoomId(room: NetLiveRoom): string {
  return `netlive:${room.platform}:${room.roomId}`;
}

export function netLiveRoomToMediaItem(
  room: NetLiveRoom,
  stream: NetLiveStream
): MediaItem {
  return {
    id: netLiveRoomId(room),
    kind: "live",
    title: room.title,
    url: stream.url,
    streamType: stream.streamType ?? "hls",
    poster: room.cover,
    headers: netLiveHeaders(stream),
    agora: stream.agora,
    sourceName: room.platform,
    author: room.uname,
    description: room.introduction || room.notice,
    remarks: room.category,
    typeName: room.category,
    netlivePlatform: room.platform,
    netliveRoomId: room.roomId,
  };
}
