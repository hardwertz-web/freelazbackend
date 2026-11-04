import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { saveDataUrlFile } from "@/lib/uploads";

/**
 * GET /api/profile/profissional — perfil completo do papel Profissional.
 * PUT — atualização completa (perfil "editável por inteiro"): campos
 *       soltos + experiências e portfólio substituídos pelos enviados.
 *
 * Notas de escopo (Fase 1):
 * - Categorias: texto livre normalizado (o server não trava a lista para
 *   poder contabilizar "Outro" e detectar categorias novas a formalizar —
 *   Fase 5)
 * - Portfólio aceita data URLs (foto/vídeo) salvas em disco; vídeo de 60s
 *   completo sai quando houver storage definido (Fase 6)
 * - Sem item de portfólio o front usa a ilustração padrão da categoria;
 *   sem avaliação, o selo "Novo no Freelaz" é do front, não do server
 */

const MAX_CATEGORIES = 10;
const MAX_EXPERIENCES = 30;
const MAX_PORTFOLIO = 30;
const MM_AAAA = /^(0[1-9]|1[0-2])-\d{4}$/;

type ExperienceInput = {
  company?: string;
  role?: string;
  periodStart?: string;
  periodEnd?: string | null;
};

type PortfolioInput = {
  kind?: string;
  dataUrl?: string;
  url?: string;
};

function cleanStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] | { error: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { error: "Esperado uma lista" };
  if (value.length > maxItems) return { error: `Máximo de ${maxItems} itens` };
  const out: string[] = [];
  for (const item of value) {
    const s = String(item).trim();
    if (!s) continue;
    if (s.length > maxLength) return { error: `Item muito longo (máx. ${maxLength} caracteres)` };
    out.push(s);
  }
  return out;
}

/**
 * Perfil + portfólio + experiências num só objeto de resposta.
 * Atenção: as relações (portfolioItems/workExperiences) apontam para o
 * User, não para o ProfessionalProfile — por isso a busca é separada.
 */
