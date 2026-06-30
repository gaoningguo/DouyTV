import { useEffect, useState } from "react";
import {
  getLxComments,
  getNeteaseComments,
  getNeteasePersonalized,
  getNeteaseSimiSongs,
  getNeteaseSongWiki,
  type MusicSong,
  type MusicSongListSummary,
  type MusicSourceDescriptor,
  type NeteaseComment,
} from "@/lib/music";
import { CoverArt } from "./ui";

type ExtrasTab = "comments" | "similar" | "wiki" | "recommend";

type WikiBlock = { title?: string; text: string };

const TABS: Array<{ id: ExtrasTab; label: string }> = [
  { id: "comments", label: "评论" },
  { id: "similar", label: "相似" },
  { id: "wiki", label: "百科" },
  { id: "recommend", label: "推荐歌单" },
];

/**
 * 播放页「更多」面板：评论 / 相似歌曲 / 推荐歌单。仅在存在网易源时挂载。
 * 内置源匿名只通评论 + 推荐列表；相似/歌单载入需自部署 NeteaseCloudMusicApi（反爬）。
 */
export function SongExtrasPanel({
  song,
  source,
  lxSource,
  onPlaySong,
  onOpenPlaylist,
}: {
  song: MusicSong | null;
  source: MusicSourceDescriptor | null;
  /** 当前歌曲所属的 LX 源（存在且歌曲属于它时，评论走 getLxComments）。 */
  lxSource?: MusicSourceDescriptor | null;
  onPlaySong: (song: MusicSong) => void;
  onOpenPlaylist: (summary: MusicSongListSummary) => void;
}) {
  const [tab, setTab] = useState<ExtrasTab>("comments");
  const [comments, setComments] = useState<NeteaseComment[]>([]);
  const [commentPage, setCommentPage] = useState(1);
  const [commentHasMore, setCommentHasMore] = useState(false);
  const [commentLoadingMore, setCommentLoadingMore] = useState(false);
  const [similar, setSimilar] = useState<MusicSong[]>([]);
  const [wiki, setWiki] = useState<WikiBlock[]>([]);
  const [recommend, setRecommend] = useState<MusicSongListSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const builtin = source?.kind === "netease-api" && source.neteaseMode !== "external";
  const songId = song?.platform === "wy" ? song.id : "";
  // 当前歌曲属于某个 LX 源时，评论改用 LX 服务端（getLxComments），覆盖非网易平台歌曲。
  const lxCommentSource =
    lxSource && song && song.sourceId === lxSource.id ? lxSource : null;

  useEffect(() => {
    if (!source && !lxCommentSource) return;
    let cancelled = false;
    setError(null);
    // 推荐歌单与歌曲无关，只取一次；评论/相似随歌曲变。
    if (tab === "recommend") {
      if (!source || recommend.length > 0) return;
    } else if (tab === "comments") {
      // LX 评论靠歌曲本身（song.raw）即可，不要求 wy songId。
      if (!songId && !lxCommentSource) return;
    } else if (!source || !songId) {
      return;
    }
    setLoading(true);
    (async () => {
      try {
        if (tab === "comments") {
          if (lxCommentSource && song) {
            const list = await getLxComments(lxCommentSource, song, "hot", 1);
            if (!cancelled) {
              setComments(
                list.map((c) => ({
                  id: c.id,
                  nickname: c.nickname,
                  avatar: c.avatar,
                  content: c.content,
                  liked: c.liked,
                  timeText: c.timeText,
                  hot: c.hot,
                  replyCount: 0,
                }))
              );
              setCommentPage(1);
              setCommentHasMore(false);
            }
          } else {
            const res = await getNeteaseComments(source!, songId, 1);
            if (!cancelled) {
              setComments(res.list);
              setCommentPage(1);
              setCommentHasMore(res.hasMore);
            }
          }
        } else if (tab === "similar") {
          const list = await getNeteaseSimiSongs(source!, songId);
          if (!cancelled) setSimilar(list);
        } else if (tab === "wiki") {
          const res = await getNeteaseSongWiki(source!, songId);
          if (!cancelled) setWiki(res.blocks);
        } else {
          const list = await getNeteasePersonalized(source!, 12);
          if (!cancelled) setRecommend(list);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, songId, source?.id, lxCommentSource?.id, song?.id]);

  // 评论「加载更多」：翻下一页追加去重。
  const loadMoreComments = async () => {
    if (!source || !songId || commentLoadingMore) return;
    setCommentLoadingMore(true);
    try {
      const next = commentPage + 1;
      const res = await getNeteaseComments(source, songId, next);
      setComments((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...res.list.filter((c) => !seen.has(c.id))];
      });
      setCommentPage(next);
      setCommentHasMore(res.hasMore);
    } catch {
      setCommentHasMore(false);
    } finally {
      setCommentLoadingMore(false);
    }
  };

  if (!source && !lxCommentSource) {
    return (
      <div className="music-extras-empty">
        未安装网易源，无法加载评论 / 相似 / 推荐。可在「音乐源」里添加网易内置源。
      </div>
    );
  }

  return (
    <div className="music-extras">
      <div className="music-extras-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={tab === t.id ? "is-active" : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="music-extras-body">
        {loading ? (
          <div className="music-extras-empty">加载中…</div>
        ) : error ? (
          <div className="music-extras-empty">{error}</div>
        ) : tab === "comments" ? (
          comments.length === 0 ? (
            <div className="music-extras-empty">暂无评论</div>
          ) : (
            <ul className="music-comment-list">
              {comments.map((c) => (
                <li key={c.id} className="music-comment">
                  {c.avatar ? (
                    <img src={c.avatar} alt="" className="music-comment-avatar" loading="lazy" />
                  ) : (
                    <span className="music-comment-avatar music-comment-avatar-fallback">
                      {c.nickname.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="music-comment-name">{c.nickname}</span>
                      {c.hot && <span className="music-comment-hot">热评</span>}
                      {c.liked > 0 && (
                        <span className="music-comment-liked">♥ {c.liked}</span>
                      )}
                    </div>
                    <p className="music-comment-content">{c.content}</p>
                    {c.repliedContent && (
                      <p className="music-comment-replied">
                        {c.repliedNickname && (
                          <span className="music-comment-replied-name">@{c.repliedNickname}：</span>
                        )}
                        {c.repliedContent}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      {c.timeText && <span className="music-comment-time">{c.timeText}</span>}
                      {c.replyCount > 0 && (
                        <span className="music-comment-replies">{c.replyCount} 条回复</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {commentHasMore && (
                <li className="music-comment-more">
                  <button
                    type="button"
                    onClick={() => void loadMoreComments()}
                    disabled={commentLoadingMore}
                    className="h-9 px-4 rounded-lg text-xs tap disabled:opacity-45"
                    style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                  >
                    {commentLoadingMore ? "加载中…" : "加载更多评论"}
                  </button>
                </li>
              )}
            </ul>
          )
        ) : tab === "similar" ? (
          similar.length === 0 ? (
            <div className="music-extras-empty">
              {builtin
                ? "内置源受网易反爬限制，相似歌曲需在「音乐源」添加自部署 NeteaseCloudMusicApi。"
                : "暂无相似歌曲"}
            </div>
          ) : (
            <ul className="music-simi-list">
              {similar.map((s) => (
                <li key={`${s.sourceId}:${s.id}`}>
                  <button type="button" className="music-simi-item tap" onClick={() => onPlaySong(s)}>
                    <CoverArt src={s.cover} title={s.title} size="small" spinning={false} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="music-simi-title">{s.title}</span>
                      <span className="music-simi-artist">{s.artist}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : tab === "wiki" ? (
          !songId ? (
            <div className="music-extras-empty">暂无可查百科的歌曲</div>
          ) : wiki.length === 0 ? (
            <div className="music-extras-empty">
              {builtin
                ? "内置源受网易反爬限制，歌曲百科需在「音乐源」添加自部署 NeteaseCloudMusicApi。"
                : "暂无百科信息"}
            </div>
          ) : (
            <ul className="music-comment-list">
              {wiki.map((b, i) => (
                <li key={i} className="music-comment">
                  <div className="min-w-0 flex-1">
                    {b.title && <span className="music-comment-name">{b.title}</span>}
                    <p className="music-comment-content">{b.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : recommend.length === 0 ? (
          <div className="music-extras-empty">暂无推荐歌单</div>
        ) : (
          <div className="music-recommend-grid">
            {recommend.map((p) => (
              <button
                key={p.id}
                type="button"
                className="music-recommend-card tap"
                onClick={() => onOpenPlaylist(p)}
                title={p.name}
              >
                <CoverArt src={p.pic} title={p.name} size="small" spinning={false} />
                <span className="music-recommend-name">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
