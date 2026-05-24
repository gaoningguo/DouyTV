/**
 * Twitch 直播 adapter —— 走匿名 GraphQL（https://gql.twitch.tv/gql）。
 *
 * 实现范围：
 *   - getRecommend：top streams（无 cursor 翻页，page>1 用 after cursor）
 *   - getCategories：top games（最热分类）
 *   - getCategoryRooms：某 game 下 streams
 *   - search：searchFor.channels（一次性，无翻页）
 *   - resolve：streamPlaybackAccessToken → usher.ttvnw.net HLS m3u8
 *   - getRoomDetail：user(login)，含 stream 状态
 *   - getLiveStatus：检查 user.stream 是否为 LIVE
 *
 * Twitch 公网 web Client-ID（`kimne78kx3ncx6brgo4mv6wki5h1ko`）是公开常量，
 * Twitch web app 本身也用它，匿名查询全部可见。不需要 OAuth token。
 *
 * roomId 我们用 channel `login`（小写 username），更稳定也更好分享。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("twitch");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const GQL_URL = "https://gql.twitch.tv/gql";
const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.twitch.tv/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Client-ID": CLIENT_ID,
  Referer: REFERER,
  "Content-Type": "application/json",
};

/** 推荐 / 分类列表用的 cursor 缓存，按 (category||"home"):page → cursor */
const cursorCache = new Map<string, string>();

async function gql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await scriptFetch(GQL_URL, {
    method: "POST",
    headers: COMMON_HEADERS,
    json: { query, variables },
    timeout: 20_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} twitch gql`);
  const body = await res.json<{ data?: T; errors?: Array<{ message: string }> }>();
  if (body.errors && body.errors.length > 0) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) throw new Error("twitch gql 返回空 data");
  return body.data;
}

/* ─────────────── 通用 mapper ─────────────── */

interface TwStream {
  id: string;
  title: string | null;
  viewersCount: number | null;
  previewImageURL: string | null;
  type: string | null;
  broadcaster?: {
    id: string;
    login: string;
    displayName: string;
    profileImageURL?: string | null;
  } | null;
  game?: { id: string; name: string; displayName?: string | null } | null;
}

function mapStream(s: TwStream | null | undefined): NetLiveRoom | undefined {
  if (!s || !s.broadcaster) return undefined;
  const login = s.broadcaster.login;
  return {
    platform: "twitch",
    roomId: login,
    title: s.title ?? "",
    uname: s.broadcaster.displayName,
    cover: s.previewImageURL ?? undefined,
    avatar: s.broadcaster.profileImageURL ?? undefined,
    online: s.viewersCount ?? 0,
    category: s.game?.displayName ?? s.game?.name ?? undefined,
    live: true, // streams 查询天然只返直播中
    link: `https://www.twitch.tv/${login}`,
  };
}

/* ─────────────── 推荐 ─────────────── */

const QUERY_TOP_STREAMS = `
  query($first: Int!, $after: Cursor) {
    streams(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          viewersCount
          type
          previewImageURL(width: 320, height: 180)
          broadcaster {
            id
            login
            displayName
            profileImageURL(width: 50)
          }
          game {
            id
            name
            displayName
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const cacheKey = `home:${page - 1}`;
  const after = page > 1 ? cursorCache.get(cacheKey) ?? null : null;
  const data = await gql<{
    streams?: {
      edges: Array<{ cursor: string; node: TwStream }>;
      pageInfo: { hasNextPage: boolean };
    };
  }>(QUERY_TOP_STREAMS, { first: Math.max(pageSize, 30), after });
  const edges = data.streams?.edges ?? [];
  if (edges.length > 0) {
    cursorCache.set(`home:${page}`, edges[edges.length - 1].cursor);
  }
  const list = edges
    .map((e) => mapStream(e.node))
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: !!data.streams?.pageInfo.hasNextPage };
}

/* ─────────────── 分类（top games） ─────────────── */

const QUERY_TOP_GAMES = `
  query($first: Int!) {
    games(first: $first) {
      edges {
        node {
          id
          name
          displayName
          boxArtURL(width: 144, height: 192)
        }
      }
    }
  }
