import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { addDisputeEvidence } from "@/services/disputeService";
import { saveDataUrlFile } from "@/lib/uploads";

/**
 * POST /api/hirings/[id]/dispute/evidence — anexa evidência a uma disputa
 * EM_ANALISE desta contratação. O arquivo vem como data URL (mesmo formato
 * do verificador de identidade) e é salvo no armazenamento interno — nunca
 * link externo (LGPD: nada de expor terceiros a URL forjada).
 *
 * Body: { file: "data:...;base64,...", kind?: "FOTO" | "DOCUMENTO" | "TEXTO" }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: o required abaixo causa 400 com mensagem clara
  }
  if (typeof body.file !== "string" || !body.file) {
    return NextResponse.json({ error: "file (data URL) é obrigatório" }, { status: 400 });
  }

  // Só se adiciona evidência a uma disputa ainda EM_ANALISE desta contratação.
  const dispute = await prisma.dispute.findFirst({
    where: { hiringId: access.hiring.id, status: "EM_ANALISE" },
    orderBy: { createdAt: "desc" },
  });
  if (!dispute) {
    return NextResponse.json(
      { error: "Não há disputa em análise nesta contratação" },
      { status: 409 }
    );
  }

  const saved = await saveDataUrlFile(body.file, `disputas/${dispute.id}`);
  if ("error" in saved) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }

  try {
    const evidence = await addDisputeEvidence({
      disputeId: dispute.id,
      uploadedById: access.user.id,
      url: saved.relativePath,
      kind: typeof body.kind === "string" ? body.kind : null,
    });
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao salvar evidência" },
      { status: 400 }
    );
  }
}
