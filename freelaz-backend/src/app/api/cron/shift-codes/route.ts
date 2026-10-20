import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/internalAuth";
import { generateOpeningCodesDue, generateClosingCodesDue } from "@/services/codeService";

/**
 * POST /api/cron/shift-codes
 * Agendador dos códigos de turno. Deve rodar a cada poucos minutos:
 *  - gera o código de ABERTURA dos turnos que começam em ~1h;
 *  - gera o código de FECHAMENTO dos turnos que terminam em ~1h.
 *
 * Rota interna (header x-internal-secret) — não é ação de usuário.
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalSecret(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const [openingCodesGenerated, closingCodesGenerated] = await Promise.all([
    generateOpeningCodesDue(),
    generateClosingCodesDue(),
  ]);

  return NextResponse.json({ openingCodesGenerated, closingCodesGenerated });
}
