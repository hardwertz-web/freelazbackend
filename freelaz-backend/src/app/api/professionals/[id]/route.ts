import { NextResponse } from "next/server";
import { getPublicProfessional } from "@/lib/publicProfessional";

/**
 * GET /api/professionals/:id — perfil público de um profissional (Fase 2.5).
 *
 * Público (sem sessão). 404 quando o id não existe OU quando o usuário não
 * tem o papel PROFISSIONAL ATIVO. A resposta usa a projeção fechada de
 * `lib/publicProfessional.ts` — nunca inclui CPF/CNPJ, e-mail, telefone,
 * pixKey, documentUrl, selfieUrl, asaasCustomerId/Subaccount, papéis ou
 * sessões.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const professional = await getPublicProfessional(params.id);
  if (!professional) {
    return NextResponse.json(
      { error: "Profissional não encontrado" },
      { status: 404 }
    );
  }

  return NextResponse.json({ professional });
}
