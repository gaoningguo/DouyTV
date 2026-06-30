/**
 * musicSdk 依赖的工具函数（其内部 import 自 `../index`）。
 * 原样移植自 lxserver `src/modules/utils/index.js`，外加 musicSdk/utils.js 用到的 toMD5。
 * 不改 SDK 源码：musicSdk 各文件的 `import ... from '../../index'` 由
 * tsconfig/vite alias 指到本文件（见下方接线说明）。
 */
import CryptoJS from "crypto-js";

export const sizeFormate = (size: number): string => {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const number = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`;
};

const numFix = (n: number): string => (n < 10 ? `0${n}` : n.toString());

// 基础 HTML 实体解码（对齐 lxserver 服务端实现）。
export const decodeName = (str: string | null = ""): string => {
  if (!str) return "";
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return str.replace(/&[a-zA-Z]+;/g, (match) => entities[match] || match);
};

export const formatPlayTime = (time: number): string => {
  const m = Math.trunc(time / 60);
  const s = Math.trunc(time % 60);
  return m === 0 && s === 0 ? "--/--" : numFix(m) + ":" + numFix(s);
};

export const dateFormat = (_date: number | string | Date, format = "Y-M-D h:m:s"): string => {
  const date = new Date(_date);
  if (!date) return "";
  return format
    .replace("Y", date.getFullYear().toString())
    .replace("M", numFix(date.getMonth() + 1))
    .replace("D", numFix(date.getDate()))
    .replace("h", numFix(date.getHours()))
    .replace("m", numFix(date.getMinutes()))
    .replace("s", numFix(date.getSeconds()));
};

export const dateFormat2 = (time: number): string => {
  const differ = Math.trunc((Date.now() - time) / 1000);
  if (differ < 60) return differ + "秒前";
  if (differ < 3600) return Math.trunc(differ / 60) + "分钟前";
  if (differ < 86400) return Math.trunc(differ / 3600) + "小时前";
  return dateFormat(time);
};

export const formatPlayCount = (num: number): string | number => {
  if (num > 100000000) return parseInt(String(num / 10000000)) / 10 + "亿";
  if (num > 10000) return parseInt(String(num / 1000)) / 10 + "万";
  return num;
};

// musicSdk/utils.js 用 crypto.createHash('md5')，浏览器端用 crypto-js 等价实现。
export const toMD5 = (str: string): string =>
  CryptoJS.MD5(str).toString(CryptoJS.enc.Hex);