async function loadProfileBundle(userId: string) {
  const profile = await prisma.professionalProfile.findUnique({ where: { userId } });
  if (!profile) return null;
  const [portfolioItems, workExperiences, evaluationCount] = await Promise.all([
    prisma.portfolioItem.findMany({ where: { userId }, orderBy: { position: "asc" } }),
    prisma.workExperience.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    // Contagem exibida junto da média (Fase 2.3b): só avaliações liberadas.
    prisma.evaluation.count({ where: { targetId: userId, releasedAt: { not: null } } }),
  ]);
  return { ...profile, portfolioItems, workExperiences, evaluationCount };
}

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const profile = await loadProfileBundle(user.id);
  if (!profile) {
    return NextResponse.json(
      { error: "Papel Profissional não ativado nesta conta" },
      { status: 409 }
    );
  }

  // Força do perfil: indicador visível só para o próprio usuário (CLAUDE.md).
  const strength = computeProfileStrength(profile);
  // A chave Pix fica em User (destino dos repasses) — devolvida à parte para
  // não misturar o perfil do papel com o dado de recebimento.
  const userFull = await prisma.user.findUnique({ where: { id: user.id }, select: { pixKey: true, avatarUrl: true } });
  return NextResponse.json({ profile: { ...profile, avatarUrl: userFull?.avatarUrl ?? null }, profileStrength: strength, pixKey: userFull?.pixKey ?? user.pixKey });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const user = auth.user;

  const hasRole = user.roles.some((r) => r.role === "PROFISSIONAL");
  if (!hasRole) {
    return NextResponse.json(
      { error: "Ative o papel Profissional antes de editar o perfil" },
      { status: 409 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const bio = body.bio === undefined ? undefined : String(body.bio ?? "").trim().slice(0, 2000);
  const headline = body.headline === undefined ? undefined : String(body.headline ?? "").trim().slice(0, 120);
  const region = body.region === undefined ? undefined : String(body.region ?? "").trim().slice(0, 80);

  const categories = cleanStringArray(body.categories, MAX_CATEGORIES, 60);
  if ("error" in categories) return NextResponse.json({ error: `categories: ${categories.error}` }, { status: 422 });
  const availability = cleanStringArray(body.availability, 40, 30);
  if ("error" in availability) return NextResponse.json({ error: `availability: ${availability.error}` }, { status: 422 });
  const softSkills = cleanStringArray(body.softSkills, 10, 30);
  if ("error" in softSkills) return NextResponse.json({ error: `softSkills: ${softSkills.error}` }, { status: 422 });

  let referencePriceCents: number | undefined;
  if (body.referencePriceCents !== undefined && body.referencePriceCents !== null) {
    const value = Number(body.referencePriceCents);
    if (!Number.isInteger(value) || value < 0) {
      return NextResponse.json({ error: "referencePriceCents deve ser inteiro (centavos)" }, { status: 422 });
    }
    referencePriceCents = value;
  }

  // Chave Pix — destino dos repasses (vive no User, não no perfil do papel).
  // Sem ela o repasse fica bloqueado. Validação leve: o formato exato de cada
  // tipo de chave será refinado quando o saque for ao ar de verdade.
  let pixKey: string | null | undefined;
  if (body.pixKey !== undefined) {
    const value = String(body.pixKey ?? "").trim();
    if (value.length > 120) {
      return NextResponse.json({ error: "pixKey muito longa (máx. 120 caracteres)" }, { status: 422 });
    }
    pixKey = value || null;
  }

  // Endereço/renda exigidos pelo onboarding de subconta Asaas (Etapa 7.3b).
  // Campos OPCIONAIS: chamadas antigas (que não os enviam) continuam iguais.
  // Ausência = null; string vazia também limpa o campo.
  const subaccountProfile: {
    postalCode?: string | null;
    address?: string | null;
    addressNumber?: string | null;
    province?: string | null;
    incomeValueCents?: number | null;
  } = {};

  if (body.postalCode !== undefined) {
    const raw = String(body.postalCode ?? "").trim();
    if (!raw) {
      subaccountProfile.postalCode = null;
    } else {
      const digits = raw.replace(/\D/g, "");
      if (digits.length !== 8) {
        return NextResponse.json({ error: "postalCode deve ter 8 dígitos" }, { status: 422 });
      }
      subaccountProfile.postalCode = digits;
    }
  }

  const addressFields = [
    ["address", 160],
    ["addressNumber", 20],
    ["province", 80],
  ] as const;
  for (const [field, maxLength] of addressFields) {
    if (body[field] === undefined) continue;
    const value = String(body[field] ?? "").trim();
    if (!value) {
      subaccountProfile[field] = null;
    } else if (value.length > maxLength) {
      return NextResponse.json(
        { error: `${field} muito longo (máx. ${maxLength} caracteres)` },
        { status: 422 }
      );
    } else {
      subaccountProfile[field] = value;
    }
  }

  if (body.incomeValueCents !== undefined) {
    if (body.incomeValueCents === null || String(body.incomeValueCents).trim() === "") {
      subaccountProfile.incomeValueCents = null;
    } else {
      const value = Number(body.incomeValueCents);
      if (!Number.isInteger(value) || value <= 0) {
        return NextResponse.json(
          { error: "incomeValueCents deve ser inteiro positivo (centavos)" },
          { status: 422 }
        );
      }
      subaccountProfile.incomeValueCents = value;
    }
  }

  // Currículo só aponta pra arquivo privado enviado pelo próprio usuário.
  let resumeUrl: string | null | undefined;
  if (body.resumeDataUrl !== undefined) {
    // Caminho curto: envia o PDF como data URL junto do PUT do perfil.
    const saved = await saveDataUrlFile(String(body.resumeDataUrl), `private/${user.id}`);
    if ("error" in saved) return NextResponse.json({ error: `currículo: ${saved.error}` }, { status: 422 });
    resumeUrl = saved.url;
  } else if (body.resumeUrl !== undefined) {
    const v = String(body.resumeUrl ?? "").trim();
    if (v && !v.startsWith("/api/uploads/private/")) {
      return NextResponse.json(
        { error: "resumeUrl deve apontar para /api/uploads/private/ (envie o arquivo antes)" },
        { status: 422 }
      );
    }
    resumeUrl = v || null;
  }

  // ----- Experiências (substituição integral) -----
  let experiences: ExperienceInput[] = [];
  if (body.experiences !== undefined) {
    if (!Array.isArray(body.experiences)) {
      return NextResponse.json({ error: "experiences deve ser uma lista" }, { status: 422 });
    }
    if (body.experiences.length > MAX_EXPERIENCES) {
      return NextResponse.json({ error: `Máximo de ${MAX_EXPERIENCES} experiências` }, { status: 422 });
    }
    experiences = body.experiences as ExperienceInput[];
    for (const exp of experiences) {
      if (!exp.company || !exp.role || !exp.periodStart) {
        return NextResponse.json(
          { error: "Cada experiência precisa de empresa, cargo e período inicial (MM-AAAA)" },
          { status: 422 }
        );
      }
      if (!MM_AAAA.test(exp.periodStart) || (exp.periodEnd && !MM_AAAA.test(exp.periodEnd))) {
        return NextResponse.json({ error: "Período no formato MM-AAAA (ex: 03-2022)" }, { status: 422 });
      }
    }
  }

  // ----- Portfólio (substituição integral; aceita data URL ou URL já salva) -----
  type SavedItem = { kind: "FOTO" | "VIDEO"; url: string };
  let portfolio: SavedItem[] = [];
  if (body.portfolio !== undefined) {
    if (!Array.isArray(body.portfolio) || body.portfolio.length > MAX_PORTFOLIO) {
      return NextResponse.json({ error: `portfolio: máximo de ${MAX_PORTFOLIO} itens` }, { status: 422 });
    }
    const items = body.portfolio as PortfolioInput[];
    for (const item of items) {
      const kind = item.kind === "VIDEO" ? "VIDEO" : "FOTO";
      if (item.dataUrl) {
        const saved = await saveDataUrlFile(item.dataUrl, `portfolio/${user.id}`);
        if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 422 });
        // Vídeo curto só (até 60s é regra do produto; validação real de
        // duração depende do processamento de mídia, Fase 6)
        portfolio.push({ kind, url: saved.url });
      } else if (item.url && String(item.url).startsWith("/api/uploads/")) {
        portfolio.push({ kind, url: String(item.url) });
      } else {
        return NextResponse.json(
          { error: "Cada item de portfólio precisa de dataUrl ou url de /api/uploads/" },
          { status: 422 }
        );
      }
    }
  }

  const profile = await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {
      ...(bio !== undefined ? { bio } : {}),
      ...(headline !== undefined ? { headline } : {}),
      ...(region !== undefined ? { region } : {}),
      ...(body.categories !== undefined ? { categories } : {}),
      ...(body.availability !== undefined ? { availability } : {}),
      ...(body.softSkills !== undefined ? { softSkills } : {}),
      ...(body.referencePriceCents !== undefined ? { referencePriceCents: referencePriceCents ?? null } : {}),
      ...(body.resumeUrl !== undefined || body.resumeDataUrl !== undefined ? { resumeUrl } : {}),
      // isInfluencer acompanha a categoria "influenciador-digital"
      ...(body.categories !== undefined
        ? { isInfluencer: categories.includes("influenciador-digital") }
        : {}),
    },
  });

  if (body.experiences !== undefined) {
    await prisma.$transaction([
      prisma.workExperience.deleteMany({ where: { userId: user.id } }),
      prisma.workExperience.createMany({
        data: experiences.map((exp, i) => ({
          userId: user.id,
          company: String(exp.company).trim().slice(0, 120),
          role: String(exp.role).trim().slice(0, 120),
          periodStart: String(exp.periodStart),
          periodEnd: exp.periodEnd ? String(exp.periodEnd) : null,
          // preserva a ordem enviada (createMany não respeita ordem por si só)
          createdAt: new Date(Date.now() + i),
        })),
      }),
    ]);
  }

  if (body.portfolio !== undefined) {
    await prisma.$transaction([
      prisma.portfolioItem.deleteMany({ where: { userId: user.id } }),
      prisma.portfolioItem.createMany({
        data: portfolio.map((item, i) => ({
          userId: user.id,
          kind: item.kind,
          url: item.url,
          position: i,
        })),
      }),
    ]);
  }

  const updated = await loadProfileBundle(user.id);

  // Dados que vivem no User (Pix + endereço/renda de subconta) — atualização
  // separada do perfil do papel. Uma única escrita, só com o que foi enviado.
  const userData: {
    pixKey?: string | null;
    postalCode?: string | null;
    address?: string | null;
    addressNumber?: string | null;
    province?: string | null;
    incomeValueCents?: number | null;
  } = {
    ...(pixKey !== undefined ? { pixKey } : {}),
    ...subaccountProfile,
  };
  if (Object.keys(userData).length > 0) {
    await prisma.user.update({ where: { id: user.id }, data: userData });
  }

  return NextResponse.json({
    profile: updated,
    profileStrength: updated ? computeProfileStrength(updated) : 0,
    pixKey: pixKey !== undefined ? pixKey : user.pixKey,
  });
}

/**
 * Força do perfil (0-100): indicador interno, visível só para o próprio
 * usuário — nunca no perfil público. Peso maior em foto, bio e categorias.
 */
function computeProfileStrength(profile: {
  bio: string | null;
  categories: string[];
  headline: string | null;
  region: string | null;
  referencePriceCents: number | null;
  availability: string[];
  softSkills: string[];
  resumeUrl: string | null;
  portfolioItems: unknown[];
  workExperiences: unknown[];
}): number {
  let score = 0;
  if (profile.portfolioItems.length > 0) score += 30;
  if (profile.bio && profile.bio.length >= 80) score += 20;
  else if (profile.bio) score += 10;
  if (profile.categories.length > 0) score += 15;
  if (profile.headline) score += 10;
  if (profile.region) score += 10;
  if (profile.availability.length > 0) score += 5;
  if (profile.softSkills.length > 0) score += 5;
  if (profile.workExperiences.length > 0) score += 5;
  if (profile.referencePriceCents) score += 5;
  if (profile.resumeUrl) score += 5;
  return Math.min(100, score);
}
