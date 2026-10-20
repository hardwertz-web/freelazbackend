import { NextRequest, NextResponse } from "next/server";
import { requireHiringParticipant } from "@/lib/hiringAccess";
import { createCheckIn } from "@/services/checkInService";

/**
 * POST /api/hirings/[id]/check-in — evidência de presença do PROFISSIONAL
 * no início do turno (geolocalização + precisão + horário). Decisão de
 * produto: não bloqueia o código de abertura; alimenta disputas e a
 * confiabilidade. Idempotente: repetir devolve o mesmo check-in.
 *
 * Body: { latitude, longitude, accuracyMeters?, note? }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireHiringParticipant(params.id);
  if (access.error) return NextResponse.json(access.error.body, { status: access.error.status });
  const { hiring, side, user } = access;

  if (side !== "PROFESSIONAL") {
    return NextResponse.json(
      { error: "Check-in é registrado pelo profissional contratado" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio: os required abaixo causam 400 com mensagem clara
  }
  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    return NextResponse.json({ error: "latitude e longitude são obrigatórias" }, { status: 400 });
  }

  try {
    const result = await createCheckIn({
      hiringId: hiring.id,
      professionalId: user.id,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracyMeters: typeof body.accuracyMeters === "number" ? body.accuracyMeters : null,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro ao registrar check-in" },
      { status: 400 }
    );
  }
}
