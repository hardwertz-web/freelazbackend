import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { saveDataUrlFile } from "@/lib/uploads";

const MAX_ITEMS = 12;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json(auth.error.body, { status: auth.error.status });
  }
  const userId = auth.user.id;

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) {
    return NextResponse.json({ error: "Perfil profissional não encontrado" }, { status: 404 });
  }

  const count = await prisma.portfolioItem.count({ where: { userId } });
  if (count >= MAX_ITEMS) {
    return NextResponse.json({ error: `Limite de ${MAX_ITEMS} itens atingido` }, { status: 422 });
  }

  let body: { dataUrl?: string; kind?: "FOTO" | "VIDEO" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.dataUrl) {
    return NextResponse.json({ error: "Campo dataUrl obrigatório" }, { status: 400 });
  }

  if ((body.kind ?? "FOTO") !== "FOTO") {
    return NextResponse.json({ error: "Apenas fotos são aceitas no momento" }, { status: 422 });
  }

  const saved = await saveDataUrlFile(body.dataUrl, `portfolio/${userId}`);
  if ("error" in saved) {
    return NextResponse.json({ error: saved.error }, { status: 422 });
  }

  const item = await prisma.portfolioItem.create({
    data: { userId, kind: "FOTO", url: saved.url, position: count },
  });

  return NextResponse.json({ item }, { status: 201 });
}
