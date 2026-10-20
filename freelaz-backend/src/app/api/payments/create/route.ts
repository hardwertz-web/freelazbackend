import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPixQrCode } from "@/lib/asaas";
import { requireUser, hasActiveRole } from "@/lib/auth";
import {
  checkPersistedCharge,
  ensureAsaasCustomerForUser,
  ensureCharge,
} from "@/services/chargeService";

/**
 * POST /api/payments/create
 * Chamado quando a empresa confirma uma contratação e precisa pagar.
 * Cria uma cobrança PIX no Asaas para aquela contratação e devolve o
 * QR Code (imagem + copia e cola) para exibir.
 *
 * IDEMPOTENTE (Etapa 1 — ver services/chargeService.ts): antes de criar
 * QUALQUER cobrança nova o serviço reconcilia com o provedor por
 * `externalReference` e trava a concorrência no banco — nunca duas cobranças
 * para a mesma contratação, mesmo com retry, resposta perdida ou duas
 * requisições simultâneas. Resposta ambígua do provedor bloqueia a criação
 * (503) em vez de duplicar cobrança.
 *
 * IMPORTANTE: não há split aqui. O dinheiro inteiro entra na conta Asaas do
 * Freelaz. A divisão (comissão x valor líquido do profissional) é só um
 * registro interno — ver ledgerService.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const body = await req.json();
  const { hiringId } = body;

  if (!hiringId) {
    return NextResponse.json({ error: "hiringId é obrigatório" }, { status: 400 });
  }

  const hiring = await prisma.hiring.findUnique({ where: { id: hiringId } });
  if (!hiring) {
    return NextResponse.json({ error: "Contratação não encontrada" }, { status: 404 });
  }
  // Só a empresa dona da contratação pode pagar (não vaza a cobrança pros outros)
  if (hiring.contractorId !== user.id || !hasActiveRole(user, "CONTRATANTE")) {
    return NextResponse.json(
      { error: "Apenas a empresa contratante pode pagar esta contratação" },
      { status: 403 }
    );
  }
  if (hiring.status !== "AGUARDANDO_PAGAMENTO") {
    return NextResponse.json(
      { error: `Contratação não está aguardando pagamento (status atual: ${hiring.status})` },
      { status: 409 }
    );
  }

  if (!process.env.ASAAS_API_KEY) {
    return NextResponse.json(
      { error: "Provedor de pagamento (Asaas) não configurado — defina ASAAS_API_KEY no ambiente" },
      { status: 503 }
    );
  }

  // Reutiliza a cobrança existente se ela ainda estiver válida no provedor.
  const persisted = await checkPersistedCharge("HIRING", hiring.id);
  if (persisted.kind === "ambiguous") {
    return NextResponse.json({ error: persisted.message }, { status: 503 });
  }
  if (persisted.kind === "active") {
    const qr = await getPixQrCode(persisted.payment.id);
    return NextResponse.json({
      paymentId: persisted.payment.id,
      status: persisted.payment.status,
      pix: qr
        ? { qrCodeBase64: qr.encodedImage, payload: qr.payload, expirationDate: qr.expirationDate }
        : null,
      alreadyCreated: true,
    });
  }
  // Cobrança antiga excluída/estornada/inexistente: cria uma nova abaixo,
  // mas só depois da reconciliação + trava feitas por ensureCharge.

  // Cliente no provedor (Etapa 2 — decisão "cliente por usuário"): criado na
  // primeira cobrança e reutilizado. POST /payments exige `customer`; recusa
  // definitiva (4xx) vira 502 e falha de comunicação vira 503 (nada cobrado).
  const customer = await ensureAsaasCustomerForUser(hiring.contractorId);
  if (customer.kind !== "ok") {
    return NextResponse.json(
      { error: customer.message },
      { status: customer.kind === "unavailable" ? 503 : 502 }
    );
  }

  const charge = await ensureCharge({
    entity: "HIRING",
    entityId: hiring.id,
    valueCents: hiring.grossValueCents,
    // external_reference é o que o webhook usa para achar a contratação
    description: `Freelaz — ${hiring.jobTitle}`,
    customerId: customer.customerId,
  });

  if (charge.outcome === "reused") {
    // A reconciliação encontrou uma cobrança vigente criada por uma tentativa
    // anterior (ex.: resposta perdida) — reutiliza, nunca duplica.
    const qr = await getPixQrCode(charge.providerPaymentId);
    return NextResponse.json({
      paymentId: charge.providerPaymentId,
      status: charge.status,
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
    paymentId: charge.providerPaymentId,
    status: charge.status,
    pix: qr
      ? { qrCodeBase64: qr.encodedImage, payload: qr.payload, expirationDate: qr.expirationDate }
      : null,
  });
}
