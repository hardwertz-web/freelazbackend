import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { resolveUploadPath } from "@/lib/uploads";
import { isR2Configured, getObjectFromR2 } from "@/lib/r2Service";

/**
 * GET /api/uploads/<caminho relativo>
 *
 * Serve os arquivos enviados pelos usuários. Regras:
 * - verifications/ e private/ → só o próprio usuário (dono do subdiretório)
 *   - documentos/selfie/currículo nunca ficam públicos;
 *   - exceção única: conta com papel ADMIN (painel Fase 5) — o painel existe
 *     justamente para analisar essas provas, e o acesso é de sessão, nunca
 *     público;
 * - portfolio/ → qualquer usuário logado (fotos de portfólio do perfil).
 * Fora do UPLOAD_ROOT o acesso é recusado (path traversal).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const relativePath = params.path.join("/");
  const fullPath = resolveUploadPath(relativePath);
  if (!fullPath) {
    return NextResponse.json({ error: "Caminho inválido" }, { status: 400 });
  }

  const [scope, ownerId] = relativePath.split("/");
  if (
    (scope === "verifications" || scope === "private") &&
    ownerId !== user.id &&
    !isAdmin(user)
  ) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const ext = relativePath.split(".").pop()?.toLowerCase();
  const mime =
    ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : ext === "pdf" ? "application/pdf"
    : "image/jpeg";

  // 1) Se R2 está configurado, tentar R2 primeiro.
  if (isR2Configured()) {
    const result = await getObjectFromR2(relativePath);
    if (result.ok) {
      return new NextResponse(result.body as Uint8Array, {
        headers: {
          "Content-Type": result.contentType ?? mime,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
    // Cai para tentar fs (fallback para dev com arquivo local).
  }

  // 2) Fallback: filesystem (dev).
  try {
    const bytes = await readFile(fullPath);
    return new NextResponse(bytes, {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }
}
