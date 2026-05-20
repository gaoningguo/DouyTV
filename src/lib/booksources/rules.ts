/**
 * Legado 风格规则解析引擎（增强版）。
 *
 * 支持的规则形态：
 *   - `css:selector@attr`            —— CSS 选择器 + 属性 (text/html/src/href/data-*)
 *   - `css:selector`                 —— 默认 @text
 *   - `class:foo` / `id:foo` / `tag:div`  —— CSS 别名
 *   - `xpath://tag` / `xpath://*[...]` —— 简化 XPath（最常见 `//tag` 与基本 `[@attr=...]`）
 *   - `$.json.path`                  —— JsonPath，简版（支持 `.`, `[i]`, `[*]`, 字符串 key）
 *   - `text`                         —— 字面量
 *   - `R1 || R2`                     —— 备用：R1 拿不到时用 R2
 *
 * 增强：
 *   - `RULE@js:CODE`                 —— 先按 RULE 拿到 `result`，再执行 JS（`result/baseUrl/vars/java/Base64` 可用）
 *   - `@js:CODE`                     —— 纯 JS 规则（`result=""`）
 *   - `@put:{k1:rule1,k2:rule2}`     —— 评估子规则并写入 vars（legado 同名语法）
 *   - `@get:{k}`                     —— 在规则字符串里替换为 vars[k]（URL 拼接、链式请求常用）
 *   - `##regex##repl##regex2##repl2##`  —— 末尾后处理；可重复（兼容 legado `replaceRegex`）
 *
 * 仍不支持：
 *   - `java.ajax(url)` 同步网络调用 —— JS 异步生态做不到同步 XHR，由调用方在外部预拉好放进 vars
 *   - 复杂 XPath（如 `following-sibling::`、`text()`、谓词嵌套）
 *
 * 安全提示：
 *   `@js:` 规则在 `new Function` 沙盒里跑，**能访问 globalThis**（视频 source-script 同款）。
 *   导入第三方 legado 源时 UI 必须警示用户。
 */
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";

// cheerio v1 把 AnyNode 类型藏在 domhandler 里（peer dep，pnpm 严格解析下不直接可见）。
// 这里用一个开放的占位 —— 实际是 domhandler 的 AnyNode (Document/Element/Text 等联合)，
// 我们对节点的访问全走 cheerio API，没有直接读底层字段，any 安全。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/* ───────────────── VarBag —— @put/@get 用的临时变量袋 ───────────────── */

export class VarBag {
  private m = new Map<string, string>();
  get(k: string): string {
    return this.m.get(k) ?? "";
  }
  set(k: string, v: string): void {
    this.m.set(k, v);
  }
  has(k: string): boolean {
    return this.m.has(k);
  }
  all(): Record<string, string> {
    return Object.fromEntries(this.m);
  }
}

/* ───────────────── RuleContext ───────────────── */

export type RuleContext =
  | {
      kind: "html";
      $: cheerio.CheerioAPI;
      root: Cheerio<AnyNode>;
      vars: VarBag;
      baseUrl: string;
    }
  | {
      kind: "json";
      data: unknown;
      vars: VarBag;
      baseUrl: string;
    };

export interface MakeCtxOpts {
  vars?: VarBag;
  baseUrl?: string;
}

export function makeHtmlContext(html: string, opts: MakeCtxOpts = {}): RuleContext {
  const $ = cheerio.load(html);
  return {
    kind: "html",
    $,
    root: $.root(),
    vars: opts.vars ?? new VarBag(),
    baseUrl: opts.baseUrl ?? "",
  };
}

export function makeJsonContext(text: string, opts: MakeCtxOpts = {}): RuleContext {
  try {
    return {
      kind: "json",
      data: JSON.parse(text),
      vars: opts.vars ?? new VarBag(),
      baseUrl: opts.baseUrl ?? "",
    };
  } catch {
    return {
      kind: "json",
      data: null,
      vars: opts.vars ?? new VarBag(),
      baseUrl: opts.baseUrl ?? "",
    };
  }
}

/**
 * 自动判断输入是 HTML 还是 JSON。
 * 启发：开头是 `<` → HTML；`{` 或 `[` → JSON。
 */
export function makeContext(text: string, opts: MakeCtxOpts = {}): RuleContext {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) return makeHtmlContext(text, opts);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return makeJsonContext(text, opts);
  }
  // 兜底当 HTML
  return makeHtmlContext(text, opts);
}

/* ───────────────── 公共 API：extract / extractList / select scope ───────────────── */

