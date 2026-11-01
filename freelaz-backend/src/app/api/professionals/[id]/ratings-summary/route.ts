import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Profissional não encontrado" }, { status: 404 });

  const evaluations = await prisma.evaluation.findMany({
    where: { targetId: params.id, releasedAt: { not: null } },
    select: { rating: true },
  });

  const total = evaluations.length;
  if (total === 0) {
    return NextResponse.json({ total: 0, average: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
  }

  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;
  for (const e of evaluations) {
    sum += e.rating;
    if (e.rating >= 1 && e.rating <= 5) distribution[e.rating as keyof typeof distribution]++;
  }
  const average = Math.round((sum / total) * 10) / 10;

  return NextResponse.json({ total, average, distribution });
}
