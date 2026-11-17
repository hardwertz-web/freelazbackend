import { NextResponse } from "next/server";
import { requireUser, hasActiveRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/auth/toggle-mode
 * Alterna o modo ativo da interface entre PROFISSIONAL e CONTRATANTE.
 * BOTH é reservado e não pode ser alternado por aqui.
 */
export async function POST() {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json(auth.error.body, { status: auth.error.status });
  }

  const current = ((auth.user as any).activeMode as string | undefined) ?? "PROFISSIONAL";
  let next: "PROFISSIONAL" | "CONTRATANTE";
  if (current === "PROFISSIONAL") next = "CONTRATANTE";
  else if (current === "CONTRATANTE") next = "PROFISSIONAL";
  else {
    return NextResponse.json(
      { error: "Não é possível alternar o modo neste momento." },
      { status: 400 }
    );
  }

  // Não permitir trocar para um modo cujo papel não está ATIVO.
  // Sem isso, o banco fica com activeMode inválido (ex: PROFISSIONAL puro
  // em modo CONTRATANTE) e a carteira renderiza a view errada.
  if (!hasActiveRole(auth.user, next)) {
    return NextResponse.json(
      {
        error: `Ative o papel ${next === "PROFISSIONAL" ? "Profissional" : "Contratante"} primeiro para alternar para esse modo.`,
      },
      { status: 403 }
    );
  }

  try {
    const updated = await prisma.user.update({
      where: { id: auth.user.id },
      data: { activeMode: next as any },
      select: { activeMode: true },
    });
    return NextResponse.json({ activeMode: (updated as any).activeMode ?? next });
  } catch (err) {
    console.error("[Freelaz] toggle-mode:", err);
    return NextResponse.json({ error: "Não foi possível alterar o modo." }, { status: 500 });
  }
}
