export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function readPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, part) => {
    if (!part) return current;
    const record = asRecord(current);
    if (!record) return undefined;
    return record[part];
  }, value);
}

export function unwrapArray<T = unknown>(payload: unknown, path?: string): T[] {
  const direct = readPath(payload, path);
  if (Array.isArray(direct)) return direct as T[];
  const record = asRecord(direct);
  const candidates = [
    record?.list,
    record?.data,
    asRecord(record?.data)?.list,
    asRecord(record?.data)?.data,
    asRecord(record?.result)?.songs,
    asRecord(record?.result)?.list,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as T[];
  }
  return [];
}

export function cleanBaseUrl(baseUrl?: string): string {
  return (baseUrl || "").trim().replace(/\/+$/, "");
}

export function fillTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
  encode = true
): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}|\{([\w.-]+)\}/g, (_, a, b) => {
    const key = String(a || b);
    const raw = vars[key];
    if (raw === undefined) return "";
    const value = String(raw);
    return encode ? encodeURIComponent(value) : value;
  });
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function stableId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(36);
}
