import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess } from "@/lib/internalAuth";
import { listAllSettings } from "@/services/settingsService";

/**
 * GET /api/admin/settings
 * Lista as configurações financeiras editáveis (Fase 5b).
 *
 * Somente leitura: alteração passa por POST /api/admin/settings/[key], que é
 * auditado (SETTING_CHANGED) e invalidado no cache na hora.
 */
export async function GET(req: NextRequest) {
  const access = await checkAdminAccess(req);
  if (!access.granted) {
    return NextResponse.json(access.error.body, { status: access.error.status });
  }

  const settings = await listAllSettings();
  return NextResponse.json({ settings });
}
