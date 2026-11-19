"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import type { MeResponse } from "@/lib/apiTypes";
import { AuthShell, authStyles } from "@/components/AuthShell";
import { Button } from "@/components/Button";

/**
 * Destino pós-login. Ordem de prioridade:
 *  1) ?redirect= interno (valida // e URLs absolutas)
 *  2) /perfil#papeis se PROFISSIONAL estiver PENDENTE
 *  3) / (HOME)
 *
 * Recebe o MeResponse já carregado para evitar requests duplicados.
 */
function resolveFromMe(me: MeResponse): string {
  const raw =
    new URLSearchParams(window.location.search).get("redirect") ?? "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  const prof = me.roles?.find((r) => r.role === "PROFISSIONAL");
  return prof?.status === "PENDENTE" ? "/perfil#papeis" : "/";
}

/** POST /api/auth/login → cookie de sessão httpOnly → Home (ou `?redirect=`). */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Quem já tem sessão não precisa ver o login.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const me = await apiGet<MeResponse>("/api/auth/me");
      if (alive && me.ok) router.replace(resolveFromMe(me.data));
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await apiPost<{ user: unknown }>("/api/auth/login", {
      email: email.trim(),
      password,
    });

    if (result.ok) {
      const meRes = await apiGet<MeResponse>("/api/auth/me");
      const target = meRes.ok ? resolveFromMe(meRes.data) : "/";
      router.replace(target);
      router.refresh();
      return;
    }

    setError(result.error);
    setSubmitting(false);
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse sua conta para ver vagas e conversas."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className={authStyles.link}>
            Criar conta
          </Link>
        </>
      }
    >
      <form className={authStyles.form} onSubmit={handleSubmit}>
        {error && (
          <div className={authStyles.error} role="alert">
            {error}
          </div>
        )}

        <div className={authStyles.field}>
          <label className={authStyles.label} htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            className={authStyles.input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@exemplo.com"
            autoComplete="email"
            required
          />
        </div>

        <div className={authStyles.field}>
          <label className={authStyles.label} htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            className={authStyles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
            autoComplete="current-password"
            required
          />
        </div>

        <Button type="submit" block disabled={submitting || !email.trim() || !password}>
          {submitting ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
