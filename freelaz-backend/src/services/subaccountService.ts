import { prisma } from "@/lib/prisma";
import { createAsaasSubaccount } from "@/lib/asaas";

/**
 * Etapa 7.3b — onboarding de subconta Asaas (atrás da feature flag
 * `ASAAS_SUBACCOUNT_ENABLED`, checada na rota).
 *
 * Regras:
 * - Idempotente: se o usuário JÁ tem `asaasSubaccountId`, devolve o existente
 *   com `skipped: true` e NÃO chama o provedor de novo. A `apiKey` só existe
 *   na resposta de criação (irrecuperável depois), por isso nunca é reconsultada.
 * - Exige TODOS os campos do payload oficial de `POST /v3/accounts`. Faltando
 *   algum, devolve `{ ok:false, missing:[...] }` sem chamar o provedor.
 * - 4xx do provedor → `{ ok:false, error }`; 5xx/rede → relança (resultado
 *   DESCONHECIDO — repetir sem reconciliar pode duplicar a subconta).
 * - 🔒 `apiKey` e `incomeValueCents` NUNCA são logados, em nenhum caminho.
 */

/** Campos do `User` usados no payload (nada além disso é lido). */
type SubaccountUser = {
  id: string;
  documentType: "CPF" | "CNPJ";
  document: string;
  name: string;
  tradeName: string | null;
  birthDate: Date | null;
  email: string;
  phone: string;
  postalCode: string | null;
  address: string | null;
  addressNumber: string | null;
  province: string | null;
  incomeValueCents: number | null;
  asaasSubaccountId: string | null;
  asaasSubaccountStatus: string | null;
  asaasSubaccountWalletId: string | null;
};

export type CreateSubaccountForUserResult =
  | { ok: true; subaccountId: string; status: string; skipped: boolean }
  | { ok: false; missing: string[] }
  | { ok: false; error: string };

/** Campos comuns exigidos pelo provedor, na ordem em que são reportados. */
const REQUIRED_FIELDS = [
  "name",
  "email",
  "document",
  "phone",
  "postalCode",
  "address",
  "addressNumber",
  "province",
  "incomeValueCents",
] as const;

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return true;
}

/** `Date` → "YYYY-MM-DD" (formato exigido por `birthDate` no Asaas). */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function createSubaccountForUser(
  userId: string
): Promise<CreateSubaccountForUserResult> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      documentType: true,
      document: true,
      name: true,
      tradeName: true,
      birthDate: true,
      email: true,
      phone: true,
      postalCode: true,
      address: true,
      addressNumber: true,
      province: true,
      incomeValueCents: true,
      asaasSubaccountId: true,
      asaasSubaccountStatus: true,
      asaasSubaccountWalletId: true,
    },
  })) as SubaccountUser | null;

  if (!user) return { ok: false, error: "Usuário não encontrado" };

  // Idempotência: já onboardado → devolve o que está persistido.
  if (user.asaasSubaccountId) {
    return {
      ok: true,
      subaccountId: user.asaasSubaccountId,
      status: user.asaasSubaccountStatus ?? "PENDING",
      skipped: true,
    };
  }

  const missing: string[] = REQUIRED_FIELDS.filter((field) => !isFilled(user[field]));

  // Documento define o campo adicional: CPF exige `birthDate`; CNPJ exige
  // `tradeName` (nome fantasia). `companyType` não é obrigatório na doc.
  if (user.documentType === "CPF") {
    if (!user.birthDate) missing.push("birthDate");
  } else if (!isFilled(user.tradeName)) {
    missing.push("tradeName");
  }

  if (missing.length > 0) return { ok: false, missing };

  // `incomeValueCents` já foi validado como inteiro > 0 acima; o provedor
  // espera reais (number). Sem log deste valor.
  const incomeValue = (user.incomeValueCents as number) / 100;

  const result = await createAsaasSubaccount({
    name: user.name,
    email: user.email,
    cpfCnpj: user.document,
    mobilePhone: user.phone,
    incomeValue,
    address: user.address as string,
    addressNumber: user.addressNumber as string,
    province: user.province as string,
    postalCode: user.postalCode as string,
    ...(user.documentType === "CPF"
      ? { birthDate: toIsoDate(user.birthDate as Date) }
      : {}),
  });

  if (!result.ok) return { ok: false, error: result.error };

  // Persiste já na criação: a `apiKey` não é recuperável depois. Nunca logar.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      asaasSubaccountId: result.id,
      asaasSubaccountApiKey: result.apiKey,
      asaasSubaccountStatus: "PENDING",
      // O split (7.3c) usa o walletId, e ele também só é recuperável na
      // criação — persistir junto evita reconsulta/irreversibilidade.
      asaasSubaccountWalletId: result.walletId,
    },
  });

  return {
    ok: true,
    subaccountId: result.id,
    status: "PENDING",
    skipped: false,
  };
}
