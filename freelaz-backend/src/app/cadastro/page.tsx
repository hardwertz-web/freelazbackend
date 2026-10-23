"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import { AuthShell, authStyles } from "@/components/AuthShell";
import { Button } from "@/components/Button";

type DocumentType = "CPF" | "CNPJ";
type RoleValue = "PROFISSIONAL" | "CONTRATANTE";

/**
 * POST /api/auth/register — cadastro único com papéis ativáveis.
 * O papel Profissional nasce PENDENTE (exige verificação); Contratante nasce
 * ATIVO. A Home funciona para os dois.
 */
export default function CadastroPage() {
  const router = useRouter();

  const [documentType, setDocumentType] = useState<DocumentType>("CPF");
  const [document, setDocument] = useState("");
  const [name, setName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<RoleValue[]>(["PROFISSIONAL"]);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiGet<unknown>("/api/auth/me");
      if (alive && result.ok) router.replace("/");
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  function toggleRole(role: RoleValue) {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role]
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (roles.length === 0) {
      setError("Escolha ao menos um papel: oferecer serviços, contratar, ou os dois.");
      return;
    }

    setSubmitting(true);
    const result = await apiPost<{ user: unknown; nextStep: string }>("/api/auth/register", {
      documentType,
      document,
      name,
      ...(documentType === "CNPJ" ? { tradeName } : {}),
      ...(documentType === "CPF" ? { birthDate } : {}),
      email: email.trim(),
      phone,
      password,
      roles,
      acceptedTerms,
    });

    if (result.ok) {
      router.replace("/");
      router.refresh();
      return;
    }

    setError(result.error);
    setSubmitting(false);
  }

  const isCompany = documentType === "CNPJ";

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Uma conta serve para oferecer serviços e para contratar."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className={authStyles.link}>
            Entrar
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
          <span className={authStyles.label}>Tipo de documento</span>
          <div className={authStyles.segmented}>
            <button
              type="button"
              className={[authStyles.segment, documentType === "CPF" && authStyles.segmentActive]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setDocumentType("CPF")}
              aria-pressed={documentType === "CPF"}
            >
              CPF (pessoa)
            </button>
            <button
              type="button"
              className={[authStyles.segment, documentType === "CNPJ" && authStyles.segmentActive]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setDocumentType("CNPJ")}
              aria-pressed={documentType === "CNPJ"}
            >
              CNPJ (empresa)
            </button>
          </div>
        </div>

        <div className={authStyles.field}>
          <label className={authStyles.label} htmlFor="document">
            {documentType}
          </label>
          <input
            id="document"
            className={authStyles.input}
            value={document}
            onChange={(event) => setDocument(event.target.value)}
            placeholder={isCompany ? "00.000.000/0000-00" : "000.000.000-00"}
            inputMode="numeric"
            required
          />
        </div>

        <div className={authStyles.field}>
          <label className={authStyles.label} htmlFor="name">
            {isCompany ? "Razão social" : "Nome completo"}
          </label>
          <input
            id="name"
            className={authStyles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={isCompany ? "Minha Empresa Ltda" : "Maria da Silva"}
            autoComplete="name"
            required
          />
        </div>

        {isCompany ? (
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="tradeName">
              Nome fantasia (opcional)
            </label>
            <input
              id="tradeName"
              className={authStyles.input}
              value={tradeName}
              onChange={(event) => setTradeName(event.target.value)}
              placeholder="Como a empresa aparece nas vagas"
            />
          </div>
        ) : (
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="birthDate">
              Data de nascimento
            </label>
            <input
              id="birthDate"
              className={authStyles.input}
              type="date"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
              required
            />
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

        <div className={authStyles.row2}>
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="phone">
              Telefone
            </label>
            <input
              id="phone"
              className={authStyles.input}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(35) 99999-0000"
              inputMode="tel"
              autoComplete="tel"
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
              placeholder="Mín. 8 caracteres"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        </div>

        <div className={authStyles.field}>
          <span className={authStyles.label}>O que você quer fazer?</span>
          <div className={authStyles.roles}>
            <label
              className={[
                authStyles.roleOption,
                roles.includes("PROFISSIONAL") && authStyles.roleOptionActive,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type="checkbox"
                checked={roles.includes("PROFISSIONAL")}
                onChange={() => toggleRole("PROFISSIONAL")}
              />
              <span>
                Oferecer serviços
                <br />
                <span className={authStyles.hint}>perfil profissional</span>
              </span>
            </label>
            <label
              className={[
                authStyles.roleOption,
                roles.includes("CONTRATANTE") && authStyles.roleOptionActive,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type="checkbox"
                checked={roles.includes("CONTRATANTE")}
                onChange={() => toggleRole("CONTRATANTE")}
              />
              <span>
                Contratar
                <br />
                <span className={authStyles.hint}>publicar vagas</span>
              </span>
            </label>
          </div>
        </div>

        <label className={authStyles.checkbox}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            required
          />
          <span>
            Li e aceito os Termos de Uso e a Política de Privacidade (LGPD). Tenho 18 anos ou
            mais.
          </span>
        </label>

        <Button type="submit" block disabled={submitting || !acceptedTerms}>
          {submitting ? "Criando conta..." : "Criar conta"}
        </Button>
      </form>
    </AuthShell>
  );
}
