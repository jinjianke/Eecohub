import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "@/lib/config";
import { getCardById } from "@/lib/cards";

const COOKIE_NAME = "eecohub_session";
const SESSION_SECONDS = 2 * 60 * 60;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function getSecret() {
  const envKey = process.env.RTH_API_KEY?.trim();
  if (envKey) return envKey;
  try {
    return (await readFile(path.join(ROOT_DIR, "key.txt"), "utf8")).trim();
  } catch {
    throw new Error("未找到热铁盒 API Key。请保留根目录 key.txt，或设置 RTH_API_KEY。");
  }
}

async function signature(payload: string) {
  const secret = await getSecret();
  return createHmac("sha256", secret).update(`eecohub:${payload}`).digest("base64url");
}

export async function createSessionValue(cardId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${cardId}.${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${await signature(payload)}`;
}

export async function verifySessionValue(value?: string) {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = value.slice(0, separator);
  const providedSignature = value.slice(separator + 1);

  try {
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const payloadSeparator = payload.lastIndexOf(".");
    if (payloadSeparator < 1) return null;
    const cardId = payload.slice(0, payloadSeparator);
    const expiresAt = Number(payload.slice(payloadSeparator + 1));
    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;
    if (!safeEqual(providedSignature, await signature(payload))) return null;
    return getCardById(cardId);
  } catch {
    return null;
  }
}

export const sessionCookie = { name: COOKIE_NAME, maxAge: SESSION_SECONDS };
