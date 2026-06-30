/**
 * musicSdk 列表层适配器 —— 把移植自 lxserver 的六平台 musicSdk（kw/kg/tx/wy/mg/bd）
 * 的「列表能力」(搜索/榜单/歌单广场/歌单详情/歌手/专辑/热搜/搜索提示/歌词/评论)
 * 归一到本项目的 MusicSong / MusicSongListSummary / 榜单 / 标签 类型。
 *
 * 设计：
 *  - 列表能力免配置可用（musicSdk 各平台 index.js 自带实现，网络走 scriptFetch）。
 *  - 播放取直链不在此处：见 sdk/musicSdk/api-source.js（registerMusicUrlResolver 注入）。
 *  - SDK 歌曲对象字段与 lxServer 的 LxServerSong 基本一致 → 复用 normalizeLxSong 归一。
 *  - SDK 歌曲原始对象存入 song.raw，播放解析时原样回传给 SDK getMusicUrl（保留各平台 id 编码）。
 */
import { sdk, type MusicSdkPlatform } from "./sdk/index-sdk";
import { normalizeLxSong } from "./lxServer";
import type {
  MusicDiscoveryBoard,
  MusicHotSearchItem,
  MusicPlatform,
  MusicSong,
  MusicSongListSummary,
  MusicSongListTags,
  MusicSourceDescriptor,
} from "./types";
import { asNumber, asRecord, asString } from "./utils";

/** musicSdk 暴露列表能力的平台（bd 仅搜索/榜单/歌单/热搜，无歌手/专辑/评论/tip）。 */
export const MUSIC_SDK_PLATFORMS: MusicSdkPlatform[] = ["wy", "tx", "kw", "kg", "mg", "bd"];

/** 单平台模块（运行时为移植 JS，按方法名断言取用）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function plat(platform: MusicSdkPlatform): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sdk as any)[platform];
}

/** SDK 歌曲对象 → MusicSong（复用 lxServer 归一；platform 兜底取传入的平台）。 */
function toSong(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  raw: unknown
): MusicSong | null {
  const record = asRecord(raw);
  if (!record) return null;
  // normalizeLxSong 读 source/songId/id/songmid/name/singer/interval/img/hash/albumId 等，
  // SDK 歌曲对象字段一致。platform 用 record.source（SDK 自带），缺失兜底传入平台。
  const song = normalizeLxSong(
    source,
    record as Parameters<typeof normalizeLxSong>[1],
    platform as MusicPlatform
  );
  if (!song) return null;
  // 关键：保留 SDK 原始歌曲对象，播放解析时原样回传（各平台 id 编码不同，SDK 自己认）。
  return { ...song, raw: record };
}

function toSongs(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  rawList: unknown
): MusicSong[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((item) => toSong(source, platform, item))
    .filter((item): item is MusicSong => !!item);
}

/** 歌单卡对象 → MusicSongListSummary。 */
function toSongList(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  raw: unknown
): MusicSongListSummary | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    source: platform,
    sourceId: source.id,
    pic: asString(row.img) || asString(row.pic) || asString(row.picUrl),
    author: asString(row.author),
    desc: asString(row.desc),
    playCount: asNumber(row.play_count) ?? asString(row.play_count) ?? undefined,
    total: asNumber(row.total) ?? undefined,
  };
}

// ── 搜索 ───────────────────────────────────────────────────────────

/** 单平台搜索。失败抛错（上层 allSettled 吞）。 */
export async function searchMusicSdkPlatform(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  keyword: string,
  page = 1,
  limit = 30
): Promise<MusicSong[]> {
  const mod = plat(platform);
  if (!mod?.musicSearch?.search) return [];
  const result = await mod.musicSearch.search(keyword, page, limit);
  return toSongs(source, platform, asRecord(result)?.list);
}

