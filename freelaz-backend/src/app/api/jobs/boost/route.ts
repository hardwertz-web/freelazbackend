import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPixQrCode } from "@/lib/asaas";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { DEFAULT_BOOST_PRICE_CENTS } from "@/lib/commission";
import {
  checkPersistedCharge,
  ensureAsaasCustomerForUser,
  ensureCharge,
} from "@/services/chargeService";

const BOOST_PRICE_CENTS = DEFAULT_BOOST_PRICE_CENTS; // fonte única: lib/commission.ts

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
  );
}

/**
 * POST /api/jobs/boost
 * Cria a cobrança Pix do impulsionamento pago "Publicar com urgência" (R$10).
 * Disponível tanto na tela de publicação da vaga quanto na gestão de uma
 * vaga já publicada (ver CLAUDE.md > Publicação com urgência).
 * Só o contratante dono da vaga pode impulsioná-la.
 *
 * A flag `urgentBoost` só é setada pelo webhook quando o pagamento é
 * confirmado — a cobrança por si só não destaca nada.
 *
 * IDEMPOTÊNCIA (Etapa 1 — ver services/chargeService.ts): um boost por vaga
 * garantido pelo banco (índice único em jobPostingId) e UMA cobrança vigente
 * por boost — a criação só acontece depois de reconciliar com o provedor e
 * travar a concorrência. `FALHOU` não é tratado como "o provedor não criou
 * nada": a reconciliação é quem decide.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  if (!hasActiveRole(user, "CONTRATANTE")) {
    return NextResponse.json({ error: "Papel Contratante necessário" }, { status: 403 });
  }

  const { jobPostingId } = await req.json();
  if (!jobPostingId) {
    return NextResponse.json({ error: "jobPostingId é obrigatório" }, { status: 400 });
  }

  const jobPosting = await prisma.jobPosting.findUnique({ where: { id: jobPostingId } });
  if (!jobPosting) {
    return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  }
  if (jobPosting.contractorId !== user.id) {
    return NextResponse.json({ error: "Apenas a empresa dona da vaga pode impulsioná-la" }, { status: 403 });
  }
  if (jobPosting.urgentBoost) {
    return NextResponse.json({ error: "Esta vaga já está com destaque de urgência ativo" }, { status: 409 });
  }

  if (!process.env.ASAAS_API_KEY) {
    return NextResponse.json(
      { error: "Provedor de pagamento (Asaas) não configurado — defina ASAAS_API_KEY no ambiente" },
      { status: 503 }
    );
  }

  // Um boost por vaga, garantido pelo banco (índice único em jobPostingId):
  // duas requisições simultâneas não criam dois boosts (nem duas cobranças).
  let boost = await prisma.jobBoost.findUnique({ where: { jobPostingId } });
  if (!boost) {
    try {
      boost = await prisma.jobBoost.create({
        data: { jobPostingId, amountCents: BOOST_PRICE_CENTS },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      boost = await prisma.jobBoost.findUnique({ where: { jobPostingId } });
      if (!boost) throw err;
    }
  }

  // Reutiliza a cobrança existente se ainda estiver válida no provedor.
  const persisted = await checkPersistedCharge("BOOST", boost.id);
  if (persisted.kind === "ambiguous") {
    return NextResponse.json({ error: persisted.message }, { status: 503 });
  }
  if (persisted.kind === "active") {
    const qr = await getPixQrCode(persisted.payment.id);
    return NextResponse.json({
      boostId: boost.id,
      paymentId: persisted.payment.id,
      pix: qr
        ? { qrCodeBase64: qr.encodedImage, payload: qr.payload, expirationDate: qr.expirationDate }
        : null,
      alreadyCreated: true,
    });
  }

  // Cliente no provedor (Etapa 2 — decisão "cliente por usuário"): mesma
  // regra da rota de pagamento — criado uma vez, reutilizado para sempre.
  const customer = await ensureAsaasCustomerForUser(user.id);
  if (customer.kind !== "ok") {
    return NextResponse.json(
      { error: customer.message },
      { status: customer.kind === "unavailable" ? 503 : 502 }
    );
  }

  const charge = await ensureCharge({
    entity: "BOOST",
    entityId: boost.id,
    valueCents: BOOST_PRICE_CENTS,
    description: `Freelaz — Destaque de urgência: ${jobPosting.title}`,
    customerId: customer.customerId,
  });

  if (charge.outcome === "reused") {
    // Reconciliação achou cobrança vigente de tentativa anterior — reutiliza.
    const qr = await getPixQrCode(charge.providerPaymentId);
    return NextResponse.json({
      boostId: boost.id,
      paymentId: charge.providerPaymentId,
      pix: qr
        ? { qrCodeBase64: qr.encodedImage, payload: qr.payload, expirationDate: qr.expirationDate }
        : null,
      alreadyCreated: true,
    });
  }
  if (charge.outcome === "concurrent") {
    return NextResponse.json({ error: charge.message }, { status: 409 });
  }
  if (charge.outcome === "ambiguous") {
    return NextResponse.json({ error: charge.message }, { status: 503 });
  }
  if (charge.outcome === "rejected") {
    return NextResponse.json({ error: charge.message }, { status: 502 });
  }

  const qr = await getPixQrCode(charge.providerPaymentId);

  return NextResponse.json({
    boostId: boost.id,
    paymentId: charge.providerPaymentId,
    pix: qr
      ? { qrCodeBase64: qr.encodedImage, payload: qr.payload, expirationDate: qr.expirationDate }
      : null,
  });
}
