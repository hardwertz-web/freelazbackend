import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAdminAccess } from "@/lib/internalAuth";

/**
 * GET /api/admin/metrics/distribution?from=ISO&to=ISO&groupBy=category|city
 * Top 5 por grupo, com count + GMV.
 *
 * `groupBy` é validado contra whitelist ANTES de entrar no SQL (o identificador
 * não pode ser parametrizado). `city` é agrupado como "Cidade/UF" quando o
 * estado existe — cidade homônima em UFs diferentes não colapsa.
 *
 * Só entram hirings efetivados: o mesmo critério do /api/admin/metrics
 * (≠ CANCELADO, ≠ AGUARDANDO_PAGAMENTO) para os dois números baterem.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const { searchParams } = new URL(req.url);
  const groupBy = searchParams.get("groupBy") ?? "category";
  if (groupBy !== "category" && groupBy !== "city") {
    return NextResponse.json(
      { error: "groupBy deve ser 'category' ou 'city'" },
      { status: 400 }
    );
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : defaultFrom;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "from/to inválidos" }, { status: 400 });
  }

  const groupExpr =
    groupBy === "category"
      ? `jp."category"`
      : `COALESCE(jp."city" || '/' || jp."state", jp."city")`;

  const rows = await prisma.$queryRawUnsafe<
    { value: string; count: bigint; gmvCents: bigint }[]
  >(
    `
    SELECT ${groupExpr} as value,
           COUNT(*)::bigint as count,
           COALESCE(SUM(h."grossValueCents"), 0)::bigint as "gmvCents"
    FROM "Hiring" h
    JOIN "JobPosting" jp ON jp.id = h."jobPostingId"
    WHERE h."createdAt" >= $1 AND h."createdAt" <= $2
      AND h.status <> 'CANCELADO'
      AND h.status <> 'AGUARDANDO_PAGAMENTO'
      AND ${groupExpr} IS NOT NULL
    GROUP BY ${groupExpr}
    ORDER BY count DESC, "gmvCents" DESC
    LIMIT 5
    `,
    from,
    to
  );

  return NextResponse.json({
    groupBy,
    period: { from: from.toISOString(), to: to.toISOString() },
    rows: rows.map((r) => ({
      value: r.value,
      count: Number(r.count),
      gmvCents: Number(r.gmvCents),
    })),
  });
}
