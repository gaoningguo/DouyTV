import crypto from 'crypto'
import { decodeName } from './index'

export const toMD5 = str => crypto.createHash('md5').update(str).digest('hex')


// 浏览器/WebView 无 node `dns` 模块。原逻辑是给 node http.request 做 DNS 缓存的
// lookup 钩子（仅各平台 api-test.js 脚手架引用，运行路径走 request.ts→scriptFetch，
// 不经过这里）。这里 stub 成 no-op / 系统默认解析，去掉 dns 依赖。
export const getHostIp = () => undefined

export const dnsLookup = (hostname, options, callback) => {
  if (typeof options === 'function') callback = options
  // 交给底层默认解析（此钩子在浏览器环境实际不会被调用）。
  callback(null, hostname, 4)
}


/**
 * 格式化歌手
 * @param singers 歌手数组
 * @param nameKey 歌手名键值
 * @param join 歌手分割字符
 */
export const formatSingerName = (singers, nameKey = 'name', join = '、') => {
  if (Array.isArray(singers)) {
    const singer = []
    singers.forEach(item => {
      let name = item[nameKey]
      if (!name) return
      singer.push(name)
    })
    return decodeName(singer.join(join))
  }
  return decodeName(String(singers ?? ''))
}
