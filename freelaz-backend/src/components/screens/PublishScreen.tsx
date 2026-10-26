"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import type { JobDetailResponse, MeResponse } from "@/lib/apiTypes";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { CheckIcon, ChevronLeftIcon } from "@/components/Icons";
import styles from "./PublishScreen.module.css";

/** Modalidades oferecidas no formulário. PRESTADORA existe na API, não aqui. */
type PublishModality = "FREELANCE" | "CLT";

/**
 * Categorias conhecidas da plataforma (as mesmas com imagem em
 * `public/categories/` + as que já existem em vagas). Lista fixa de propósito:
 * `/api/jobs` aberto pode estar vazio e o select não pode ficar sem opções.
 */
const CATEGORIES: { value: string; label: string }[] = [
  { value: "eventos", label: "Eventos" },
  { value: "garcom", label: "Garçom" },
  { value: "bartender", label: "Bartender" },
  { value: "seguranca", label: "Segurança" },
  { value: "limpeza", label: "Limpeza" },
  { value: "diarista", label: "Diarista" },
  { value: "cozinheiro", label: "Cozinheiro" },
  { value: "pedreiro", label: "Pedreiro" },
  { value: "eletricista", label: "Eletricista" },
  { value: "encanador", label: "Encanador" },
  { value: "construcao", label: "Construção" },
  { value: "administracao", label: "Administração" },
  { value: "fotografo", label: "Fotógrafo" },
  { value: "dj", label: "DJ" },
  { value: "motorista", label: "Motorista" },
  { value: "recepcionista", label: "Recepcionista" },
  { value: "jardineiro", label: "Jardineiro" },
  { value: "musica", label: "Música" },
];

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function PublishScreen() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [value, setValue] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [city, setCity] = useState("");
  const [uf, setUf] = useState("");
  const [modality, setModality] = useState<PublishModality>("FREELANCE");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  // Cidade/UF já vêm do perfil da empresa: o formulário só confirma/atualiza.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const me = await apiGet<MeResponse>("/api/auth/me");
      if (!alive || !me.ok) return;
      setCity((current) => current || me.data.user.city || "");
      setUf((current) => current || me.data.user.state || "");
    })();
    return () => {
      alive = false;
    };
  }, []);

  // A vaga já foi criada: mostra o toast e abre o detalhe de verdade.
  useEffect(() => {
    if (!publishedId) return;
    const timer = window.setTimeout(() => router.push(`/vaga/${publishedId}`), 900);
    return () => window.clearTimeout(timer);
  }, [publishedId, router]);

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};

    const cleanTitle = title.trim();
    if (cleanTitle.length < 3) next.title = "Informe um título com pelo menos 3 caracteres.";
    else if (cleanTitle.length > 120) next.title = "O título pode ter no máximo 120 caracteres.";

    const cleanDescription = description.trim();
    if (cleanDescription.length < 10) {
      next.description = "Descreva a vaga com pelo menos 10 caracteres.";
    } else if (cleanDescription.length > 4000) {
      next.description = "A descrição pode ter no máximo 4000 caracteres.";
    }

    if (!category) next.category = "Selecione uma categoria.";
    if (!value || Number(value) <= 0) next.value = "Informe um valor maior que zero.";

    if (!startsAt) next.startsAt = "Informe o início.";
    if (!endsAt) next.endsAt = "Informe o fim.";
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      next.endsAt = "O fim precisa ser depois do início.";
    }

    if (!city.trim()) next.city = "Informe a cidade.";
    if (uf.trim().length !== 2) next.uf = "UF com 2 letras.";

    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || publishedId) return;

    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      // Cidade/UF agora são campos da própria vaga (Fase 2.3b). Antes o form
      // fazia um PUT /api/profile/contractor como workaround — isso mudava o
      // endereço da empresa ao publicar. Não fazer mais isso.
      const created = await apiPost<JobDetailResponse>("/api/jobs", {
        title: title.trim(),
        description: description.trim(),
        category,
        city: city.trim(),
        state: uf.trim().toUpperCase(),
        modality,
        valueCents: Number(value) * 100,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      if (!created.ok) {
        setFormError(created.error);
        return;
      }

      setPublishedId(created.data.jobPosting.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <Link href="/" className={styles.back}>
        <ChevronLeftIcon size={16} /> Voltar para as vagas
      </Link>

      <header className={styles.head}>
        <h1 className={styles.title}>Publicar vaga</h1>
        <p className={styles.subtitle}>
          Descreva o serviço, o valor e o horário. A vaga aparece na Home para os
          profissionais da região.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className={styles.form}>
        {formError && (
          <div className={styles.alert} role="alert">
            {formError}
          </div>
        )}

        <Card className={styles.card}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-title">
              Título da vaga
            </label>
            <input
              id="job-title"
              className={styles.input}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Garçom para jantar de sábado"
              maxLength={120}
              aria-invalid={Boolean(errors.title)}
            />
            {errors.title && <span className={styles.error}>{errors.title}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-description">
              Descrição
            </label>
            <textarea
              id="job-description"
              className={styles.textarea}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="O que precisa ser feito, uniforme, experiência…"
              rows={4}
              maxLength={4000}
              aria-invalid={Boolean(errors.description)}
            />
            {errors.description && <span className={styles.error}>{errors.description}</span>}
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="job-category">
                Categoria
              </label>
              <select
                id="job-category"
                className={styles.select}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-invalid={Boolean(errors.category)}
              >
                <option value="">Selecione…</option>
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              {errors.category && <span className={styles.error}>{errors.category}</span>}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="job-value">
                Valor por dia
              </label>
              <div className={styles.money}>
                <span className={styles.moneyPrefix}>R$</span>
                <input
                  id="job-value"
                  className={styles.moneyInput}
                  value={value}
                  onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
                  placeholder="180"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.value)}
                />
              </div>
              {errors.value && <span className={styles.error}>{errors.value}</span>}
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="job-starts">
                Início
              </label>
              <input
                id="job-starts"
                type="datetime-local"
                className={styles.input}
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                aria-invalid={Boolean(errors.startsAt)}
              />
              {errors.startsAt && <span className={styles.error}>{errors.startsAt}</span>}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="job-ends">
                Fim
              </label>
              <input
                id="job-ends"
                type="datetime-local"
                className={styles.input}
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                aria-invalid={Boolean(errors.endsAt)}
              />
              {errors.endsAt && <span className={styles.error}>{errors.endsAt}</span>}
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="job-city">
                Cidade
              </label>
              <input
                id="job-city"
                className={styles.input}
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Ex.: Itajubá"
                maxLength={80}
                aria-invalid={Boolean(errors.city)}
              />
              {errors.city && <span className={styles.error}>{errors.city}</span>}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="job-uf">
                UF
              </label>
              <select
                id="job-uf"
                className={styles.select}
                value={uf}
                onChange={(event) => setUf(event.target.value)}
                aria-invalid={Boolean(errors.uf)}
              >
                <option value="">—</option>
                {UFS.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              {errors.uf && <span className={styles.error}>{errors.uf}</span>}
            </div>
          </div>
          <span className={styles.helper}>
            Cidade e UF ficam na vaga e aparecem no anúncio.
          </span>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-modality">
              Modalidade
            </label>
            <select
              id="job-modality"
              className={styles.select}
              value={modality}
              onChange={(event) => setModality(event.target.value as PublishModality)}
            >
              <option value="FREELANCE">Freelance</option>
              <option value="CLT">CLT</option>
            </select>
            <span className={styles.helper}>
              CLT por enquanto é só uma classificação da vaga; o fluxo comercial
              completo chega numa fase seguinte.
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-visibility">
              Visibilidade
            </label>
            <select id="job-visibility" className={styles.select} defaultValue="PUBLICA">
              <option value="PUBLICA">Pública — qualquer profissional pode se candidatar</option>
              <option value="PRIVADA" disabled>
                Privada — convite direto (em breve)
              </option>
            </select>
            <span className={styles.helper}>
              A publicação pública é sempre PÚBLICA. Vagas privadas nascem pelo
              fluxo “Me contrate”.
            </span>
          </div>
        </Card>

        <Button type="submit" block disabled={submitting || Boolean(publishedId)}>
          {submitting ? "Publicando…" : "Publicar vaga"}
        </Button>
      </form>

      {publishedId && (
        <div className={styles.toast} role="status" aria-live="polite">
          <CheckIcon size={16} /> Vaga publicada
        </div>
      )}
    </div>
  );
}