/** 应用规则，返回单字符串（多个匹配时取第一个 join 后） */
export function extract(rule: string | undefined, ctx: RuleContext): string {
  if (!rule) return "";
  // 1. 处理 @put: 指令（副作用：写入 vars，从规则中移除）
  let r = processPutDirectives(rule, ctx);
  // 2. 替换 @get:{k} 为 vars[k]
  r = applyGetTokens(r, ctx.vars);
  if (!r.trim()) return "";
  // 3. 按 `||` 拆备用分支
  const alts = splitTopLevel(r, "||");
  for (const alt of alts) {
    const v = extractAlternative(alt.trim(), ctx);
    if (v) return v;
  }
  return "";
}

/** 应用规则，返回字符串数组（用于 chapterList / bookList 等） */
export function extractList(rule: string | undefined, ctx: RuleContext): string[] {
  if (!rule) return [];
  let r = processPutDirectives(rule, ctx);
  r = applyGetTokens(r, ctx.vars);
  if (!r.trim()) return [];
  const alts = splitTopLevel(r, "||");
  for (const alt of alts) {
    const v = extractListAlternative(alt.trim(), ctx);
    if (v.length > 0) return v;
  }
  return [];
}

/** 应用规则到一个子节点上下文（用于 bookList 内逐条提取） */
export function extractInScope(
  rule: string | undefined,
  scope: cheerio.CheerioAPI | unknown,
  $: cheerio.CheerioAPI | null,
  vars: VarBag,
  baseUrl: string
): string {
  if (!rule) return "";
  if ($) {
    const subCtx: RuleContext = {
      kind: "html",
      $,
      root: scope as Cheerio<AnyNode>,
      vars,
      baseUrl,
    };
    return extract(rule, subCtx);
  }
  return extract(rule, { kind: "json", data: scope, vars, baseUrl });
}

/** 应用 @get:{k} 替换 —— URL 模板里也常用 */
export function applyGetTokens(s: string, vars: VarBag): string {
  return s.replace(/@get:\{\s*([^}]+?)\s*\}/g, (_, k) => vars.get(String(k).trim()));
}

/* ───────────────── 内部：单 alternative 抽取 ───────────────── */

function extractAlternative(rule: string, ctx: RuleContext): string {
  // 按 @js: 拆 pipeline
  const stages = splitTopLevel(rule, "@js:");
  let value: string;
  if (stages[0] && stages[0].trim()) {
    value = extractOneSingle(stages[0].trim(), ctx);
  } else {
    value = "";
  }
  for (let i = 1; i < stages.length; i++) {
    value = runJsStage(stages[i], value, ctx);
  }
  return value;
}

function extractListAlternative(rule: string, ctx: RuleContext): string[] {
  const stages = splitTopLevel(rule, "@js:");
  // 第一段是 selector / json path —— 拿到 list
  let list: string[];
  if (stages[0] && stages[0].trim()) {
    list = extractListSingle(stages[0].trim(), ctx);
  } else {
    list = [];
  }
  // 后续 @js: 对每个元素跑
  for (let i = 1; i < stages.length; i++) {
    list = list
      .map((item) => runJsStage(stages[i], item, ctx))
      .filter((s) => s.length > 0);
  }
  return list;
}

function extractOneSingle(rule: string, ctx: RuleContext): string {
  const { rule: pure, replace } = splitPostProcess(rule);
  if (!pure) return "";
  let v: string;
  if (ctx.kind === "html") {
    v = extractHtmlOne(pure, ctx.$, ctx.root);
  } else {
    v = extractJsonOne(pure, ctx.data);
  }
  return applyReplaceChain(v, replace);
}

function extractListSingle(rule: string, ctx: RuleContext): string[] {
  const { rule: pure, replace } = splitPostProcess(rule);
  if (!pure) return [];
  let list: string[];
  if (ctx.kind === "html") {
    list = extractHtmlList(pure, ctx.$, ctx.root);
  } else {
    list = extractJsonList(pure, ctx.data);
  }
  if (!replace) return list;
  return list.map((v) => applyReplaceChain(v, replace));
}

/* ───────────────── @js: 沙盒 ───────────────── */