`;

async function getCategories(): Promise<NetLiveCategory[]> {
  const data = await gql<{
    games?: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          displayName?: string | null;
          boxArtURL?: string | null;
        };
      }>;
    };
  }>(QUERY_TOP_GAMES, { first: 50 });
  return (data.games?.edges ?? []).map((e) => ({
    id: e.node.id,
    name: e.node.displayName || e.node.name,
    cover: e.node.boxArtURL ?? undefined,
  }));
}

/* ─────────────── 分类下房间 ─────────────── */

const QUERY_GAME_STREAMS = `
  query($id: ID!, $first: Int!, $after: Cursor) {
    game(id: $id) {
      streams(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            title
            viewersCount
            type
            previewImageURL(width: 320, height: 180)
            broadcaster {
              id
              login
              displayName
              profileImageURL(width: 50)
            }
            game {
              id
              name
              displayName
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }
`;

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const cacheKey = `g:${categoryId}:${page - 1}`;
  const after = page > 1 ? cursorCache.get(cacheKey) ?? null : null;
  const data = await gql<{
    game?: {
      streams?: {
        edges: Array<{ cursor: string; node: TwStream }>;
        pageInfo: { hasNextPage: boolean };
      };
    } | null;
  }>(QUERY_GAME_STREAMS, { id: categoryId, first: 30, after });
  const edges = data.game?.streams?.edges ?? [];
  if (edges.length > 0) {
    cursorCache.set(`g:${categoryId}:${page}`, edges[edges.length - 1].cursor);
  }
  const list = edges
    .map((e) => mapStream(e.node))
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: !!data.game?.streams?.pageInfo.hasNextPage };
}

/* ─────────────── 搜索 ─────────────── */

const QUERY_SEARCH = `
  query($q: String!) {
    searchFor(userQuery: $q, platform: "web", target: { index: CHANNEL }) {
      channels {
        items {
          id
          login
          displayName
          profileImageURL(width: 50)
          stream {
            id
            title
            viewersCount
            type
            previewImageURL(width: 320, height: 180)
            game {
              id
              name
              displayName
            }
          }
        }
      }
    }
  }
`;

interface TwChannelSearchItem {
  id: string;
  login: string;
  displayName: string;
  profileImageURL?: string | null;
  stream?: {
    id: string;
    title: string;
    viewersCount: number;
    type: string | null;
    previewImageURL?: string | null;
    game?: { name: string; displayName?: string | null } | null;
  } | null;
}

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // Twitch 搜索是 one-shot（searchFor 默认返前 N），无翻页
  const data = await gql<{
    searchFor?: { channels?: { items: TwChannelSearchItem[] } };
  }>(QUERY_SEARCH, { q: keyword });
  const items = data.searchFor?.channels?.items ?? [];
  const list: NetLiveRoom[] = items.map((it) => ({
    platform: "twitch",
    roomId: it.login,
    title: it.stream?.title ?? it.displayName,
    uname: it.displayName,
    cover: it.stream?.previewImageURL ?? undefined,
    avatar: it.profileImageURL ?? undefined,
    online: it.stream?.viewersCount ?? 0,
    category: it.stream?.game?.displayName ?? it.stream?.game?.name,
    live: !!it.stream,
    link: `https://www.twitch.tv/${it.login}`,
  }));
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 ─────────────── */

const QUERY_USER_DETAIL = `
  query($login: String!) {
    user(login: $login) {
      id
      login
      displayName
      description
      profileImageURL(width: 70)
      stream {
        id
        title
        viewersCount
        type
        previewImageURL(width: 1280, height: 720)
        game {
          id
          name
          displayName
        }
      }
    }
  }
`;

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const login = roomId.toLowerCase();
  const data = await gql<{
    user?: {
      id: string;
      login: string;
      displayName: string;
      description?: string | null;
      profileImageURL?: string | null;
      stream?: TwStream | null;
    } | null;
  }>(QUERY_USER_DETAIL, { login });
  const u = data.user;
  if (!u) throw new Error(`Twitch 频道 ${login} 未找到`);
  return {
    platform: "twitch",
    roomId: u.login,
    title: u.stream?.title ?? u.displayName,
    uname: u.displayName,
    avatar: u.profileImageURL ?? undefined,
    cover: u.stream?.previewImageURL ?? undefined,
    online: u.stream?.viewersCount ?? 0,
    category: u.stream?.game?.displayName ?? u.stream?.game?.name,
    introduction: u.description ?? undefined,
    live: !!u.stream,
    link: `https://www.twitch.tv/${u.login}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const data = await gql<{
      user?: { stream?: { id: string } | null } | null;
    }>(`query($login: String!) { user(login: $login) { stream { id } } }`, {
      login: roomId.toLowerCase(),
    });
    return !!data.user?.stream?.id;
  } catch {
    return false;
  }
}

/* ─────────────── resolve（HLS） ─────────────── */

const QUERY_PLAYBACK_TOKEN = `
  query($login: String!) {
    streamPlaybackAccessToken(
      channelName: $login,
      params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}
    ) {
      value
      signature
    }
  }
