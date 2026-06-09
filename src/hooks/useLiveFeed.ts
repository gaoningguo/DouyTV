import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveStore } from "@/stores/live";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useNetLiveStore } from "@/stores/netlive";
import { useExternalPluginStore, hydrateReady } from "@/stores/netliveExternalPlugins";
import { getAdapter, listSupportedPlatforms } from "@/lib/netlive/registry";
import {
  NETLIVE_PLATFORMS,
  isListUnsupportedMessage,
  type NetLivePlatformId,
  type NetLiveRoom,
} from "@/lib/netlive/types";
import { netLiveRoomId, netLiveRoomToMediaItem } from "@/lib/netlive/playback";
import type { LiveChannel } from "@/stores/live";
import type { MediaItem } from "@/types/media";

const IPTV_PAGE_SIZE = 18;
const NETLIVE_PAGE_SIZE = 16;
const MAX_PARALLEL_PLATFORM_REQUESTS = 4;
const NETLIVE_PAGE_SPAN = 5;

interface LiveFeedCache {
  items: MediaItem[];
  page: number;
  hasMore: boolean;
  activeIndex: number;
  seed: number;
  signature: string;
}

let liveFeedCache: LiveFeedCache = {
  items: [],
  page: 1,
  hasMore: true,
  activeIndex: 0,
  seed: 0,
  signature: "",
};

