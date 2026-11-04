import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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
    return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
  }

  const item = await prisma.portfolioItem.findFirst({
    where: { id: params.id, userId },
  });
  if (!item) {
    return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
  }

  await prisma.portfolioItem.delete({ where: { id: item.id } });
  return NextResponse.json({ ok: true }, { status: 200 });
}
