export const UA_CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const UA_CHROME_148 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export const UA_IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export interface BrowserHeadersOptions {
  ua?: string;
  referer?: string;
  origin?: string;
  acceptJson?: boolean;
  acceptHtml?: boolean;
  xhrFlag?: boolean;
}

export function buildBrowserHeaders(
  opts: BrowserHeadersOptions
): Record<string, string> {
  const h: Record<string, string> = {};
  if (opts.ua) h["User-Agent"] = opts.ua;
  if (opts.referer) h["Referer"] = opts.referer;
  if (opts.origin) h["Origin"] = opts.origin;
  h["Accept-Language"] = "en-US,en;q=0.9";
  if (opts.acceptJson) {
    h["Accept"] = "application/json, text/plain, */*";
  } else if (opts.acceptHtml) {
    h["Accept"] =
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  } else {
    h["Accept"] = "*/*";
  }
  if (opts.xhrFlag) h["X-Requested-With"] = "XMLHttpRequest";
  return h;
}
