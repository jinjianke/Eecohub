import { createHmac, timingSafeEqual } from "node:crypto";
import { ADMIN_PASSWORD } from "@/lib/config";

const COOKIE_NAME = "eecohub_admin";
const SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload: string) {
  return createHmac("sha256", ADMIN_PASSWORD).update(`eecohub-admin:${payload}`).digest("base64url");
}

export function isAdminConfigured() {
  return ADMIN_PASSWORD.length >= 8;
}

export function verifyAdminPassword(password: string) {
  return isAdminConfigured() && safeEqual(password, ADMIN_PASSWORD);
}

export function createAdminSessionValue() {
  if (!isAdminConfigured()) throw new Error("管理员密码尚未配置。");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `admin.${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyAdminSessionValue(value?: string) {
  if (!value || !isAdminConfigured()) return false;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return false;
  try {
    const encoded = value.slice(0, separator);
    const provided = value.slice(separator + 1);
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const [role, expires] = payload.split(".");
    if (role !== "admin" || Number(expires) < Math.floor(Date.now() / 1000)) return false;
    return safeEqual(provided, sign(payload));
  } catch {
    return false;
  }
}

export const adminSessionCookie = { name: COOKIE_NAME, maxAge: SESSION_SECONDS };
