import { randomBytes } from "node:crypto";

const ACCOUNT_API = "https://api.retiehe.com/backend";
const HOST_API_BASES = [
  "https://api-overseas.retiehe.com/backend",
  "https://api-eo.retiehe.com/backend",
] as const;
const USER_AGENT = `Mozilla/5.0 (${process.platform}) RTHHostHelper/1.0.0`;
const TIMEOUT_MS = 15_000;
const SITE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type RetieheSite = {
  domain: string;
  siteName: string;
  publicUrl: string;
};

export class RetieheApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "RetieheApiError";
    this.status = status;
  }
}

type JsonObject = Record<string, unknown>;

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Accept-Language": "zh-CN",
    "User-Agent": USER_AGENT,
  };
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function redact(text: string, apiKey: string) {
  return text.replaceAll(apiKey, "[已隐藏]").replace(/\s+/g, " ").trim().slice(0, 500);
}

function errorMessage(body: unknown, fallbackText: string, apiKey: string) {
  const object = asObject(body);
  const nestedError = asObject(object?.error);
  const candidate = nestedError?.message ?? object?.message ?? object?.error ?? fallbackText;
  const message = typeof candidate === "string" ? redact(candidate, apiKey) : "未知接口错误";
  return message || "未知接口错误";
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return { body: null, text: "" };
  try {
    return { body: JSON.parse(text) as unknown, text };
  } catch {
    return { body: null, text };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
}

async function getUsername(apiKey: string) {
  if (!apiKey) throw new Error("热铁盒 API Key 为空。");
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${ACCOUNT_API}/api-key-v2/verification?key=${encodeURIComponent(apiKey)}`,
      { headers: headers(apiKey) },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求失败";
    throw new RetieheApiError(`无法验证热铁盒 API Key：${redact(message, apiKey)}`);
  }

  const parsed = await parseResponse(response);
  if (!response.ok) {
    throw new RetieheApiError(
      `热铁盒 API Key 验证失败：${errorMessage(parsed.body, parsed.text, apiKey)}`,
      response.status,
    );
  }

  const username = asObject(parsed.body)?.username;
  if (typeof username !== "string" || !username.trim()) {
    throw new RetieheApiError("热铁盒 API Key 验证成功，但接口未返回账号信息。");
  }
  return username.trim();
}

async function requestHostApi(
  apiKey: string,
  path: string,
  init: RequestInit,
) {
  let lastNetworkError = "";

  for (const base of HOST_API_BASES) {
    try {
      const response = await fetchWithTimeout(`${base}${path}`, {
        ...init,
        headers: { ...headers(apiKey), ...init.headers },
      });
      const parsed = await parseResponse(response);
      if (response.ok) return parsed.body;

      const message = errorMessage(parsed.body, parsed.text, apiKey);
      if (response.status < 500) {
        throw new RetieheApiError(`热铁盒接口请求失败：${message}`, response.status);
      }
      lastNetworkError = `HTTP ${response.status}：${message}`;
    } catch (error) {
      if (error instanceof RetieheApiError) throw error;
      lastNetworkError = redact(error instanceof Error ? error.message : "网络请求失败", apiKey);
    }
  }

  throw new RetieheApiError(`无法连接热铁盒网站服务：${lastNetworkError || "请求失败"}`);
}

function domainFromItem(value: unknown) {
  if (typeof value === "string") return value;
  const object = asObject(value);
  for (const key of ["domain", "site", "name", "hostname"] as const) {
    if (typeof object?.[key] === "string") return object[key] as string;
  }
  return "";
}

function normalizeSite(domain: string, fallbackSiteName?: string): RetieheSite {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const fallback = fallbackSiteName?.trim().toLowerCase() || "";
  const hostname = clean.includes(".") ? clean : `${clean || fallback}.rth1.xyz`;
  const siteName = fallback || (hostname.endsWith(".rth1.xyz") ? hostname.slice(0, -9) : hostname);
  return { domain: hostname, siteName, publicUrl: `https://${hostname}` };
}

export async function listRetieheSites(apiKey: string): Promise<RetieheSite[]> {
  const username = await getUsername(apiKey);
  const body = await requestHostApi(
    apiKey,
    `/host-v3/sites?username=${encodeURIComponent(username)}`,
    { method: "GET" },
  );
  const object = asObject(body);
  const items = Array.isArray(body)
    ? body
    : Array.isArray(object?.results)
      ? object.results
      : Array.isArray(object?.data)
        ? object.data
        : [];

  return items
    .map(domainFromItem)
    .filter(Boolean)
    .map((domain) => normalizeSite(domain));
}

export async function createRetieheSite(apiKey: string, siteName: string): Promise<RetieheSite> {
  const normalizedName = siteName.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/.test(normalizedName)) {
    throw new Error("生成的网站名称不符合热铁盒域名规则。");
  }

  const username = await getUsername(apiKey);
  const body = await requestHostApi(apiKey, "/host-v3/site", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: normalizedName, username }),
  });
  const object = asObject(body);
  const returnedDomain = domainFromItem(body)
    || domainFromItem(object?.result)
    || domainFromItem(object?.data)
    || normalizedName;
  return normalizeSite(returnedDomain, normalizedName);
}

export function generateRetieheSiteName() {
  const bytes = randomBytes(8);
  let suffix = "";
  for (const byte of bytes) suffix += SITE_ALPHABET[byte % SITE_ALPHABET.length];
  return `eeco-${suffix}`;
}

export function isRetieheDomainConflict(error: unknown) {
  if (error instanceof RetieheApiError && error.status === 409) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return ["already", "exists", "taken", "conflict", "重复", "存在", "占用"]
    .some((keyword) => message.includes(keyword));
}
