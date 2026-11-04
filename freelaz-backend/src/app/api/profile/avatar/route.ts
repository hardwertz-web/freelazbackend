import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { saveDataUrlFile } from "@/lib/uploads";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json(auth.error.body, { status: auth.error.status });
  }
  const userId = auth.user.id;

  let body: { dataUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.dataUrl) {
    return NextResponse.json({ error: "Campo dataUrl obrigatório" }, { status: 400 });
  }

  const saved = await saveDataUrlFile(body.dataUrl, `avatars/${userId}`);
  if ("error" in saved) {
    return NextResponse.json({ error: saved.error }, { status: 422 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: saved.url },
    select: { avatarUrl: true },
  });

  return NextResponse.json({ avatarUrl: updated.avatarUrl }, { status: 200 });
}
