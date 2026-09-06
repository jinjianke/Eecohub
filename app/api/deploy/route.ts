import { NextRequest, NextResponse } from "next/server";
import { sessionCookie, verifySessionValue } from "@/lib/auth";
import { deployUploadedFile } from "@/lib/deploy";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { UploadValidationError } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: NextRequest) {
  const card = await verifySessionValue(request.cookies.get(sessionCookie.name)?.value);
  if (!card) {
    return NextResponse.json({ error: "卡密验证已失效，请刷新页面后重新验证。" }, { status: 401 });
  }
  if (card.status === "DISABLED") {
    return NextResponse.json({ error: "该卡密已停用，请联系卖家。" }, { status: 403 });
  }
  if (card.status === "EXPIRED") {
    return NextResponse.json({ error: "该卡密已过期，请联系卖家续期。" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("website");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择 HTML 或 ZIP 文件。" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "上传文件不能为空。" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "上传文件不能超过 20MB。" }, { status: 413 });
    }

    const result = await deployUploadedFile(file, card);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "部署失败，请稍后重试。";
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[deploy]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
