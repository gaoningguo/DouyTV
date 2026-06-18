import { type FormEvent } from "react";
import { IconAlbum, IconClose, IconRefresh, IconSearch } from "@/components/Icon";
import {
  type MusicSongListSummary,
  type MusicSongListTag,
  type MusicSourceDescriptor,
} from "@/lib/music";
import { FilterChip, SectionHeader } from "../components/ui";
import { PlaylistGrid } from "../components/SongList";

export function SonglistsView({
  source,
  loading,
  songlists,
  tags,
  sorts,
  selectedTag,
  selectedSort,
  keyword,
  searchResults,
  searching,
  onKeyword,
  onSearch,
  onTag,
  onSort,
  onOpenSonglist,
}: {
  source?: MusicSourceDescriptor;
  loading: boolean;
  songlists: MusicSongListSummary[];
  tags: MusicSongListTag[];
  sorts: MusicSongListTag[];
  selectedTag: string;
  selectedSort: string;
  keyword: string;
  searchResults: MusicSongListSummary[] | null;
  searching: boolean;
  onKeyword: (value: string) => void;
  onSearch: (keyword: string) => void;
  onTag: (tagId: string) => void;
  onSort: (sortId: string) => void;
  onOpenSonglist: (item: MusicSongListSummary) => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(keyword);
  };
  if (!source) {
    return (
      <section className="music-empty-hero h-[64vh] grid place-items-center text-center text-cream-dim">
        <div>
          <IconAlbum size={48} className="mx-auto mb-3 text-cream-faint" />
          <p className="font-display font-semibold">歌单需要 LX Music API Server 源</p>
          <p className="mt-1 text-xs text-cream-faint">
            导入 MoonTV 同款 LX 服务后，歌单浏览与搜索会自动可用。
          </p>
        </div>
      </section>
    );
  }
  const searchMode = searchResults !== null;
  const list = searchMode ? searchResults : songlists;
  return (
    <div className="music-songlists-page space-y-5 pb-4">
      <form onSubmit={submit} className="flex gap-2">
        <label className="search-field-shell music-search-field h-11 flex-1 min-w-0 flex items-center gap-2 px-3">
          <IconSearch size={17} className="text-cream-faint shrink-0" />
          <input
            value={keyword}
            onChange={(event) => onKeyword(event.target.value)}
            placeholder="搜索歌单名称、风格、心情"
            className="search-field-input min-w-0 flex-1 bg-transparent text-sm text-cream placeholder:text-cream-faint"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => {
                onKeyword("");
                onSearch("");
              }}
              className="text-cream-faint hover:text-cream"
              title="清除"
            >
              <IconClose size={15} />
            </button>
          )}
        </label>
        <button type="submit" className="music-search-submit !h-11 !w-11" title="搜索歌单">
          {searching ? <IconRefresh size={17} className="animate-spin" /> : <IconSearch size={17} />}
        </button>
      </form>

      {!searchMode && (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
          <FilterChip active={!selectedTag} onClick={() => onTag("")}>全部</FilterChip>
          {tags.slice(0, 16).map((tag) => (
            <FilterChip key={tag.id} active={selectedTag === tag.id} onClick={() => onTag(tag.id)}>
              {tag.name}
            </FilterChip>
          ))}
          {sorts.slice(0, 4).map((sort) => (
            <FilterChip key={sort.id} active={selectedSort === sort.id} onClick={() => onSort(sort.id)}>
              {sort.name}
            </FilterChip>
          ))}
        </div>
      )}

      <SectionHeader
        title={searchMode ? "歌单搜索结果" : "推荐歌单"}
        meta={list.length > 0 ? `${list.length} 个` : "全源聚合"}
      />

      {loading || searching ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="aspect-[3/4] rounded-lg skeleton-shimmer" />
          ))}
        </div>
      ) : (
        <PlaylistGrid
          items={list}
          onOpen={onOpenSonglist}
          emptyText={searchMode ? "没有找到匹配的歌单" : "暂无推荐歌单"}
        />
      )}
    </div>
  );
}