/** 源启用的平台（defaultPlatform 指定单平台，否则按 platforms，再否则全平台）。 */
export function musicSdkSourcePlatforms(
  source: MusicSourceDescriptor
): MusicSdkPlatform[] {
  if (source.defaultPlatform && source.defaultPlatform !== "all") {
    return MUSIC_SDK_PLATFORMS.includes(source.defaultPlatform as MusicSdkPlatform)
      ? [source.defaultPlatform as MusicSdkPlatform]
      : [];
  }
  const configured = MUSIC_SDK_PLATFORMS.filter((p) =>
    (source.platforms ?? []).some((sp) => sp === p)
  );
  return configured.length > 0 ? configured : MUSIC_SDK_PLATFORMS;
}

/** 多平台并行搜索，合并结果（供 searchMusicSource 用）。 */
export async function searchMusicSdk(
  source: MusicSourceDescriptor,
  keyword: string,
  page = 1,
  limit = 30
): Promise<MusicSong[]> {
  const platforms = musicSdkSourcePlatforms(source);
  const settled = await Promise.allSettled(
    platforms.map((p) => searchMusicSdkPlatform(source, p, keyword, page, limit))
  );
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

// ── 榜单 ───────────────────────────────────────────────────────────

/** 某平台的全部榜单（getBoards 静态数据，board.id 形如 `wy__19723756`，bangid 为纯数字）。 */
export function getMusicSdkBoards(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform
): MusicDiscoveryBoard[] {
  const mod = plat(platform);
  if (!mod?.leaderboard?.getBoards) return [];
  // getBoards 内部为同步返回 { list:[{id,name,bangid}] }（动态抓取已被注释）。
  const result = mod.leaderboard.getBoards();
  // 个别平台可能返回 Promise，这里只处理同步值；异步在 aggregated 层 await。
  const list = Array.isArray(asRecord(result)?.list) ? asRecord(result)?.list : [];
  return ((list as unknown[]) ?? [])
    .map((item): MusicDiscoveryBoard | null => {
      const row = asRecord(item);
      const bangid = asString(row?.bangid) || asString(row?.id);
      const name = asString(row?.name);
      if (!bangid || !name) return null;
      return {
        // board.id 用 bangid（去前缀的纯数字），详情请求直接用它。
        id: bangid,
        name,
        source: platform as MusicPlatform,
        sourceId: source.id,
      };
    })
    .filter((b): b is MusicDiscoveryBoard => !!b);
}

/** 榜单歌曲（bangid 传纯数字，不带 `xx__` 前缀）。 */
export async function getMusicSdkBoardSongs(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  bangid: string,
  page = 1
): Promise<MusicSong[]> {
  const mod = plat(platform);
  if (!mod?.leaderboard?.getList) return [];
  const result = await mod.leaderboard.getList(bangid, page);
  return toSongs(source, platform, asRecord(result)?.list);
}

// ── 歌单广场 ───────────────────────────────────────────────────────

/** 歌单分类标签（tags 分组 + hotTag），归一到 MusicSongListTags。 */
export async function getMusicSdkSonglistTags(
  platform: MusicSdkPlatform
): Promise<MusicSongListTags> {
  const empty: MusicSongListTags = { groups: [], hotTags: [], sortList: [] };
  const mod = plat(platform);
  if (!mod?.songList?.getTags) return empty;
  const result = asRecord(await mod.songList.getTags());
  if (!result) return empty;
  const groups = Array.isArray(result.tags) ? result.tags : [];
  const hotTag = Array.isArray(result.hotTag) ? result.hotTag : [];
  // sortList 取自模块静态属性。
  const sortListRaw = Array.isArray(mod.songList.sortList) ? mod.songList.sortList : [];
  return {
    groups,
    hotTags: (hotTag as unknown[])
      .map((t) => {
        const row = asRecord(t);
        const id = asString(row?.id);
        const name = asString(row?.name);
        return id && name ? { id, name } : null;
      })
      .filter((t): t is { id: string; name: string } => !!t),
    sortList: (sortListRaw as unknown[])
      .map((t) => {
        const row = asRecord(t);
        const id = asString(row?.id);
        const name = asString(row?.name);
        return id && name ? { id, name } : null;
      })
      .filter((t): t is { id: string; name: string } => !!t),
  };
}

/** 歌单广场列表（sortId/tagId 取自 getTags 返回，原样回传）。 */
export async function getMusicSdkSonglists(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  sortId = "",
  tagId = "",
  page = 1
): Promise<MusicSongListSummary[]> {
  const mod = plat(platform);
  if (!mod?.songList?.getList) return [];
  const result = await mod.songList.getList(sortId || undefined, tagId || undefined, page);
  const list = asRecord(result)?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => toSongList(source, platform, item))
    .filter((item): item is MusicSongListSummary => !!item);
}

