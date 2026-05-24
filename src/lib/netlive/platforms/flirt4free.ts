/**
 * Flirt4Free (flirt4free.com) —— 美国老牌成人 cam。
 *
 * 真实 API(2026-05 curl 验证,匿名免登):
 *
 *   - 列表:GET https://www.flirt4free.com/ (主页 HTML)
 *     嵌入 `window.__homePageData__ = { 'models': [...], ... };`(JS 对象字面量,
 *     注意 key 用单引号)。models 数组里每个项是 JSON 对象,含:
 *       model_id, model_seo_name, model_name, display, age, location,
 *       category_name, sample_image_id, sample_long_id, languages,
 *       room_status_char ("O"=Open / 其他=非公开), is_hls...
 *
 *   - 拉流:GET /ws/chat/get-stream-urls.php?model_id={id}
 *     返 { code: 0, data: { hls: [{name, url:"//hls.vscdns.com/manifest.m3u8?key=nil&provider=cdn5&model_id=X"}], ... } }
 *     code=44 表示不存在,code=0 + hls[].url 是 protocol-relative。
 *
 *   - 缩略图:`https://imagesgs.flirt4free.com/photos/i/{sample_long_id}_h.jpg`
 *     sample_long_id 形如 "004/690/4690020/4690020"。
 *
 *   - roomId 用 model_seo_name(slug)。
 *
 *   - 主页 HTML 用 BeautifulSoup 风格解析麻烦,我们用 StreaMonitor 的 trick:
 *     从 `window.__homePageData__ = ` 起始,find first `[` (= models 数组开头),
 *     find ',\n' (= 数组结束),再 rfind ',' 去掉 trailing comma,加 `]` 收尾。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("flirt4free");
import type {
  NetLiveAdapter,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.flirt4free.com/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface F4FModel {
  model_id?: string;
  model_seo_name?: string;
  model_name?: string;
  display?: string;
  age?: string;
  location?: string;
  category_name?: string;
  sample_image_id?: string;
  sample_long_id?: string;
  languages?: string;
  room_status_char?: string; // "O" = Open
  is_hls?: string; // "1" = HLS available
}

interface F4FStreamResp {
  code?: number;
  data?: {
    hls?: Array<{ name?: string; url?: string }>;
  };
}

// model_id → model_seo_name cache,resolve 时少一次 HTML 拉
const modelIdCache = new Map<string, string>(); // seo_name → model_id

function parseModels(html: string): F4FModel[] {
  const needle = "window.__homePageData__ = ";
  const start = html.indexOf(needle);
  if (start === -1) return [];
  const after = html.slice(start + needle.length);
  // 第一个 [ 是 'models': [...] 的起始
  const arrStart = after.indexOf("[");
  if (arrStart === -1) return [];
  // 找 `],\n` —— models 数组的结束(后面跟 ,\n 是 JS 对象下一字段)
  const arrEnd = after.indexOf("],\n", arrStart);
  if (arrEnd === -1) return [];
  // 截取 `[...]`,无条件去掉最后一个对象后的 trailing comma
  // (HTML 实际形态:`{...},    ]`,逗号跟 ] 之间可能有任意空白,旧的 off-by-one 守卫
  // 会让该 trailing comma 漏掉,JSON.parse 失败返 [] —— 列表全空的根因)
  const slice = after.slice(arrStart, arrEnd + 1).replace(/,\s*]\s*$/, "]");
  try {
    return JSON.parse(slice) as F4FModel[];
  } catch (e) {
    console.warn("[flirt4free] parseModels JSON.parse 失败", e);
    return [];
  }
}

function thumb(m: F4FModel): string | undefined {
  if (!m.sample_long_id) return undefined;
  // 2026-05:F4F 缩略图迁到 vscdns.com CDN(跟拉流同一家 VS Media)。
  // 旧 URL `https://imagesgs.flirt4free.com/photos/i/{id}_h.jpg` 仍然存活但很多 model
  // 已不再生成 _h.jpg,只有新 webp。新格式:`cdn5.vscdns.com/images/models/webp/s/640x480/imgid/{long_id}.webp`
  // sample_long_id 形如 `004/672/4672339/4672339`(路径前缀 + ID),直接拼即可。
  return `https://cdn5.vscdns.com/images/models/webp/s/640x480/imgid/${m.sample_long_id}.webp`;
}

function mapRoom(m: F4FModel): NetLiveRoom | undefined {
  const slug = m.model_seo_name;
  if (!slug) return undefined;
  if (m.model_id) modelIdCache.set(slug, m.model_id);
  return {
    platform: "flirt4free",
    roomId: slug,
    title: m.display || m.model_name || slug,
    uname: m.display || m.model_name || slug,
    cover: thumb(m),
    online: 0,
    category: m.category_name,
    live: m.room_status_char === "O",
    link: `https://www.flirt4free.com/?model=${encodeURIComponent(slug)}`,
  };
}

async function fetchHomepage(): Promise<F4FModel[]> {
  const res = await scriptFetch("https://www.flirt4free.com/", {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 30_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Flirt4Free HTTP ${res.status}`);
  const html = await res.text();
  return parseModels(html);
}

// 主页 1.15MB,每翻一页都拉就是 slug 列表场景的"自残"。
// cache 60s,跟列表自然刷新节奏对齐,翻页/搜索/分类共享同一份。
let homepageCache: { models: F4FModel[]; ts: number } | null = null;
const HOMEPAGE_CACHE_TTL = 60_000;

async function fetchHomepageCached(): Promise<F4FModel[]> {
  const now = Date.now();
  if (homepageCache && now - homepageCache.ts < HOMEPAGE_CACHE_TTL) {
    return homepageCache.models;
  }
  const arr = await fetchHomepage();
  homepageCache = { models: arr, ts: now };
  return arr;
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const arr = await fetchHomepageCached();
  // F4F 主页一次返 ~239 个 model,本地按 page*pageSize 切片做假分页
  const mapped = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize;
  return {
    list: mapped.slice(from, to),
    hasMore: to < mapped.length,
  };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  page: number,
  pageSize: number = 30,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const arr = await fetchHomepageCached();
  const kw = keyword.toLowerCase();
  const matched = arr
    .filter((m) =>
      (m.model_seo_name ?? "").toLowerCase().includes(kw) ||
      (m.display ?? "").toLowerCase().includes(kw) ||
      (m.model_name ?? "").toLowerCase().includes(kw) ||
      (m.category_name ?? "").toLowerCase().includes(kw),
    )
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize;
  return {
    list: matched.slice(from, to),
    hasMore: to < matched.length,
  };
}

/* ─────────────── resolve ─────────────── */

