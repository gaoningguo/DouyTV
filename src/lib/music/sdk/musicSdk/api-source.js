// ========================================
// 浏览器端版本的 api-source.js（移植自 lxserver 服务端版）
// 原版用 require('../../../server/userApi') 动态加载自定义源解析器；
// 我们前端没有该模块，改成「外部可注入的播放解析器」钩子：
//   - 列表能力（搜索/榜单/歌单/歌词/专辑/热搜）走各平台 index.js，不经此处；
//   - 播放取直链 getMusicUrl 经 apis(source).getMusicUrl → 转发给注入的解析器
//     （洛雪 runtime / OmniParse / TuneHub）。无解析器则抛错提示添加播放源。
// ========================================

import apiSourceInfo from './api-source-info'

const supportQuality = {}
for (const api of apiSourceInfo) {
  supportQuality[api.id] = api.supportQualitys
}

/**
 * 外部注入的播放解析器：(source, songInfo, quality) => Promise<string|{url}>。
 * 由宿主在启用「播放源」时设置；未设置时 getMusicUrl 抛错。
 */
let musicUrlResolver = null

export const registerMusicUrlResolver = (resolver) => {
  musicUrlResolver = resolver
}

const apis = source => {
  return {
    getMusicUrl(songInfo, type) {
      if (!musicUrlResolver) {
        return Promise.reject(
          new Error(`未配置播放解析源（${source}）。请在「音乐源」添加并启用 洛雪脚本 / OmniParse / TuneHub 后再播放。`)
        )
      }
      return Promise.resolve(musicUrlResolver(source, songInfo, type))
    },
  }
}

export { apis, supportQuality }