/** 歌单详情曲目（tx 无 page，一次全量；其余带 page）。 */
export async function getMusicSdkSonglistDetail(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  id: string,
  page = 1
): Promise<MusicSong[]> {
  const mod = plat(platform);
  if (!mod?.songList?.getListDetail) return [];
  // tx 的 getListDetail(id) 无 page 参数（一次返回全部）。
  const result =
    platform === "tx"
      ? await mod.songList.getListDetail(id)
      : await mod.songList.getListDetail(id, page);
  return toSongs(source, platform, asRecord(result)?.list);
}

/** 按关键词搜歌单（与歌单广场区分）。 */
export async function searchMusicSdkSonglists(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  text: string,
  page = 1,
  limit = 20
): Promise<MusicSongListSummary[]> {
  const mod = plat(platform);
  if (!mod?.songList?.search) return [];
  const result = await mod.songList.search(text, page, limit);
  const list = asRecord(result)?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => toSongList(source, platform, item))
    .filter((item): item is MusicSongListSummary => !!item);
}

// ── 热搜 / 搜索提示 ─────────────────────────────────────────────────

export async function getMusicSdkHotSearch(
  platform: MusicSdkPlatform
): Promise<MusicHotSearchItem[]> {
  const mod = plat(platform);
  if (!mod?.hotSearch?.getList) return [];
  const result = asRecord(await mod.hotSearch.getList());
  const list = Array.isArray(result?.list) ? result?.list : [];
  return ((list as unknown[]) ?? [])
    .map((kw): MusicHotSearchItem | null => {
      const keyword = typeof kw === "string" ? kw : asString(asRecord(kw)?.name);
      if (!keyword) return null;
      return { keyword, name: keyword, source: platform };
    })
    .filter((item): item is MusicHotSearchItem => !!item);
}

export async function getMusicSdkTipSearch(
  platform: MusicSdkPlatform,
  keyword: string
): Promise<string[]> {
  const mod = plat(platform);
  if (!mod?.tipSearch?.search) return [];
  const result = await mod.tipSearch.search(keyword);
  if (!Array.isArray(result)) return [];
  return result.filter((item): item is string => typeof item === "string");
}

// ── 歌手 / 专辑（仅 tx/wy 经 index 暴露 extendDetail/extendSearch）───

export interface MusicSdkArtist {
  id: string;
  name: string;
  pic?: string;
  source: MusicPlatform;
}

/** 搜歌手（仅 tx/wy）。 */
export async function searchMusicSdkArtists(
  platform: MusicSdkPlatform,
  keyword: string,
  page = 1,
  limit = 20
): Promise<MusicSdkArtist[]> {
  const mod = plat(platform);
  if (!mod?.extendSearch?.searchSinger) return [];
  const result = asRecord(await mod.extendSearch.searchSinger(keyword, page, limit));
  const list = Array.isArray(result?.list) ? result?.list : [];
  return ((list as unknown[]) ?? [])
    .map((item): MusicSdkArtist | null => {
      const row = asRecord(item);
      const id = asString(row?.id) || asString(row?.mid);
      const name = asString(row?.name);
      if (!id || !name) return null;
      return {
        id,
        name,
        pic: asString(row?.picUrl) || asString(row?.img),
        source: platform as MusicPlatform,
      };
    })
    .filter((item): item is MusicSdkArtist => !!item);
}

