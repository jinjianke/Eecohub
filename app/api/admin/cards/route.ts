import { NextRequest, NextResponse } from "next/server";
import { adminSessionCookie, verifyAdminSessionValue } from "@/lib/admin-auth";
import { generateCards, getCardStats, getSiteStats, listCards } from "@/lib/cards";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  return verifyAdminSessionValue(request.cookies.get(adminSessionCookie.name)?.value);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "请先登录管理后台。" }, { status: 401 });
  return NextResponse.json({ stats: getCardStats(), siteStats: getSiteStats(), cards: listCards() });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "请先登录管理后台。" }, { status: 401 });
  let body: { count?: number; buyerId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容无效。" }, { status: 400 });
  }
  if (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 100) {
    return NextResponse.json({ error: "每次请输入 1 到 100 之间的整数。" }, { status: 400 });
  }
  const buyerId = typeof body.buyerId === "string" ? body.buyerId.trim() : "";
  if (!buyerId) {
    return NextResponse.json({ error: "请填写买家 ID。" }, { status: 400 });
  }
  if (buyerId.length > 100) {
    return NextResponse.json({ error: "买家 ID 最多 100 个字符。" }, { status: 400 });
  }
  const generated = generateCards(Number(body.count), buyerId);
  return NextResponse.json({ generated, stats: getCardStats(), siteStats: getSiteStats(), cards: listCards() });
}
