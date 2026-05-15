import type { ScriptDescriptor } from "./types";

/**
 * 内置演示脚本 — 不发起任何网络请求，使用 Google / Mux 的公开测试视频。
 * 用于：
 *  1. 验证 source-script runtime 各 hook 调用链路正确
 *  2. 开发期立即看到 VideoFeed 效果
 *  3. 给用户参考脚本结构
 */
const BUILTIN_DEMO_CODE = `
return {
  meta: { name: '内置演示源', author: 'DouyTV', version: '0.1.0' },

  async getSources(ctx) {
    return [{ id: 'demo', name: '演示源' }];
  },

  async recommend(ctx, { page }) {
    const list = [
      { id: 'bbb', title: 'Big Buck Bunny', year: '2008', desc: 'Blender 经典开源动画', vod_remarks: 'HD' },
      { id: 'ed', title: 'Elephants Dream', year: '2006', desc: 'Blender 早期短片', vod_remarks: 'HD' },
      { id: 'sintel', title: 'Sintel', year: '2010', desc: 'Blender 史诗短片', vod_remarks: 'HD' },
      { id: 'mux-hls', title: 'Mux HLS Test', year: '2024', desc: 'HLS 自适应流测试', vod_remarks: 'HLS' },
      { id: 'apple-hls', title: 'Apple BipBop HLS', year: '2024', desc: 'Apple 官方 HLS 演示', vod_remarks: 'HLS' }
    ];
    return { list, page: page || 1, pageCount: 1, total: list.length };
  },

  async detail(ctx, { id, sourceId }) {
    const urls = {
      'bbb': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      'ed': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      'sintel': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
      'mux-hls': 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      'apple-hls': 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8'
    };
    const titles = {
      'bbb': 'Big Buck Bunny', 'ed': 'Elephants Dream', 'sintel': 'Sintel',
      'mux-hls': 'Mux HLS Test', 'apple-hls': 'Apple BipBop HLS'
    };
    return {
      id,
      title: titles[id] || id,
      year: '',
      desc: '',
      playbacks: [{
        sourceId: sourceId || 'demo',
        sourceName: '演示源',
        episodes: [{ playUrl: urls[id], needResolve: false }],
        episodes_titles: ['完整版']
      }]
    };
  },

  async resolvePlayUrl(ctx, { playUrl }) {
    return {
      url: playUrl,
      type: playUrl.indexOf('.m3u8') >= 0 ? 'hls' : 'mp4',
      headers: {}
    };
  }
};
`;

export const BUILTIN_SCRIPTS: ScriptDescriptor[] = [
  {
    key: "builtin-demo",
    name: "内置演示源",
    description: "使用公开测试视频（mp4 + HLS）的脚本，无需网络请求即可工作",
    enabled: true,
    code: BUILTIN_DEMO_CODE,
    installedAt: 0,
  },
];
