import { NextResponse } from "next/server";
import { createSessionValue, sessionCookie } from "@/lib/auth";
import { findCardByCode } from "@/lib/cards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { cardCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容无效。" }, { status: 400 });
  }

  const card = body.cardCode ? findCardByCode(body.cardCode) : null;
  if (!card) {
    return NextResponse.json({ error: "卡密不正确，请检查后重新输入。" }, { status: 401 });
  }
  if (card.status === "DISABLED") {
    return NextResponse.json({ error: "该卡密已停用，请联系卖家。" }, { status: 403 });
  }
  if (card.status === "EXPIRED") {
    return NextResponse.json({ error: "该卡密已过期，请联系卖家续期。" }, { status: 403 });
  }

  const response = NextResponse.json({
    ok: true,
    state: {
      status: card.status,
      publicUrl: card.status === "ACTIVE" ? card.publicUrl : null,
      deploymentCount: card.deploymentCount,
      expiresAt: card.expiresAt,
      lastDeployedAt: card.lastDeployedAt,
    },
  });
  response.cookies.set(sessionCookie.name, await createSessionValue(card.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionCookie.maxAge,
  });
  return response;
}
