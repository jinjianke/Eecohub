import { NextRequest, NextResponse } from "next/server";
import { adminSessionCookie, verifyAdminSessionValue } from "@/lib/admin-auth";
import { extendCard, setCardStatus } from "@/lib/cards";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!verifyAdminSessionValue(request.cookies.get(adminSessionCookie.name)?.value)) {
    return NextResponse.json({ error: "请先登录管理后台。" }, { status: 401 });
  }
  let body: { action?: "disable" | "enable" | "expire" | "extend"; days?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容无效。" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const card = body.action === "extend"
      ? extendCard(id, Number(body.days || 365))
      : body.action && ["disable", "enable", "expire"].includes(body.action)
        ? setCardStatus(id, body.action as "disable" | "enable" | "expire")
        : null;
    if (!card) return NextResponse.json({ error: "不支持的操作。" }, { status: 400 });
    return NextResponse.json({ card });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "操作失败。" }, { status: 400 });
  }
}
