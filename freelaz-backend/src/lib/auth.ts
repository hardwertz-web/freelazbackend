import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE = "freelaz_session";
const SESSION_DAYS = 7;
const TOKEN_TTL_MINUTES = 30; // reset de senha / confirmação de e-mail

// ----- Senha -----

// scrypt do próprio Node (sem dependência nativa externa, que quebra fácil
// em Windows). Formato guardado: scrypt$hashEmHex$ saltEmHex.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${derived.toString("hex")}$${salt.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [scheme, hashHex, saltHex] = stored.split("$");
  if (scheme !== "scrypt" || !hashHex || !saltHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === derived.length && timingSafeEqual(derived, expected);
}

// ----- Tokens opacos (sessão e links de uso único) -----

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Gera o token cru (entregue ao cliente) e o hash (guardado no banco). */
export function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: sha256(raw) };
}

// ----- Sessão -----

export async function createSession(userId: string): Promise<void> {
  const { raw, hash } = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { tokenHash: hash, userId, expiresAt } });
  cookies().set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (raw) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(raw) } });
  }
  cookies().delete(SESSION_COOKIE);
}

/** Usuário logado, ou null. Sessão expirada é apagada em silêncio. */
export async function getCurrentUser() {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: { include: { roles: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

/**
 * Exige sessão válida; retorna o erro HTTP pronto para a rota responder
 * caso não haja usuário (padrão `{ error: string }` do projeto).
 */
export async function requireUser(): Promise<
  | { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; error?: undefined }
  | { user?: undefined; error: { status: number; body: { error: string } } }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: { status: 401, body: { error: "Não autenticado" } } };
  }
  return { user };
}

/** Exige um papel ATIVO na conta (papéis PENDENTEs não passam por aqui). */
export function hasActiveRole(
  user: { roles: { role: string; status: string }[] },
  role: "PROFISSIONAL" | "CONTRATANTE"
): boolean {
  return user.roles.some((r) => r.role === role && r.status === "ATIVO");
}

/**
 * Conta com o papel ADMIN ativo (painel administrativo — Fase 5). O papel é
 * atribuído manualmente pelo operador, nunca por auto-cadastro.
 */
export function isAdmin(
  user: { roles: { role: string; status: string }[] } | null
): boolean {
  return (
    !!user && user.roles.some((r) => r.role === "ADMIN" && r.status === "ATIVO")
  );
}

// ----- Tokens de uso único (reset de senha, confirmação) -----

export async function createOneTimeToken(
  userId: string,
  type: "EMAIL_CONFIRM" | "PASSWORD_RESET"
): Promise<string> {
  const { raw, hash } = newToken();
  await prisma.authToken.create({
    data: {
      userId,
      type,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
    },
  });
  return raw;
}

/**
 * Consome um token: válido, não usado e não expirado → devolve o userId e
 * marca como usado (uso único garantido no banco, não só na lógica).
 */
export async function consumeOneTimeToken(
  raw: string,
  type: "EMAIL_CONFIRM" | "PASSWORD_RESET"
): Promise<string | null> {
  const token = await prisma.authToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) {
    return null;
  }
  await prisma.authToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  });
  return token.userId;
}