`;

interface TwPlaybackTokenResp {
  streamPlaybackAccessToken?: { value: string; signature: string } | null;
}

/** 16 位十进制随机数 —— Twitch usher endpoint 要 p 参数 */
function randPlayerId(): number {
  return Math.floor(1_000_000 + Math.random() * 9_000_000);
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const login = roomId.toLowerCase();
  const tk = await gql<TwPlaybackTokenResp>(QUERY_PLAYBACK_TOKEN, { login });
  const t = tk.streamPlaybackAccessToken;
  if (!t) throw new Error(`Twitch 未返回 ${login} 的 playback token`);
  const p = randPlayerId();
  // usher 返 master m3u8（含多路 qn variant），hls.js 会自动按带宽选；
  // 我们也解析一遍提取 alternatives，给用户手动切清晰度。
  const url = new URL(
    `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8`
  );
  url.searchParams.set("sig", t.signature);
  url.searchParams.set("token", t.value);
  url.searchParams.set("player", "twitchweb");
  url.searchParams.set("supported_codecs", "avc1");
  url.searchParams.set("fast_bread", "true");
  url.searchParams.set("allow_source", "true");
  url.searchParams.set("p", String(p));
  url.searchParams.set("playlist_include_framerate", "true");
  url.searchParams.set("type", "any");
  url.searchParams.set("cdm", "wv");

  const masterUrl = url.toString();
  const alternatives = await fetchMasterAlternatives(masterUrl).catch(() => []);

  // master 自己就可以播；alternatives 是给手动切的 variant 直播 m3u8 URL。
  return {
    url: masterUrl,
    streamType: "hls",
    qn: alternatives[0]?.qn ?? "auto",
    qnLabel: alternatives[0]?.label ?? "自适应",
    alternatives: alternatives.length > 1 ? alternatives : undefined,
    referer: REFERER,
    ua: UA,
  };
}

/**
 * 拉一次 master.m3u8 → 解析 #EXT-X-STREAM-INF 行抽出各 variant，
 * 返 RESOLUTION/FRAME-RATE label + url（同级 directory + relative url）。
 */
async function fetchMasterAlternatives(
  masterUrl: string
): Promise<Array<{ qn: string; label: string; url: string }>> {
  const res = await scriptFetch(masterUrl, {
    method: "GET",
    headers: { "User-Agent": UA, Referer: REFERER },
    timeout: 15_000,
    http2: true,
  });
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.split("\n");
  const out: Array<{ qn: string; label: string; url: string }> = [];
  let pendingInf: string | null = null;
  let pendingMedia: { name: string; groupId: string } | null = null;
  // 收集 NAME=（清晰度名）：通常 EXT-X-MEDIA TYPE=VIDEO，NAME="1080p60" 等
  const mediaNames: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const groupId = matchAttr(line, "GROUP-ID");
      const name = matchAttr(line, "NAME");
      if (groupId && name) mediaNames[groupId] = name;
      continue;
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingInf = line;
      const videoGroup = matchAttr(line, "VIDEO");
      const name = videoGroup ? mediaNames[videoGroup] : null;
      pendingMedia = name && videoGroup
        ? { name, groupId: videoGroup }
        : null;
      continue;
    }
    if (pendingInf && line && !line.startsWith("#")) {
      const resolution = pendingInf.match(/RESOLUTION=([^,]+)/);
      const frameRate = pendingInf.match(/FRAME-RATE=([^,]+)/);
      const label =
        pendingMedia?.name ??
        (resolution
          ? `${resolution[1]}${frameRate ? `@${Math.round(parseFloat(frameRate[1]))}` : ""}`
          : "variant");
      out.push({
        qn: pendingMedia?.groupId || resolution?.[1] || `v${out.length}`,
        label,
        url: line,
      });
      pendingInf = null;
      pendingMedia = null;
    }
  }
  return out;
}

function matchAttr(line: string, key: string): string | null {
  const m = line.match(new RegExp(`${key}="([^"]+)"`));
  return m ? m[1] : null;
}

/* ─────────────── 导出 ─────────────── */

export const twitchAdapter: NetLiveAdapter = {
  platform: "twitch",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
