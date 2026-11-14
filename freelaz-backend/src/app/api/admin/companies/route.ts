import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";

/**
 * GET /api/admin/companies?search=X&limit=20
 * Lista empresas contratantes para o painel (busca por nome, tradeName ou documento).
 *
 * Só entram usuários que têm `ContractorProfile` (é o que carrega a comissão
 * customizada da Fase 5c). O documento é comparado apenas por dígitos: se a
 * busca não tiver dígito, o ramo do documento não entra — senão `contains: ""`
 * casaria com todos e a busca por nome viraria "retornar tudo".
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const limit = Math.max(
    1,
    Math.min(Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20, 50)
  );

  const where: Prisma.UserWhereInput = {
    contractorProfile: { isNot: null },
  };
  if (search) {
    const digits = search.replace(/\D/g, "");
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { tradeName: { contains: search, mode: "insensitive" } },
      ...(digits.length > 0 ? [{ document: { contains: digits } }] : []),
    ];
  }

  const users = await prisma.user.findMany({
    where,
    take: limit,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tradeName: true,
      document: true,
      documentType: true,
      city: true,
      state: true,
      contractorProfile: { select: { customCommissionBps: true } },
    },
  });

  return NextResponse.json({ companies: users });
}