function streamTypeFromUrl(url: string): MediaItem["streamType"] {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8") || lower.includes(".m3u?")) return "hls";
  if (lower.includes(".flv")) return "flv";
  if (lower.includes(".mpd")) return "dash";
  if (lower.includes(".mp4")) return "mp4";
  return "auto";
}

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function seededScore(seed: number, id: string): number {
  let h = (seed ^ hashString(id)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function seededIndex(seed: number, key: string, size: number): number {
  if (size <= 0) return 0;
  return Math.floor(seededScore(seed, key) * size) % size;
}

function seededPage(seed: number, key: string, basePage: number): number {
  if (basePage > 1) return basePage;
  return seededIndex(seed, key, NETLIVE_PAGE_SPAN) + 1;
}

function shuffleBySeed<T>(
  items: T[],
  seed: number,
  keyOf: (item: T) => string
): T[] {
  return [...items].sort(
    (a, b) => seededScore(seed, keyOf(b)) - seededScore(seed, keyOf(a))
  );
}

function normalizeOnline(n: number | undefined): number {
  if (!n || n <= 0) return 0;
  return Math.min(1, Math.log10(n + 1) / 7);
}

function channelToMediaItem(ch: LiveChannel): MediaItem {
  const headers: Record<string, string> = {};
  if (ch.ua) headers["User-Agent"] = ch.ua;
  if (ch.referer) headers["Referer"] = ch.referer;
  return {
    id: `live:${ch.id}`,
    kind: "live",
    title: ch.name,
    url: ch.url,
    streamType: streamTypeFromUrl(ch.url),
    poster: ch.logo,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    sourceName: ch.category || "IPTV",
    remarks: ch.category,
    typeName: ch.category,
  };
}

function roomToPendingMedia(room: NetLiveRoom): MediaItem {
  return {
    id: netLiveRoomId(room),
    kind: "live",
    title: room.title || room.roomId,
    poster: room.cover,
    sourceName: room.platform,
    author: room.uname,
    description: room.introduction || room.notice,
    remarks: room.category,
    typeName: room.category,
    netlivePlatform: room.platform,
    netliveRoomId: room.roomId,
  };
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await run(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

interface ScoredRoom {
  room: NetLiveRoom;
  score: number;
}

function rankRooms({
  rooms,
  seed,
  favorites,
  history,
  health,
  platformOrder,
}: {
  rooms: NetLiveRoom[];
  seed: number;
  favorites: NetLiveRoom[];
  history: NetLiveRoom[];
  health: ReturnType<typeof useNetLiveStore.getState>["health"];
  platformOrder: NetLivePlatformId[];
}): NetLiveRoom[] {
  const favoriteKeys = new Set(favorites.map((r) => `${r.platform}:${r.roomId}`));
  const historyKeys = new Set(history.map((r) => `${r.platform}:${r.roomId}`));
  const recentCategories = new Set(history.slice(0, 20).map((r) => r.category).filter(Boolean));
  const seen = new Set<string>();
  const deduped: NetLiveRoom[] = [];
  for (const room of rooms) {
    const key = `${room.platform}:${room.roomId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(room);
  }

  const scored: ScoredRoom[] = deduped.map((room) => {
    const key = `${room.platform}:${room.roomId}`;
    const platformIdx = platformOrder.indexOf(room.platform);
    const platformFairness = platformIdx >= 0 ? Math.max(0, 0.12 - platformIdx * 0.006) : 0;
    const healthBoost = health[room.platform]?.ok ? 0.08 : 0;
    const healthPenalty = health[room.platform]?.ok === false ? -0.16 : 0;
    const favBoost = favoriteKeys.has(key) ? 0.28 : 0;
    const historyBoost = historyKeys.has(key) ? 0.16 : 0;
    const categoryBoost = room.category && recentCategories.has(room.category) ? 0.08 : 0;
    const liveBoost = room.live ? 0.22 : -0.35;
    const onlineBoost = normalizeOnline(room.online) * 0.24;
    const random = seededScore(seed, key) * 0.2;
    return {
      room,
      score:
        liveBoost +
        onlineBoost +
        favBoost +
        historyBoost +
        categoryBoost +
        healthBoost +
        healthPenalty +
        platformFairness +
        random,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return rotatePlatforms(scored, platformOrder, seed);
}

function rotatePlatforms(
  scored: ScoredRoom[],
  platformOrder: NetLivePlatformId[],
  seed: number
): NetLiveRoom[] {
  const buckets = new Map<NetLivePlatformId, ScoredRoom[]>();
  for (const item of scored) {
    const bucket = buckets.get(item.room.platform) ?? [];
    bucket.push(item);
    buckets.set(item.room.platform, bucket);
  }
  const order = shuffleBySeed(
    platformOrder.filter((platform) => buckets.has(platform)),
    seed ^ hashString("platform-rotation"),
    (platform) => platform
  );
  const out: NetLiveRoom[] = [];
  while (order.some((platform) => (buckets.get(platform)?.length ?? 0) > 0)) {
    for (const platform of order) {
      const next = buckets.get(platform)?.shift();
      if (next) out.push(next.room);
    }
  }
  return out;
}

interface UseLiveFeedOptions {
  enabled?: boolean;
}

export function useLiveFeed({ enabled = true }: UseLiveFeedOptions = {}) {
  const channels = useLiveStore((s) => s.channels);
  const hydrateLive = useLiveStore((s) => s.hydrate);
  const subscriptions = useLiveSubStore((s) => s.subscriptions);
  const hydrateLiveSubs = useLiveSubStore((s) => s.hydrate);
  const hydrateNetLive = useNetLiveStore((s) => s.hydrate);
  const activePlatform = useNetLiveStore((s) => s.activePlatform);
  const adultEnabled = useNetLiveStore((s) => s.adultEnabled);
  const favorites = useNetLiveStore((s) => s.favorites);
  const history = useNetLiveStore((s) => s.history);
  const health = useNetLiveStore((s) => s.health);
  const noteVisit = useNetLiveStore((s) => s.noteVisit);
  const hydratePlugins = useExternalPluginStore((s) => s.hydrate);
  const externalPluginsHydrated = useExternalPluginStore((s) => s.hydrated);
  const pluginSignature = useExternalPluginStore((s) =>
    s.plugins.map((p) => `${p.key}:${p.enabled ? 1 : 0}:${p.updatedAt ?? 0}`).join("|")
  );

  const [items, setItems] = useState<MediaItem[]>(() => liveFeedCache.items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(() => liveFeedCache.page);
  const [hasMore, setHasMore] = useState(() => liveFeedCache.hasMore);
  const [activeIndex, setActiveIndex] = useState(() => liveFeedCache.activeIndex);
  const inFlight = useRef(false);
  const resolveInFlight = useRef(new Set<string>());
  const resolveFailed = useRef(new Set<string>());
  const seedRef = useRef(liveFeedCache.seed || Date.now());
  const restoredCacheRef = useRef(liveFeedCache.items.length > 0);

  useEffect(() => {
    hydrateLive();
    hydrateLiveSubs();
    hydrateNetLive();
    hydratePlugins();
  }, [hydrateLive, hydrateLiveSubs, hydrateNetLive, hydratePlugins]);

  const enabledIptvSourceIds = useMemo(
    () => new Set(subscriptions.filter((s) => s.enabled !== false).map((s) => s.id)),
    [subscriptions]
  );

  const visibleChannels = useMemo(
    () =>
      channels.filter((ch) => !ch.sourceId || enabledIptvSourceIds.has(ch.sourceId)),
    [channels, enabledIptvSourceIds]
  );

  const channelKey = useMemo(
    () => visibleChannels.map((ch) => `${ch.id}:${ch.url}`).join("|"),
    [visibleChannels]
  );

  const platformKey = useMemo(
    () => listSupportedPlatforms().join("|"),
    [externalPluginsHydrated, pluginSignature]
  );

  const feedSignature = useMemo(
    () =>
      [
        channelKey,
        platformKey,
        activePlatform,
        adultEnabled ? "adult" : "safe",
        externalPluginsHydrated ? "plugins-ready" : "plugins-loading",
      ].join("\n"),
    [activePlatform, adultEnabled, channelKey, externalPluginsHydrated, platformKey]
  );

  const pickPlatforms = useCallback(() => {
    const supported = listSupportedPlatforms();
    const allowed = adultEnabled
      ? supported
      : supported.filter((p) => !NETLIVE_PLATFORMS.find((m) => m.id === p)?.adult);
    if (allowed.length <= 1) return allowed;
    return shuffleBySeed([
      ...allowed.filter((p) => p === activePlatform),
      ...allowed.filter((p) => p !== activePlatform),
    ], seedRef.current, (p) => p);
  }, [activePlatform, adultEnabled]);

  const loadPage = useCallback(
    async (p: number, replace: boolean) => {
      if (!enabled || inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      setError(undefined);
      if (replace) {
        seedRef.current = Date.now();
        resolveFailed.current.clear();
        setItems([]);
        setActiveIndex(0);
      }
      try {
        if (!externalPluginsHydrated) await hydrateReady;
        const start = (p - 1) * IPTV_PAGE_SIZE;
        const iptvItems = shuffleBySeed(
          visibleChannels,
          seedRef.current ^ hashString("iptv"),
          (ch) => ch.id
        )
          .slice(start, start + IPTV_PAGE_SIZE)
          .map(channelToMediaItem);

        const platforms = pickPlatforms();
        const results = await mapConcurrent(
          platforms,
          MAX_PARALLEL_PLATFORM_REQUESTS,
          async (platform) => {
            try {
              const adapter = await getAdapter(platform);
              const requestSeed = seedRef.current ^ p;
              const recommendPage = seededPage(
                requestSeed,
                `${platform}:recommend`,
                p
              );
              let list: NetLiveRoom[] = [];
              try {
                const res = await adapter.getRecommend(recommendPage, NETLIVE_PAGE_SIZE);
                list = res.list;
                if (list.length === 0 && recommendPage !== 1) {
                  const fallback = await adapter.getRecommend(1, NETLIVE_PAGE_SIZE);
                  list = fallback.list;
                }
              } catch (e) {
                if (recommendPage === 1) throw e;
                const fallback = await adapter.getRecommend(1, NETLIVE_PAGE_SIZE);
                list = fallback.list;
              }

              if (adapter.getCategories && adapter.getCategoryRooms) {
                const categories = await adapter.getCategories().catch(() => []);
                const picked = shuffleBySeed(
                  categories,
                  requestSeed ^ hashString(platform),
                  (cat) => cat.id
                )[0];
                if (picked) {
                  const categoryPage = seededPage(
                    requestSeed,
                    `${platform}:category:${picked.id}`,
                    p
                  );
                  const catRes = await adapter
                    .getCategoryRooms(picked.id, categoryPage)
                    .catch(async () =>
                      categoryPage === 1
                        ? { list: [] as NetLiveRoom[], hasMore: false }
                        : adapter.getCategoryRooms!(picked.id, 1)
                    );
                  list = [...list, ...catRes.list];
                }
              }

              return list.filter((room) => room.live);
            } catch (e) {
              const msg = (e as Error).message ?? String(e);
              if (!isListUnsupportedMessage(msg)) {
                console.warn(`[useLiveFeed] recommend failed: ${platform}`, e);
              }
              return [] as NetLiveRoom[];
            }
          }
        );
        const rankedRooms = rankRooms({
          rooms: results.flat(),
          seed: seedRef.current ^ p,
          favorites,
          history,
          health,
          platformOrder: platforms,
        });
        const netItems = rankedRooms.map(roomToPendingMedia);
        const mixed = interleaveLiveItems(iptvItems, netItems, seedRef.current ^ p);

        setItems((prev) => {
          const base = replace ? [] : prev;
          const seen = new Set(base.map((it) => it.id));
          return [...base, ...mixed.filter((it) => !seen.has(it.id))];
        });
        setPage(p);
        setHasMore(iptvItems.length > 0 || netItems.length > 0);
      } catch (e) {
        setError((e as Error).message ?? String(e));
        if (replace) setItems([]);
        setHasMore(false);
      } finally {
        setLoading(false);
        inFlight.current = false;
      }
    },
    [
      adultEnabled,
      enabled,
      externalPluginsHydrated,
      favorites,
      health,
      history,
      pickPlatforms,
      visibleChannels,
    ]
  );

  useEffect(() => {
    if (!enabled) return;
    if (
      restoredCacheRef.current &&
      liveFeedCache.items.length > 0 &&
      liveFeedCache.signature === feedSignature
    ) {
      restoredCacheRef.current = false;
      return;
    }
    restoredCacheRef.current = false;
    void loadPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, feedSignature]);

  useEffect(() => {
    liveFeedCache = {
      items,
      page,
      hasMore,
      activeIndex: Math.max(0, Math.min(items.length - 1, activeIndex)),
      seed: seedRef.current,
      signature: feedSignature,
    };
  }, [activeIndex, feedSignature, hasMore, items, page]);

  const resolveItem = useCallback(
    async (itemId: string, force = false) => {
      const current = items.find((it) => it.id === itemId);
      if (!current || (!force && current.url) || !current.netlivePlatform || !current.netliveRoomId) return;
      if (resolveInFlight.current.has(itemId)) return;
      if (!force && resolveFailed.current.has(itemId)) return;
      resolveInFlight.current.add(itemId);
      if (force) resolveFailed.current.delete(itemId);
      try {
        const adapter = await getAdapter(current.netlivePlatform);
        const room =
          (await adapter.getRoomDetail?.(current.netliveRoomId).catch(() => null)) ?? {
            platform: current.netlivePlatform,
            roomId: current.netliveRoomId,
            title: current.title,
            uname: current.author,
            cover: current.poster,
            category: current.remarks,
            introduction: current.description,
            live: true,
          };
        const stream = await adapter.resolve(current.netliveRoomId);
        const mediaItem = netLiveRoomToMediaItem(room, stream);
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId
              ? {
                  ...it,
                  ...mediaItem,
                  id: itemId,
                }
              : it
          )
        );
        noteVisit(room);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        console.warn(`[useLiveFeed] resolve failed: ${itemId}`, e);
        resolveFailed.current.add(itemId);
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId
              ? { ...it, description: it.description || msg, remarks: "拉流失败" }
              : it
          )
        );
      } finally {
        resolveInFlight.current.delete(itemId);
      }
    },
    [items, noteVisit]
  );

  useEffect(() => {
    if (!enabled) return;
    const active = items[activeIndex];
    if (!active) return;
    void resolveItem(active.id);
  }, [activeIndex, enabled, items, resolveItem]);

  return {
    items,
    loading,
    error,
    hasMore,
    activeIndex,
    setActiveIndex,
    reload: () => loadPage(1, true),
    loadMore: () => {
      if (hasMore && !loading) void loadPage(page + 1, false);
    },
    reresolveItem: (itemId: string) => resolveItem(itemId, true),
  };
}

function interleaveLiveItems(
  iptvItems: MediaItem[],
  netItems: MediaItem[],
  seed: number
): MediaItem[] {
  if (iptvItems.length === 0) return netItems;
  if (netItems.length === 0) return iptvItems;
  const shuffledIptv = [...iptvItems].sort(
    (a, b) => seededScore(seed, b.id) - seededScore(seed, a.id)
  );
  const out: MediaItem[] = [];
  const max = Math.max(netItems.length, shuffledIptv.length);
  for (let i = 0; i < max; i++) {
    if (netItems[i]) out.push(netItems[i]);
    if (i % 3 === 1 && shuffledIptv.length > 0) {
      const iptv = shuffledIptv.shift();
      if (iptv) out.push(iptv);
    }
  }
  return [...out, ...shuffledIptv];
}
