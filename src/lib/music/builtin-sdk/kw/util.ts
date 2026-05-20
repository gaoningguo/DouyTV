// @ts-nocheck
/**
 * 酷我音乐 (KW) — util helpers，移植自 lx-music-desktop/.../musicSdk/kw/util.js。
 *
 * 移植说明：原版用了 Node 的 crypto.createCipheriv（AES）和 Buffer，
 * 我们浏览器环境暂不支持 — 仅保留无加密的工具函数（formatSinger / lrcTools 部分）。
 * 加密相关（wbdCrypto / decodeLyric）若未来需要，再用 crypto-js 重写。
 */

export const formatSinger = (rawData: string): string =>
  String(rawData ?? "").replace(/&/g, "、");

export const objStr2JSON = (str: string): unknown => {
  return JSON.parse(
    str.replace(
      /('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g,
      '"'
    )
  );
};

export const lrcTools = {
  rxps: {
    wordLine: /^(\[\d{1,2}:.*\d{1,4}\])\s*(\S+(?:\s+\S+)*)?\s*/,
    tagLine: /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*\]/,
    wordTimeAll: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g,
    wordTime: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/,
  },
};