function runJsStage(code: string, result: string, ctx: RuleContext): string {
  const java = {
    put: (k: string, v: unknown) => {
      ctx.vars.set(String(k), v == null ? "" : String(v));
      return v;
    },
    get: (k: string) => ctx.vars.get(String(k)),
    log: (...args: unknown[]) => console.log("[rule.js]", ...args),
    /** 异步 ajax 在同步规则里做不到 —— 这里只回空串；调用方应在外部预拉数据后用 @put 注入 */
    ajax: (_url: string) => "",
    /** legado `java.urlEncode` */
    urlEncode: (s: string, _enc?: string) => encodeURIComponent(String(s)),
    urlDecode: (s: string) => decodeURIComponent(String(s)),
    timeFormat: (ts: number) => new Date(ts).toISOString(),
    now: () => Date.now(),
    /** 简单的 string parse */
    toString: (v: unknown) => (v == null ? "" : String(v)),
  };
  const Base64 = {
    encode: (s: string) => {
      try {
        return btoa(unescape(encodeURIComponent(String(s))));
      } catch {
        return "";
      }
    },
    decode: (s: string) => {
      try {
        return decodeURIComponent(escape(atob(String(s))));
      } catch {
        return "";
      }
    },
  };
  try {
    // legado 风格：JS 体里没有显式 return 时，最后表达式即返回值。
    // 这里用 `return (function(){ ... })()` 包一层，让用户既可以 return 也可以靠最后表达式。
    // 启发：检测 `return ` 显式存在则原样跑，否则给末尾追加 `;return result;`
    const body = /return\s+/.test(code) ? code : `${code};return result;`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      "result",
      "baseUrl",
      "vars",
      "java",
      "Base64",
      '"use strict";\n' + body
    );
    const out = fn(result, ctx.baseUrl, ctx.vars.all(), java, Base64);
    if (out === undefined || out === null) return "";
    return String(out);
  } catch (e) {
    console.warn("[rule.js] eval failed:", (e as Error).message, "code:", code);
    return result;
  }
}

/* ───────────────── @put: 指令 ───────────────── */

function processPutDirectives(rule: string, ctx: RuleContext): string {
  // 匹配 `@put:{k:rule[,k2:rule2]}`，可能出现多次
  const re = /@put:\{([^}]+)\}/g;
  return rule.replace(re, (_, body: string) => {
    const pairs = splitTopLevel(body, ",");
    for (const p of pairs) {
      const colonIdx = p.indexOf(":");
      if (colonIdx < 0) continue;
      const k = p.slice(0, colonIdx).trim();
      const r = p.slice(colonIdx + 1).trim();
      const v = extract(r, ctx);
      ctx.vars.set(k, v);
    }
    return "";
  });
}

/* ───────────────── ##regex##repl## 后处理 ───────────────── */

function splitPostProcess(rule: string): { rule: string; replace?: string } {
  // 末尾 `##regex##replacement##` 可重复 —— 但不应吞掉 `@js:` 内的 ##
  const idx = rule.indexOf("##");
  if (idx < 0) return { rule };
  return { rule: rule.slice(0, idx).trim(), replace: rule.slice(idx).trim() };
}

function applyReplaceChain(value: string, replace?: string): string {
  if (!replace || !value) return value;
  const segments = replace.split("##").filter((s) => s.length > 0);
  let out = value;
  for (let i = 0; i + 1 <= segments.length; i += 2) {
    const pattern = segments[i];
    const repl = segments[i + 1] ?? "";
    if (!pattern) continue;
    try {
      out = out.replace(new RegExp(pattern, "g"), repl);
    } catch {
      /* invalid regex */
    }
  }
  return out;
}

