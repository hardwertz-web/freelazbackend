import { prisma } from "../lib/prisma";

/**
 * Check-in por geolocalização — EVIDÊNCIA do início do turno, registrada
 * pelo profissional (decisão de produto: NÃO bloqueia o código de
 * abertura; alimenta disputas e a confiabilidade). Um check-in por
 * contratação; repetir a chamada devolve o mesmo registro (idempotente).
 *
 * A vaga hoje não tem coordenadas/endereço, então NÃO há checagem de
 * distância até o local — o que fica registrado é a posição do profissional
 * na hora do início, com a precisão relatada pelo dispositivo.
 */

const EARTH_RADIUS_METERS = 6371000;

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function assertCoordinates(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("latitude inválida (esperado -90 a 90)");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("longitude inválida (esperado -180 a 180)");
  }
}

export async function createCheckIn(params: {
  hiringId: string;
  professionalId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  note?: string | null;
}) {
  const { hiringId, professionalId } = params;
  assertCoordinates(params.latitude, params.longitude);
  if (params.accuracyMeters != null) {
    if (!Number.isFinite(params.accuracyMeters) || params.accuracyMeters < 0) {
      throw new Error("accuracyMeters inválida (esperado número não negativo)");
    }
  }

  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) throw new Error("Contratação não encontrada");
  if (hiring.professionalId !== professionalId) {
    throw new Error("Check-in é do profissional contratado nesta contratação");
  }
  // Só faz sentido registrar presença com o turno pago e não encerrado:
  // antes do pagamento não há serviço; depois de CONCLUIDO já acabou.
  if (hiring.status !== "RETIDO" && hiring.status !== "EM_ANDAMENTO") {
    throw new Error(
      `Check-in disponível com a contratação RETIDO ou EM_ANDAMENTO (atual: ${hiring.status})`
    );
  }

  const existing = await prisma.checkIn.findUnique({ where: { hiringId } });
  if (existing) return { checkIn: existing, created: false };

  try {
    const checkIn = await prisma.checkIn.create({
      data: {
        hiringId,
        professionalId,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracyMeters: params.accuracyMeters ?? null,
        note: params.note?.trim() || null,
      },
    });
    return { checkIn, created: true };
  } catch (err) {
    // Corrida: dois check-ins simultâneos — o unique do banco garante um só.
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const current = await prisma.checkIn.findUnique({ where: { hiringId } });
      if (current) return { checkIn: current, created: false };
    }
    throw err;
  }
}
