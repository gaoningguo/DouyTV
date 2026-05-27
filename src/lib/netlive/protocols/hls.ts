import type { NetLiveStream } from "../types";

export interface HlsStreamOptions {
  url: string;
  qn?: string;
  qnLabel?: string;
  referer?: string;
  ua?: string;
  alternatives?: NetLiveStream["alternatives"];
}

export function hlsStream(opts: HlsStreamOptions): NetLiveStream {
  return {
    url: opts.url,
    streamType: "hls",
    qn: opts.qn ?? "auto",
    qnLabel: opts.qnLabel ?? "自适应",
    referer: opts.referer,
    ua: opts.ua,
    alternatives: opts.alternatives,
  };
}

export interface MasterVariant {
  qn: string;
  label: string;
  url: string;
  bandwidth: number;
}

export interface ParseMasterOptions {
  masterUrl: string;
  sortByBandwidthDesc?: boolean;
  labelStrategy?: "resolution" | "media-name";
}

export function parseMasterPlaylist(
  text: string,
  opts: ParseMasterOptions
): MasterVariant[] {
  const lines = text.split("\n");
  const variants: MasterVariant[] = [];
  const mediaNames = new Map<string, string>();

  if (opts.labelStrategy === "media-name") {
    for (const line of lines) {
      if (!line.startsWith("#EXT-X-MEDIA:")) continue;
      const name = extractAttr(line, "NAME");
      const groupId = extractAttr(line, "GROUP-ID");
      if (name && groupId) mediaNames.set(groupId, name);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const urlLine = lines[i + 1]?.trim();
    if (!urlLine || urlLine.startsWith("#")) continue;

    const bandwidth = parseInt(extractAttr(line, "BANDWIDTH") ?? "0", 10);
    const resolution = extractAttr(line, "RESOLUTION") ?? "";
    const videoGroup = extractAttr(line, "VIDEO");

    let label: string;
    if (opts.labelStrategy === "media-name" && videoGroup) {
      label = (mediaNames.get(videoGroup) ?? resolution) || `${bandwidth}`;
    } else {
      label = resolution || `${Math.round(bandwidth / 1000)}k`;
    }

    const absUrl = resolveUrl(opts.masterUrl, urlLine);
    variants.push({
      qn: resolution || String(bandwidth),
      label,
      url: absUrl,
      bandwidth,
    });
  }

  if (opts.sortByBandwidthDesc !== false) {
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
  }
  return variants;
}

function extractAttr(line: string, key: string): string | undefined {
  const pattern = new RegExp(`${key}=(?:"([^"]+)"|([^,\\s]+))`);
  const m = line.match(pattern);
  return m ? m[1] ?? m[2] : undefined;
}

function resolveUrl(base: string, rel: string): string {
  if (rel.startsWith("http://") || rel.startsWith("https://")) return rel;
  try {
    return new URL(rel, base).toString();
  } catch {
    return rel;
  }
}
