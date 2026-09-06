import { NextRequest, NextResponse } from "next/server";
import {
  adminSessionCookie,
  createAdminSessionValue,
  isAdminConfigured,
  verifyAdminPassword,
  verifyAdminSessionValue,
} from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    authenticated: verifyAdminSessionValue(request.cookies.get(adminSessionCookie.name)?.value),
    configured: isAdminConfigured(),
  });
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "管理员密码尚未配置。" }, { status: 503 });
  }
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容无效。" }, { status: 400 });
  }
  if (!body.password || !verifyAdminPassword(body.password)) {
    return NextResponse.json({ error: "管理员密码不正确。" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminSessionCookie.name, createAdminSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: adminSessionCookie.maxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminSessionCookie.name, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
