import { NextRequest, NextResponse } from "next/server";
import { listPublicProfessionals } from "@/lib/publicProfessional";

/**
 * GET /api/professionals — busca pública de profissionais (Fase 2.5).
 *
 * Segue o padrão de listagem pública de `/api/jobs`: sem sessão obrigatória.
 * A resposta é uma projeção fechada (ver `lib/publicProfessional.ts`), sem
 * CPF/CNPJ, e-mail, telefone, Pix, documentos, selfies, ids de Asaas ou
 * qualquer relação de papéis/sessão.
 *
 * Filtros: q, category, city, state, minRating, page (1-indexed) e limit
 * (padrão 20, máximo 50).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const result = await listPublicProfessionals({
    q: searchParams.get("q"),
    category: searchParams.get("category"),
    city: searchParams.get("city"),
    state: searchParams.get("state"),
    minRating: searchParams.get("minRating"),
    page: searchParams.get("page"),
    limit: searchParams.get("limit"),
  });

  return NextResponse.json(result);
}
