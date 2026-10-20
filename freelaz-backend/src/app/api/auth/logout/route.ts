import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

/** POST /api/auth/logout — encerra a sessão atual (cookie apagado). */
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