async function resolveModelId(slug: string): Promise<string | null> {
  const cached = modelIdCache.get(slug);
  if (cached) return cached;
  // 优先用 ws.vs3.com 的轻量端点(<300B 响应,~200ms),避免拉 1.15MB 主页
  try {
    const res = await scriptFetch(
      `https://ws.vs3.com/rooms/check-model-status.php?model_name=${encodeURIComponent(slug)}`,
      {
        method: "GET",
        headers: {
          ...COMMON_HEADERS,
          Accept: "application/json, text/plain, */*",
        },
        timeout: 10_000,
        http2: true,
      },
    );
    if (res.ok) {
      const j = await res.json<{ status?: string; model_id?: number | string }>();
      if (j.model_id) {
        const id = String(j.model_id);
        modelIdCache.set(slug, id);
        return id;
      }
    }
  } catch (e) {
    console.warn("[flirt4free] check-model-status 失败,fallback 主页解析", e);
  }
  // fallback:拉主页解析 models 找 slug(用 cache,跟列表共享)
  const arr = await fetchHomepageCached();
  for (const m of arr) {
    if (m.model_seo_name === slug && m.model_id) {
      modelIdCache.set(slug, m.model_id);
      return m.model_id;
    }
  }
  return null;
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const modelId = await resolveModelId(roomId);
  if (!modelId) throw new Error(`Flirt4Free 未找到主播 ${roomId}`);
  const res = await scriptFetch(
    `https://www.flirt4free.com/ws/chat/get-stream-urls.php?model_id=${modelId}`,
    {
      method: "GET",
      headers: {
        ...COMMON_HEADERS,
        Accept: "application/json, text/plain, */*",
        Referer: `https://www.flirt4free.com/?model=${encodeURIComponent(roomId)}`,
      },
      timeout: 25_000,
      http2: true,
    },
  );
  if (!res.ok) throw new Error(`Flirt4Free stream HTTP ${res.status}`);
  const data = await res.json<F4FStreamResp>();
  if (data.code === 44) throw new Error(`Flirt4Free 主播 ${roomId} 不存在`);
  if (data.code !== 0) throw new Error(`Flirt4Free 拉流失败 code=${data.code}`);
  const hls = data.data?.hls?.[0]?.url;
  if (!hls) throw new Error(`Flirt4Free 无 HLS 流`);
  const fullUrl = hls.startsWith("//") ? `https:${hls}` : hls;
  return {
    url: fullUrl,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const flirt4freeAdapter: NetLiveAdapter = {
  platform: "flirt4free",
  getRecommend,
  search,
  resolve,
};
