import { NextRequest, NextResponse } from "next/server";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { markOpeningCodeUsed, markClosingCodeUsed } from "@/services/codeService";

/**
 * POST /api/hirings/[id]/codes
 * A empresa contratante confirma o código que o profissional mostrou:
 *  - kind = "OPENING" → retira a contratação de RETIDO e a coloca EM_ANDAMENTO
 *    (o turno começou);
 *  - kind = "CLOSING" → conclui o turno (CONCLUIDO) e marca a hora de uso do
 *    código, que é o que libera a avaliação 2h depois.
 *
 * Só a empresa confirma: é ela quem confere o código na hora. A mudança de
 * status passa toda pelo `hiringService` (nunca escrita livre — VLAEG, seção A).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });
  if (access.side !== "CONTRACTOR") {
    return NextResponse.json(
      { error: "Apenas a empresa contratante confirma os códigos do turno" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const kind = String(body.kind ?? "").toUpperCase();
  const code = String(body.code ?? "").trim();
  if (kind !== "OPENING" && kind !== "CLOSING") {
    return NextResponse.json({ error: "kind deve ser OPENING ou CLOSING" }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "code é obrigatório" }, { status: 400 });
  }

  try {
    // attemptedById: a sessão de quem digitou — base do limite de tentativas
    // e da auditoria (CodeAttempt).
    const hiring =
      kind === "OPENING"
        ? await markOpeningCodeUsed(params.id, code, access.user.id)
        : await markClosingCodeUsed(params.id, code, access.user.id);

    return NextResponse.json({
      hiring: {
        id: hiring.id,
        status: hiring.status,
        openingCode: hiring.openingCode,
        closingCode: hiring.closingCode,
        closingCodeUsedAt: hiring.closingCodeUsedAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