export interface MusicSdkArtistDetail {
  name: string;
  desc?: string;
  avatar?: string;
  musicSize?: number;
  albumSize?: number;
}

/** 歌手详情（仅 tx/wy）。 */
export async function getMusicSdkArtistDetail(
  platform: MusicSdkPlatform,
  id: string
): Promise<MusicSdkArtistDetail | null> {
  const mod = plat(platform);
  if (!mod?.extendDetail?.getArtistDetail) return null;
  const result = asRecord(await mod.extendDetail.getArtistDetail(id));
  if (!result) return null;
  return {
    name: asString(result.name) || "未知歌手",
    desc: asString(result.desc),
    avatar: asString(result.avatar),
    musicSize: asNumber(result.musicSize),
    albumSize: asNumber(result.albumSize),
  };
}

/** 歌手全部歌曲（仅 tx/wy）。 */
export async function getMusicSdkArtistSongs(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  id: string,
  page = 1,
  order = "hot"
): Promise<MusicSong[]> {
  const mod = plat(platform);
  if (!mod?.extendDetail?.getArtistSongs) return [];
  const result = await mod.extendDetail.getArtistSongs(id, page, 100, order);
  return toSongs(source, platform, asRecord(result)?.list);
}

/** 歌手专辑（仅 tx/wy）→ 歌单卡。 */
export async function getMusicSdkArtistAlbums(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  id: string,
  page = 1
): Promise<MusicSongListSummary[]> {
  const mod = plat(platform);
  if (!mod?.extendDetail?.getArtistAlbums) return [];
  const result = asRecord(await mod.extendDetail.getArtistAlbums(id, page, 50));
  const list = Array.isArray(result?.list) ? result?.list : [];
  return ((list as unknown[]) ?? [])
    .map((item): MusicSongListSummary | null => {
      const row = asRecord(item);
      const albumId = asString(row?.id);
      const name = asString(row?.name);
      if (!albumId || !name) return null;
      return {
        id: albumId,
        name,
        source: platform,
        sourceId: source.id,
        pic: asString(row?.img) || asString(row?.picUrl),
        author: asString(row?.singer),
        total: asNumber(row?.total) ?? undefined,
      };
    })
    .filter((item): item is MusicSongListSummary => !!item);
}

/** 专辑内歌曲（仅 tx/wy）。 */
export async function getMusicSdkAlbumSongs(
  source: MusicSourceDescriptor,
  platform: MusicSdkPlatform,
  id: string
): Promise<MusicSong[]> {
  const mod = plat(platform);
  if (!mod?.extendDetail?.getAlbumSongs) return [];
  const result = await mod.extendDetail.getAlbumSongs(id);
  return toSongs(source, platform, asRecord(result)?.list);
}

// ── 歌词 ───────────────────────────────────────────────────────────

/** 歌词（统一处理 requestObj/.promise 两种返回形态）。返回 {lyric,tlyric,...} 原始对象。 */
export async function getMusicSdkLyric(
  platform: MusicSdkPlatform,
  song: MusicSong
): Promise<{ lyric: string; tlyric?: string; lxlyric?: string }> {
  const mod = plat(platform);
  if (!mod?.getLyric) return { lyric: "" };
  // song.raw 是 SDK 原始歌曲对象（含 songmid 等各平台所需字段）。
  const songInfo = (song.raw && typeof song.raw === "object" ? song.raw : song) as unknown;
  const ret = await mod.getLyric(songInfo);
  // 部分平台返回带 .promise 的 requestObj。
  const resolved = asRecord(ret)?.promise ? await asRecord(ret)!.promise : ret;
  const record = asRecord(resolved);
  return {
    lyric: asString(record?.lyric) || "",
    tlyric: asString(record?.tlyric) || undefined,
    lxlyric: asString(record?.lxlyric) || undefined,
  };
}