/* ───────────────── 安全的 top-level 拆分 ───────────────── */

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      continue;
    }
    if (depth === 0 && c === sep[0] && s.startsWith(sep, i)) {
      parts.push(s.slice(last, i));
      last = i + sep.length;
      i += sep.length - 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

/* ───────────────── HTML / cheerio 提取 ───────────────── */

function htmlSelectorFromRule(rule: string): { selector: string; attr: string } {
  let r = rule;
  if (r.startsWith("css:")) r = r.slice(4);
  else if (r.startsWith("class:")) r = "." + r.slice(6);
  else if (r.startsWith("id:")) r = "#" + r.slice(3);
  else if (r.startsWith("tag:")) r = r.slice(4);
  else if (r.startsWith("xpath:")) {
    r = xpathToCss(r.slice(6));
  }
  const at = r.lastIndexOf("@");
  if (at > 0 && /^[a-zA-Z][\w-]*$/.test(r.slice(at + 1))) {
    return { selector: r.slice(0, at), attr: r.slice(at + 1) };
  }
  return { selector: r, attr: "text" };
}

/** 把常见 XPath 模式翻译成 cheerio 可用的 CSS 选择器（best-effort，非全功能） */
function xpathToCss(xp: string): string {
  let s = xp.trim();
  // `//tag` → `tag`；`/tag` → `> tag` 让 find() 当后代选
  s = s.replace(/^\/\//, "").replace(/^\//, "");
  // `[@class="x"]` → `[class="x"]`，`@attr` → `attr`
  s = s.replace(/\[@([a-zA-Z_-]+)/g, "[$1");
  // `/` 路径分隔符 → ` ` (后代) 简化
  s = s.replace(/\//g, " ");
  // `text()` 没法直接转 CSS —— 留个 `@text` 占位让上层 attr 处理
  if (/text\(\)$/.test(s)) {
    s = s.replace(/text\(\)$/, "").trim();
    return `${s}@text`;
  }
  return s.trim();
}

function readNodeAttr(el: Cheerio<AnyNode>, attr: string): string {
  if (attr === "text") return el.text().trim();
  if (attr === "html") return el.html() ?? "";
  if (attr === "ownText") {
    return el
      .contents()
      .filter((_, n) => n.type === "text")
      .text()
      .trim();
  }
  if (attr === "textNodes") {
    // legado 兼容：取所有直接 text node 用 \n join
    return el
      .contents()
      .filter((_, n) => n.type === "text")
      .map((_, n) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = (n as any).data ?? "";
        return String(t).trim();
      })
      .get()
      .filter((s) => s.length > 0)
      .join("\n");
  }
  return el.attr(attr) ?? "";
}

function extractHtmlOne(
  rule: string,
  _$: cheerio.CheerioAPI,
  root: Cheerio<AnyNode>
): string {
  const { selector, attr } = htmlSelectorFromRule(rule);
  if (!selector) return "";
  const node = root.find(selector).first();
  if (node.length === 0) return "";
  return readNodeAttr(node, attr);
}

function extractHtmlList(
  rule: string,
  $: cheerio.CheerioAPI,
  root: Cheerio<AnyNode>
): string[] {
  const { selector, attr } = htmlSelectorFromRule(rule);
  if (!selector) return [];
  const out: string[] = [];
  root.find(selector).each((_, el) => {
    out.push(readNodeAttr($(el), attr));
  });
  return out;
}

/** 在 HTML 上下文里，按 bookList 选择器返回每条结果的 sub-ctx（让上层逐字段提取） */
export function htmlSelectScope(
  rule: string,
  $: cheerio.CheerioAPI,
  root: Cheerio<AnyNode>,
  vars: VarBag
): Array<Cheerio<AnyNode>> {
  // 先消化 @put: / @get:
  let r = processPutDirectives(rule, {
    kind: "html",
    $,
    root,
    vars,
    baseUrl: "",
  });
  r = applyGetTokens(r, vars);
  const { selector } = htmlSelectorFromRule(r);
  if (!selector) return [];
  const out: Array<Cheerio<AnyNode>> = [];
  root.find(selector).each((_, el) => {
    out.push($(el));
  });
  return out;
}

/* ───────────────── JSON / JsonPath（简版） ───────────────── */

function jsonPath(data: unknown, path: string): unknown[] {
  if (data === null || data === undefined) return [];
  const tokens: string[] = [];
  let i = 0;
  const p = path.replace(/^\$\.?/, "");
  while (i < p.length) {
    const c = p[i];
    if (c === ".") {
      i++;
      continue;
    }
    if (c === "[") {
      const end = p.indexOf("]", i);
      if (end < 0) break;
      tokens.push(p.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < p.length && p[j] !== "." && p[j] !== "[") j++;
    tokens.push(p.slice(i, j));
    i = j;
  }
  let cursor: unknown[] = [data];
  for (const tk of tokens) {
    const next: unknown[] = [];
    for (const v of cursor) {
      if (tk === "*") {
        if (Array.isArray(v)) next.push(...v);
        else if (v && typeof v === "object") next.push(...Object.values(v));
      } else if (/^-?\d+$/.test(tk)) {
        const idx = parseInt(tk, 10);
        if (Array.isArray(v)) {
          const a = idx < 0 ? v.length + idx : idx;
          next.push(v[a]);
        }
      } else {
        if (v && typeof v === "object") {
          next.push((v as Record<string, unknown>)[tk]);
        }
      }
    }
    cursor = next.filter((x) => x !== undefined);
  }
  return cursor;
}

function jsonRule(rule: string): string {
  if (rule.startsWith("json:")) return rule.slice(5);
  return rule;
}

function extractJsonOne(rule: string, data: unknown): string {
  const r = jsonRule(rule);
  if (!r.startsWith("$")) {
    // 字面量
    return r;
  }
  const arr = jsonPath(data, r);
  const v = arr[0];
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function extractJsonList(rule: string, data: unknown): string[] {
  const r = jsonRule(rule);
  if (!r.startsWith("$")) return [];
  return jsonPath(data, r).map((v) =>
    v === undefined || v === null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v)
  );
}

/** 在 JSON 上下文里按 bookList 选择，返回每条 sub-data */
export function jsonSelectScope(
  rule: string,
  data: unknown,
  vars: VarBag
): unknown[] {
  // @put: / @get: 也支持
  let r = processPutDirectives(rule, {
    kind: "json",
    data,
    vars,
    baseUrl: "",
  });
  r = applyGetTokens(r, vars);
  const pure = jsonRule(r);
  if (!pure.startsWith("$")) return [];
  return jsonPath(data, pure);
}
