import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSession,
  createOneTimeToken,
  hashPassword,
} from "@/lib/auth";
import {
  isAtLeast18,
  isValidCNPJ,
  isValidCPF,
  normalizeDocument,
  onlyDigits,
} from "@/lib/document";
import { publicUser } from "@/lib/publicUser";

/**
 * POST /api/auth/register — cadastro único (CPF ou CNPJ) com papéis
 * ativáveis. Não existe escolha de "tipo de conta" no cadastro: cria-se uma
 * conta só e ativam-se os papéis Profissional e/ou Contratante.
 *
 * Regras do cadastro (CLAUDE.md > "Cadastro e papéis"):
 * - CPF: nome completo + data de nascimento, bloqueio automático se < 18 anos
 * - CNPJ: razão social (+ nome fantasia)
 * - Papel Profissional nasce PENDENTE (exige documento + selfie / validação
 *   de CNPJ para ativar); papel Contratante nasce ATIVO (verificação leve
 *   é a confirmação de e-mail/telefone, que dá o selo, não bloqueia o uso)
 * - Aceite dos Termos (LGPD) obrigatório, registrado com data/hora
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const documentType = body.documentType;
  const rawDocument = String(body.document ?? "");
  const name = String(body.name ?? "").trim();
  const tradeName = body.tradeName ? String(body.tradeName).trim() : null;
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = onlyDigits(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  const acceptedTerms = body.acceptedTerms === true;
  const roles = Array.isArray(body.roles) ? (body.roles as string[]) : [];

  if (documentType !== "CPF" && documentType !== "CNPJ") {
    return NextResponse.json({ error: "documentType deve ser CPF ou CNPJ" }, { status: 400 });
  }

  // ----- Validações básicas -----
  let birthDate: Date | null = null;
  if (documentType === "CPF") {
    if (!isValidCPF(rawDocument)) {
      return NextResponse.json({ error: "CPF inválido" }, { status: 422 });
    }
    if (!name || name.split(/\s+/).length < 2) {
      return NextResponse.json({ error: "Informe o nome completo" }, { status: 422 });
    }
    const birthRaw = body.birthDate ? String(body.birthDate) : "";
    const parsed = new Date(birthRaw);
    if (!birthRaw || Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Data de nascimento obrigatória" }, { status: 422 });
    }
    if (!isAtLeast18(parsed)) {
      // Bloqueio automático: idade mínima de 18 anos é regra de produto.
      return NextResponse.json(
        { error: "É necessário ter 18 anos ou mais para se cadastrar" },
        { status: 422 }
      );
    }
    birthDate = parsed;
  } else {
    if (!isValidCNPJ(rawDocument)) {
      return NextResponse.json({ error: "CNPJ inválido" }, { status: 422 });
    }
    if (!name) {
      return NextResponse.json({ error: "Razão social obrigatória" }, { status: 422 });
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 422 });
  }
  if (phone.length < 10 || phone.length > 11) {
    return NextResponse.json({ error: "Telefone inválido (DDD + número)" }, { status: 422 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "A senha precisa de pelo menos 8 caracteres" }, { status: 422 });
  }
  if (!acceptedTerms) {
    return NextResponse.json(
      { error: "É preciso aceitar os Termos de Uso e a Política de Privacidade" },
      { status: 422 }
    );
  }

  const wantedRoles = roles.filter(
    (r): r is "PROFISSIONAL" | "CONTRATANTE" =>
      r === "PROFISSIONAL" || r === "CONTRATANTE"
  );
  if (wantedRoles.length === 0) {
    return NextResponse.json(
      { error: "Escolha ao menos um papel: oferecer serviços, contratar, ou os dois" },
      { status: 422 }
    );
  }

  const document = documentType === "CPF" ? onlyDigits(rawDocument) : normalizeDocument(rawDocument);

  try {
    const passwordHash = await hashPassword(password);
    const now = new Date();

    const user = await prisma.user.create({
      data: {
        documentType,
        document,
        name,
        tradeName,
        birthDate,
        email,
        phone,
        passwordHash,
        termsAcceptedAt: now,
        roles: {
          create: wantedRoles.map((role) => ({
            role,
            // Profissional exige verificação para ativar; contratante já sai ativo.
            status: role === "PROFISSIONAL" ? "PENDENTE" : "ATIVO",
          })),
        },
        professionalProfile:
          wantedRoles.includes("PROFISSIONAL") ? { create: {} } : undefined,
        contractorProfile:
          wantedRoles.includes("CONTRATANTE") ? { create: {} } : undefined,
      },
      include: { roles: true },
    });

    // Confirmação de e-mail: em dev o token sai no console do servidor
    // (nenhum provedor de e-mail está configurado ainda — ver README).
    const emailToken = await createOneTimeToken(user.id, "EMAIL_CONFIRM");
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Freelaz] Token de confirmação de e-mail para ${email}: ${emailToken}`);
    }

    await createSession(user.id);

    return NextResponse.json(
      {
        user: publicUser(user),
        roles: user.roles,
        // Para o front direcionar o onboarding (ex: verificação do papel
        // Profissional) sem precisar adivinhar o estado.
        nextStep:
          wantedRoles.includes("PROFISSIONAL") && wantedRoles.length === 1
            ? "VERIFICACAO_PROFISSIONAL"
            : "HOME",
      },
      { status: 201 }
    );
  } catch (err) {
    // Unique constraint: devolve qual campo já existe, sem vazar o banco.
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const target = String((err as { meta?: { target?: string[] } }).meta?.target ?? "");
      const field =
        target.includes("email") ? "email"
        : target.includes("phone") ? "telefone"
        : target.includes("document") ? "documento"
        : "cadastro";
      return NextResponse.json(
        { error: `Já existe uma conta com esse ${field}` },
        { status: 409 }
      );
    }
    console.error("[Freelaz] erro no registro:", err);
    return NextResponse.json({ error: "Erro ao criar conta" }, { status: 500 });
  }
}
