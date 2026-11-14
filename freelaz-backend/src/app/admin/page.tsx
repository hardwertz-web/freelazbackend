"use client";

/**
 * Painel administrativo (Fase 5) — interface mínima para OPERAR o que já
 * existe no backend: disputas, denúncias, verificação de identidade,
 * consulta financeira (contratações, repasses, lançamentos), reconciliação
 * e disparo do lote de repasses.
 *
 * Proteção: a página não guarda segredo nenhum — todas as chamadas usam a
 * cookie de sessão, e as rotas `/api/admin/*` só respondem para conta com
 * papel ADMIN ativo (ou com o segredo interno, que nunca aparece aqui).
 * Documentos e evidências são abertos por `/api/uploads/...`, que também
 * checa o papel ADMIN.
 *
 * Este painel NÃO move dinheiro por conta própria: decisões de disputa e o
 * lote de repasses chamam os MESMOS serviços auditados usados pelas rotas
 * internas. Nenhuma regra de comissão/estado/reembolso mora aqui.
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

// ----- helpers -----

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR") : "—";

/**
 * Espelho de leitura do ledger no cliente: saldo operacional (o que move
 * dinheiro) e ajustado (operacional - AJUSTE, contábil). Espelha
 * `computeRetainedBalance`/`computeAdjustedBalance` do backend — se divergir
 * da reconciliação, o painel mostra X !== Y e libera o ajuste.
 */
const balancesOf = (entries: { type: string; amountCents: number }[]) => {
  let operational = 0;
  let adjustments = 0;
  for (const entry of entries) {
    if (entry.type === "RETENCAO") operational += entry.amountCents;
    else if (entry.type === "LIBERACAO" || entry.type === "REEMBOLSO") operational -= entry.amountCents;
    else if (entry.type === "AJUSTE") adjustments += entry.amountCents;
  }
  return { operational, adjusted: operational - adjustments };
};

const TABS = [
  { key: "disputas", label: "Disputas" },
  { key: "denuncias", label: "Denúncias" },
  { key: "identidade", label: "Identidade" },
  { key: "financeiro", label: "Financeiro" },
  { key: "auditoria", label: "Auditoria" },
] as const;

type Me = { id: string; name: string; email: string };

type DisputeRow = {
  id: string;
  reason: string;
  openedBySide: string;
  createdAt: string;
  hiring: {
    id: string;
    jobTitle: string;
    status: string;
    grossValueCents: number;
    netValueCents: number;
    contractor: { id: string; name: string; documentMasked: string };
    professional: { id: string; name: string; documentMasked: string };
  };
  evidences: { id: string; url: string; kind: string | null; uploadedByName: string | null; createdAt: string }[];
};

type ReportRow = {
  id: string;
  category: string;
  priority: string;
  description: string;
  createdAt: string;
  reporter: { id: string; name: string };
  reported: { id: string; name: string };
  hiring: { id: string; jobTitle: string; status: string } | null;
};

type VerificationRow = {
  id: string;
  role: string;
  documentUrl: string | null;
  selfieUrl: string | null;
  submittedAt: string;
  autoDecision: string | null;
  reviewReasons: string[];
  autoConfidence: number | null;
  user: { id: string; name: string; tradeName: string | null; documentType: string; documentMasked: string };
};

type HiringRow = {
  id: string;
  jobTitle: string;
  status: string;
  grossValueCents: number;
  netValueCents: number;
  commissionBps: number;
  createdAt: string;
  closingCodeUsedAt: string | null;
  contractor: { name: string; documentMasked: string };
  professional: { name: string; documentMasked: string };
  payout: { id: string; status: string; amountCents: number; providerTransferId: string | null } | null;
  ledgerEntries: { id: string; type: string; amountCents: number; reason: string; createdBy: string }[];
};

type PayoutRow = {
  id: string;
  hiringId: string;
  amountCents: number;
  status: string;
  providerTransferId: string | null;
  failureReason: string | null;
  updatedAt: string;
  professional: { id: string; name: string };
  hiring: { id: string; jobTitle: string; status: string };
};

type LedgerRow = {
  id: string;
  hiringId: string;
  type: string;
  amountCents: number;
  reason: string;
  createdBy: string;
  createdAt: string;
  hiring: { id: string; jobTitle: string; status: string };
};

type ReconciliationPayload = {
  report: {
    ok: boolean;
    generatedAt: string;
    totals: {
      retainedCents: number;
      adjustedCents: number;
      pendingAdjustmentCents: number;
      hiringCount: number;
      payoutCount: number;
      releasedCount: number;
    };
    checks: { name: string; passed: boolean; detail: string }[];
    discrepancies: string[];
  };
  failedPayouts: { id: string; hiringId: string; amountCents: number; failureReason: string | null; updatedAt: string }[];
  adjustments: { id: string; hiringId: string; amountCents: number; reason: string; createdBy: string; createdAt: string }[];
};

type AuditRow = {
  id: string;
  adminId: string;
  adminVia: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

// ----- estilos (neutros; nada de identidade visual inventada) -----

const S: Record<string, CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto", color: "#1a1a1a" },
  card: { border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fff" },
  input: { border: "1px solid #ccc", borderRadius: 6, padding: "8px 10px", fontSize: 14 },
  btn: { border: "1px solid #333", borderRadius: 6, padding: "8px 14px", fontSize: 14, cursor: "pointer", background: "#222", color: "#fff" },
  btnGhost: { border: "1px solid #999", borderRadius: 6, padding: "8px 14px", fontSize: 14, cursor: "pointer", background: "#fff", color: "#222" },
  tabOn: { border: "1px solid #333", borderRadius: 6, padding: "8px 14px", fontSize: 14, cursor: "pointer", background: "#222", color: "#fff" },
  tabOff: { border: "1px solid #bbb", borderRadius: 6, padding: "8px 14px", fontSize: 14, cursor: "pointer", background: "#f5f5f5", color: "#444" },
  th: { textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 8px", fontSize: 13, color: "#555" },
  td: { borderBottom: "1px solid #eee", padding: "6px 8px", fontSize: 13, verticalAlign: "top" },
  muted: { color: "#777", fontSize: 12 },
  err: { color: "#a11", fontSize: 13 },
  ok: { color: "#17603a", fontSize: 13 },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

// ----- página -----

export default function AdminPage() {
  const [phase, setPhase] = useState<"loading" | "login" | "denied" | "ready">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"disputas" | "denuncias" | "identidade" | "financeiro" | "auditoria">("disputas");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);

  const flash = useCallback((msg: string, isError = false) => {
    setNotice(msg);
    setNoticeError(isError);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const data = await api<{ user: Me | null; roles: { role: string; status: string }[] }>("/api/auth/me");
      const isAdmin = data.roles.some((r) => r.role === "ADMIN" && r.status === "ATIVO");
      if (!data.user || !isAdmin) {
        setMe(null);
        setPhase(data.user ? "denied" : "login");
        return;
      }
      setMe(data.user);
      setPhase("ready");
    } catch {
      setPhase("login");
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  if (phase === "loading") return <main style={S.page}>Carregando…</main>;
  if (phase === "login") return <Login onLogged={loadMe} />;
  if (phase === "denied")
    return (
      <main style={S.page}>
        <h1>Painel administrativo</h1>
        <p style={S.err}>
          Sua conta não tem o papel ADMIN. A atribuição é feita pelo operador (fora da API).
        </p>
      </main>
    );

  return (
    <main style={S.page}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Painel administrativo</h1>
        <span style={S.muted}>
          {me?.name} ·{" "}
          <button
            style={S.btnGhost}
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              setPhase("login");
            }}
          >
            Sair
          </button>
        </span>
      </header>

      <nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} style={tab === t.key ? S.tabOn : S.tabOff} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {notice && (
        <p style={noticeError ? S.err : S.ok} role="status">
          {notice}
        </p>
      )}

      {tab === "disputas" && <DisputasTab onMessage={flash} />}
      {tab === "denuncias" && <DenunciasTab onMessage={flash} />}
      {tab === "identidade" && <IdentidadeTab onMessage={flash} />}
      {tab === "financeiro" && <FinanceiroTab onMessage={flash} />}
      {tab === "auditoria" && <AuditoriaTab onMessage={flash} />}
    </main>
  );
}

// ----- login -----

function Login({ onLogged }: { onLogged: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <main style={S.page}>
      <h1 style={{ fontSize: 22 }}>Painel administrativo — acesso</h1>
      <form
        style={{ ...S.card, maxWidth: 380, display: "grid", gap: 10 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
            onLogged();
          } catch (err) {
            setError(err instanceof Error ? err.message : "falha no login");
          }
        }}
      >
        <label>
          E-mail
          <br />
          <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <br />
          <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p style={S.err}>{error}</p>}
        <button style={S.btn} type="submit">
          Entrar
        </button>
      </form>
      <p style={S.muted}>
        Só contas com papel ADMIN entram. O papel é atribuído pelo operador, nunca pela interface.
      </p>
    </main>
  );
}

// ----- disputas -----

function DisputasTab({ onMessage }: { onMessage: (m: string, e?: boolean) => void }) {
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [resolution, setResolution] = useState("DEVOLUCAO_TOTAL");
  const [splitPercent, setSplitPercent] = useState("50");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ disputes: DisputeRow[] }>("/api/admin/disputes?status=EM_ANALISE");
      setRows(data.disputes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao carregar");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p style={S.err}>{error}</p>;
  if (!rows) return <p>Carregando disputas…</p>;
  if (rows.length === 0) return <p style={S.muted}>Nenhuma disputa em análise. 🎉</p>;

  return (
    <>
      {rows.map((d) => (
        <section key={d.id} style={S.card}>
          <p style={{ margin: "0 0 6px" }}>
            <strong>{d.hiring.jobTitle}</strong> · {brl(d.hiring.grossValueCents)} bruto / {brl(d.hiring.netValueCents)} líquido ·
            status {d.hiring.status}
          </p>
          <p style={{ margin: "0 0 6px" }}>
            Aberta por <strong>{d.openedBySide === "CONTRACTOR" ? "contratante" : "profissional"}</strong> em {dt(d.createdAt)}
          </p>
          <p style={{ margin: "0 0 6px" }}>Motivo: {d.reason}</p>
          <p style={{ ...S.muted, margin: "0 0 6px" }}>
            Contratante: {d.hiring.contractor.name} ({d.hiring.contractor.documentMasked}) · Profissional:{" "}
            {d.hiring.professional.name} ({d.hiring.professional.documentMasked})
          </p>
          {d.evidences.length > 0 && (
            <p style={{ margin: "0 0 6px" }}>
              Evidências:{" "}
              {d.evidences.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && " · "}
                  <a href={`/api/uploads/${e.url}`} target="_blank" rel="noreferrer">
                    {e.kind ?? "arquivo"}
                  </a>{" "}
                  ({e.uploadedByName ?? "desconhecido"}, {dt(e.createdAt)})
                </span>
              ))}
            </p>
          )}

          {deciding === d.id ? (
            <form
              style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 420 }}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(`/api/admin/disputes/${d.id}/resolve`, {
                    method: "POST",
                    body: JSON.stringify({
                      resolution,
                      decisionNote: note,
                      ...(resolution === "DIVISAO" ? { splitPercentToProfessional: Number(splitPercent) } : {}),
                    }),
                  });
                  onMessage("Disputa decidida — lançamentos auditados no ledger.");
                  setDeciding(null);
                  setNote("");
                  load();
                } catch (err) {
                  onMessage(err instanceof Error ? err.message : "erro ao decidir", true);
                }
              }}
            >
              <label>
                Decisão
                <br />
                <select style={S.input} value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  <option value="DEVOLUCAO_TOTAL">Devolução total (tudo volta à empresa)</option>
                  <option value="LIBERACAO_TOTAL">Liberação total (tudo ao profissional)</option>
                  <option value="DIVISAO">Divisão (percentual ao profissional)</option>
                </select>
              </label>
              {resolution === "DIVISAO" && (
                <label>
                  % do líquido ao profissional (1–99)
                  <br />
                  <input
                    style={S.input}
                    type="number"
                    min={1}
                    max={99}
                    value={splitPercent}
                    onChange={(e) => setSplitPercent(e.target.value)}
                  />
                </label>
              )}
              <label>
                Justificativa (obrigatória)
                <br />
                <textarea style={{ ...S.input, width: "100%" }} value={note} onChange={(e) => setNote(e.target.value)} required />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={S.btn} type="submit">
                  Confirmar decisão
                </button>
                <button style={S.btnGhost} type="button" onClick={() => setDeciding(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button style={S.btnGhost} onClick={() => setDeciding(d.id)}>
              Decidir
            </button>
          )}
        </section>
      ))}
    </>
  );
}

// ----- denúncias -----

function DenunciasTab({ onMessage }: { onMessage: (m: string, e?: boolean) => void }) {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("ACAO_TOMADA");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ reports: ReportRow[] }>("/api/admin/reports?status=ABERTA");
      setRows(data.reports);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao carregar");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p style={S.err}>{error}</p>;
  if (!rows) return <p>Carregando denúncias…</p>;
  if (rows.length === 0) return <p style={S.muted}>Nenhuma denúncia aberta.</p>;

  return (
    <>
      {rows.map((r) => (
        <section key={r.id} style={{ ...S.card, borderLeft: r.priority === "ALTA" ? "4px solid #a11" : "1px solid #ddd" }}>
          <p style={{ margin: "0 0 6px" }}>
            <strong>{r.category}</strong> · prioridade {r.priority} · {dt(r.createdAt)}
          </p>
          <p style={{ margin: "0 0 6px" }}>
            {r.reporter.name} denunciou {r.reported.name}
            {r.hiring ? ` · contratação: ${r.hiring.jobTitle} (${r.hiring.status})` : ""}
          </p>
          <p style={{ margin: "0 0 6px" }}>{r.description}</p>

          {deciding === r.id ? (
            <form
              style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 420 }}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(`/api/admin/reports/${r.id}/resolve`, {
                    method: "POST",
                    body: JSON.stringify({ outcome, decisionNote: note }),
                  });
                  onMessage("Denúncia encerrada com decisão auditada.");
                  setDeciding(null);
                  setNote("");
                  load();
                } catch (err) {
                  onMessage(err instanceof Error ? err.message : "erro ao decidir", true);
                }
              }}
            >
              <label>
                Desfecho
                <br />
                <select style={S.input} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="ACAO_TOMADA">Ação tomada</option>
                  <option value="ARQUIVADA">Arquivada</option>
                </select>
              </label>
              <label>
                Justificativa (obrigatória)
                <br />
                <textarea style={{ ...S.input, width: "100%" }} value={note} onChange={(e) => setNote(e.target.value)} required />
              </label>
              <p style={S.muted}>Denúncia nunca move dinheiro — dinheiro é decisão de disputa.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={S.btn} type="submit">
                  Encerrar denúncia
                </button>
                <button style={S.btnGhost} type="button" onClick={() => setDeciding(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button style={S.btnGhost} onClick={() => setDeciding(r.id)}>
              Analisar
            </button>
          )}
        </section>
      ))}
    </>
  );
}

// ----- identidade -----

function IdentidadeTab({ onMessage }: { onMessage: (m: string, e?: boolean) => void }) {
  const [rows, setRows] = useState<VerificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ verifications: VerificationRow[] }>("/api/admin/verifications?status=EM_ANALISE");
      setRows(data.verifications);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao carregar");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p style={S.err}>{error}</p>;
  if (!rows) return <p>Carregando fila de identidade…</p>;
  if (rows.length === 0) return <p style={S.muted}>Nenhuma verificação pendente.</p>;

  return (
    <>
      {rows.map((v) => (
        <section key={v.id} style={S.card}>
          <p style={{ margin: "0 0 6px" }}>
            <strong>{v.user.name}</strong>
            {v.user.tradeName ? ` (${v.user.tradeName})` : ""} · papel {v.role} · {v.user.documentType} {v.user.documentMasked} ·
            enviado em {dt(v.submittedAt)}
          </p>
          <p style={{ margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {v.autoDecision === "AUTO_OK" && (
              <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>AUTO_OK</span>
            )}
            {v.autoDecision === "REVIEW" && (
              <span style={{ background: "#fff3e0", color: "#ef6c00", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>REVIEW</span>
            )}
            {!v.autoDecision && (
              <span style={{ background: "#f5f5f5", color: "#666", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>Análise manual</span>
            )}
            {v.autoConfidence !== null && v.autoConfidence !== undefined && (
              <span style={S.muted}>{Math.round(v.autoConfidence)}% de confiança do OCR</span>
            )}
          </p>
          {v.reviewReasons && v.reviewReasons.length > 0 && (
            <p style={{ margin: "0 0 6px" }}>
              <span style={S.muted}>Motivos: </span>
              {v.reviewReasons.map((r, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {r === "low_confidence" ? "baixa confiança" :
                   r === "name_mismatch" ? "nome divergente" :
                   r === "cpf_mismatch" ? "CPF divergente" :
                   r === "birthdate_mismatch" ? "data de nascimento divergente" :
                   r === "missing_field" ? "campo ausente" :
                   r === "ocr_error" ? "erro no OCR" : r}
                </span>
              ))}
            </p>
          )}
          <p style={{ margin: "0 0 6px" }}>
            {v.documentUrl && (
              <a href={`/api/uploads/${v.documentUrl}`} target="_blank" rel="noreferrer">
                ver documento
              </a>
            )}
            {v.documentUrl && v.selfieUrl && " · "}
            {v.selfieUrl && (
              <a href={`/api/uploads/${v.selfieUrl}`} target="_blank" rel="noreferrer">
                ver selfie
              </a>
            )}
            {!v.documentUrl && !v.selfieUrl && <span style={S.muted}>conta CNPJ: sem anexos (CNPJ validado no cadastro)</span>}
          </p>

          {rejecting === v.id ? (
            <form
              style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 420 }}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(`/api/admin/verifications/${v.id}/reject`, {
                    method: "POST",
                    body: JSON.stringify({ reason }),
                  });
                  onMessage("Verificação rejeitada — o usuário pode reenviar corrigindo o motivo.");
                  setRejecting(null);
                  setReason("");
                  load();
                } catch (err) {
                  onMessage(err instanceof Error ? err.message : "erro ao rejeitar", true);
                }
              }}
            >
              <label>
                Motivo da rejeição (obrigatório, vai para o usuário)
                <br />
                <textarea style={{ ...S.input, width: "100%" }} value={reason} onChange={(e) => setReason(e.target.value)} required />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={S.btn} type="submit">
                  Confirmar rejeição
                </button>
                <button style={S.btnGhost} type="button" onClick={() => setRejecting(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={S.btn}
                onClick={async () => {
                  try {
                    await api(`/api/admin/verifications/${v.id}/approve`, { method: "POST", body: "{}" });
                    onMessage("Identidade aprovada — papel ativado.");
                    load();
                  } catch (err) {
                    onMessage(err instanceof Error ? err.message : "erro ao aprovar", true);
                  }
                }}
              >
                Aprovar
              </button>
              <button style={S.btnGhost} onClick={() => setRejecting(v.id)}>
                Rejeitar
              </button>
            </div>
          )}
        </section>
      ))}
    </>
  );
}

// ----- financeiro -----

function FinanceiroTab({ onMessage }: { onMessage: (m: string, e?: boolean) => void }) {
  const [hirings, setHirings] = useState<HiringRow[] | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[] | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [recon, setRecon] = useState<ReconciliationPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Formulário de AJUSTE manual (correção de divergência de reconciliação).
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjHiringId, setAdjHiringId] = useState("");
  const [adjDirection, setAdjDirection] = useState<"RELEASE_TO_PROFESSIONAL" | "REFUND_TO_COMPANY">(
    "RELEASE_TO_PROFESSIONAL"
  );
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjResult, setAdjResult] = useState<{
    operationalBeforeCents: number;
    operationalAfterCents: number;
    adjustedBeforeCents: number;
    adjustedAfterCents: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter.toUpperCase())}` : "";
      const [h, p, l] = await Promise.all([
        api<{ hirings: HiringRow[] }>(`/api/admin/hirings${q || "?take=50"}`),
        api<{ payouts: PayoutRow[] }>(`/api/admin/payouts${q || "?take=50"}`),
        api<{ entries: LedgerRow[] }>(`/api/admin/ledger${q || "?take=100"}`),
      ]);
      setHirings(h.hirings);
      setPayouts(p.payouts);
      setLedger(l.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao carregar");
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section style={S.card}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            style={S.btnGhost}
            onClick={async () => {
              setRunning(true);
              try {
                const data = await api<ReconciliationPayload>("/api/admin/reconciliation");
                setRecon(data);
                onMessage(data.report.ok ? "Reconciliação: nenhuma divergência." : "ATENÇÃO: divergências encontradas.", !data.report.ok);
              } catch (err) {
                onMessage(err instanceof Error ? err.message : "erro na reconciliação", true);
              } finally {
                setRunning(false);
              }
            }}
            disabled={running}
          >
            {running ? "Rodando…" : "Rodar reconciliação"}
          </button>
          <button
            style={S.btn}
            onClick={async () => {
              try {
                const data = await api<{ result: { eligible: number; released: string[]; failed: { hiringId: string; error: string }[] } }>(
                  "/api/admin/payouts/run-batch",
                  { method: "POST" }
                );
                setBatchResult(
                  `Elegíveis: ${data.result.eligible} · repassadas: ${data.result.released.length} · falhas: ${data.result.failed.length}`
                );
                onMessage("Lote disparado — mesmas regras do agendador semanal.");
                load();
              } catch (err) {
                onMessage(err instanceof Error ? err.message : "erro no lote", true);
              }
            }}
          >
            Disparar lote de repasses
          </button>
          <input
            style={S.input}
            placeholder="filtrar status (ex.: RETIDO, FALHOU)"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
          <button style={S.btnGhost} onClick={load}>
            Atualizar
          </button>
        </div>
        {batchResult && <p style={S.ok}>{batchResult}</p>}
        {error && <p style={S.err}>{error}</p>}
      </section>

      {recon && (
        <section style={S.card}>
          <p style={{ margin: "0 0 6px" }}>
            <strong>Reconciliação</strong> ({dt(recon.report.generatedAt)}) —{" "}
            <span style={recon.report.ok ? S.ok : S.err}>
              {recon.report.ok ? "sem divergências" : `${recon.report.discrepancies.length} divergência(s)`}
            </span>{" "}
            · saldo retido {brl(recon.report.totals.retainedCents)}
          </p>
          {recon.report.discrepancies.length > 0 && (
            <ul style={{ ...S.err, margin: "0 0 6px" }}>
              {recon.report.discrepancies.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          {recon.failedPayouts.length > 0 && (
            <p style={{ margin: "0 0 6px" }}>
              Repasses com falha (o lote retenta):{" "}
              {recon.failedPayouts.map((f) => `${f.hiringId} (${f.failureReason ?? "sem motivo"})`).join("; ")}
            </p>
          )}
          {recon.adjustments.length > 0 && (
            <p style={{ margin: "0 0 6px" }}>
              AJUSTES manuais: {recon.adjustments.map((a) => `${a.hiringId} ${brl(a.amountCents)} por ${a.createdBy}`).join("; ")}
            </p>
          )}

          <p style={{ margin: "0 0 6px" }}>
            Saldo operacional: <strong>{brl(recon.report.totals.retainedCents)}</strong> (ledger)
            <br />
            Saldo ajustado: <strong>{brl(recon.report.totals.adjustedCents)}</strong> (com AJUSTE)
            <br />
            Pendente de reconciliação:{" "}
            <strong>{brl(recon.report.totals.pendingAdjustmentCents)}</strong>
          </p>

          {(() => {
            const canAdjust =
              recon.report.totals.retainedCents !== recon.report.totals.adjustedCents ||
              recon.report.discrepancies.length > 0;
            return (
              <>
                <button
                  style={canAdjust ? S.btn : S.btnGhost}
                  disabled={!canAdjust}
                  onClick={() => setAdjustOpen((v) => !v)}
                  title={
                    canAdjust
                      ? "Registrar correção auditada no ledger"
                      : "Sem divergência: operacional e ajustado batem"
                  }
                >
                  {adjustOpen ? "Fechar ajuste" : "Criar ajuste"}
                </button>

                {adjustOpen && (
                  <div style={{ ...S.card, marginTop: 8, background: "#fafafa" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        style={S.input}
                        placeholder="hiringId"
                        value={adjHiringId}
                        onChange={(e) => setAdjHiringId(e.target.value)}
                      />
                      <select
                        style={S.input}
                        value={adjDirection}
                        onChange={(e) =>
                          setAdjDirection(e.target.value as typeof adjDirection)
                        }
                      >
                        <option value="RELEASE_TO_PROFESSIONAL">RELEASE_TO_PROFESSIONAL</option>
                        <option value="REFUND_TO_COMPANY">REFUND_TO_COMPANY</option>
                      </select>
                      <input
                        style={S.input}
                        type="number"
                        min={1}
                        step={1}
                        placeholder="amountCents"
                        value={adjAmount}
                        onChange={(e) => setAdjAmount(e.target.value)}
                      />
                    </div>
                    <textarea
                      style={{ ...S.input, width: "100%", marginTop: 8, minHeight: 60 }}
                      placeholder="Motivo do ajuste (mín. 10 caracteres)"
                      value={adjReason}
                      onChange={(e) => setAdjReason(e.target.value)}
                    />
                    <p style={S.muted}>
                      O valor é sempre positivo; a direção é metadado e compõe o
                      motivo. Ambos reduzem o saldo ajustado. O ajuste exige
                      admin identificado e entra na trilha de auditoria.
                    </p>
                    <button
                      style={S.btn}
                      disabled={adjusting}
                      onClick={async () => {
                        setAdjusting(true);
                        try {
                          const data = await api<{
                            operationalBeforeCents: number;
                            operationalAfterCents: number;
                            adjustedBeforeCents: number;
                            adjustedAfterCents: number;
                          }>("/api/admin/ledger/adjust", {
                            method: "POST",
                            body: JSON.stringify({
                              hiringId: adjHiringId.trim(),
                              amountCents: Number(adjAmount),
                              direction: adjDirection,
                              reason: adjReason.trim(),
                            }),
                          });
                          setAdjResult(data);
                          onMessage(
                            `Ajuste registrado. Operacional ${brl(data.operationalBeforeCents)} → ${brl(
                              data.operationalAfterCents
                            )} · ajustado ${brl(data.adjustedBeforeCents)} → ${brl(data.adjustedAfterCents)}`
                          );
                          setAdjHiringId("");
                          setAdjAmount("");
                          setAdjReason("");
                          setAdjustOpen(false);
                          const fresh = await api<ReconciliationPayload>("/api/admin/reconciliation");
                          setRecon(fresh);
                          load();
                        } catch (err) {
                          onMessage(err instanceof Error ? err.message : "erro ao criar ajuste", true);
                        } finally {
                          setAdjusting(false);
                        }
                      }}
                    >
                      {adjusting ? "Registrando…" : "Registrar ajuste"}
                    </button>
                    {adjResult && (
                      <p style={S.ok}>
                        Antes: operacional {brl(adjResult.operationalBeforeCents)} / ajustado{" "}
                        {brl(adjResult.adjustedBeforeCents)} — depois: operacional{" "}
                        {brl(adjResult.operationalAfterCents)} / ajustado{" "}
                        {brl(adjResult.adjustedAfterCents)}
                      </p>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </section>
      )}

      <h2 style={{ fontSize: 16 }}>Contratações</h2>
      {hirings === null ? (
        <p>Carregando…</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={S.th}>Vaga</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Bruto / Líq.</th>
              <th style={S.th}>Saldo op. / aj.</th>
              <th style={S.th}>Papel</th>
              <th style={S.th}>Contratação</th>
              <th style={S.th}>Payout</th>
            </tr>
          </thead>
          <tbody>
            {hirings.map((h) => (
              <tr key={h.id}>
                <td style={S.td}>{h.jobTitle}</td>
                <td style={S.td}>{h.status}</td>
                <td style={S.td}>
                  {brl(h.grossValueCents)} / {brl(h.netValueCents)}
                </td>
                <td style={S.td}>
                  {(() => {
                    const b = balancesOf(h.ledgerEntries);
                    return b.operational === b.adjusted ? (
                      brl(b.operational)
                    ) : (
                      <>
                        {brl(b.operational)} / <span style={S.err}>{brl(b.adjusted)}</span>
                      </>
                    );
                  })()}
                </td>
                <td style={S.td}>
                  {h.contractor.name} ({h.contractor.documentMasked})
                  <br />
                  {h.professional.name} ({h.professional.documentMasked})
                </td>
                <td style={S.td}>{dt(h.createdAt)}</td>
                <td style={S.td}>
                  {h.payout ? `${h.payout.status} · ${brl(h.payout.amountCents)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16 }}>Repasses</h2>
      {payouts === null ? (
        <p>Carregando…</p>
      ) : payouts.length === 0 ? (
        <p style={S.muted}>Nenhum repasse registrado.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={S.th}>Contratação</th>
              <th style={S.th}>Profissional</th>
              <th style={S.th}>Valor</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Id provedor / falha</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id}>
                <td style={S.td}>{p.hiring.jobTitle}</td>
                <td style={S.td}>{p.professional.name}</td>
                <td style={S.td}>{brl(p.amountCents)}</td>
                <td style={S.td}>{p.status}</td>
                <td style={S.td}>
                  {p.providerTransferId ?? "—"}
                  {p.failureReason && <div style={S.err}>{p.failureReason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16 }}>Lançamentos do ledger (auditados)</h2>
      {ledger === null ? (
        <p>Carregando…</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Quando</th>
              <th style={S.th}>Tipo</th>
              <th style={S.th}>Valor</th>
              <th style={S.th}>Motivo</th>
              <th style={S.th}>Criado por</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td style={S.td}>{dt(l.createdAt)}</td>
                <td style={S.td}>{l.type}</td>
                <td style={S.td}>{brl(l.amountCents)}</td>
                <td style={S.td}>{l.reason}</td>
                <td style={S.td}>{l.createdBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ----- auditoria -----

/**
 * Trilha de auditoria administrativa (append-only). Só leitura: mostra quem
 * (adminId + via) fez o quê (action), em qual alvo (targetType/targetId) e
 * quando, com o `metadata` contextual colapsável (amountCents, before/after,
 * motivo). Filtros ajudam a investigar um alvo específico (ex.: um hiringId).
 */
function AuditoriaTab({ onMessage }: { onMessage: (m: string, e?: boolean) => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [adminId, setAdminId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (action.trim()) qs.set("action", action.trim().toUpperCase());
      if (targetType.trim()) qs.set("targetType", targetType.trim());
      if (adminId.trim()) qs.set("adminId", adminId.trim());
      if (targetId.trim()) qs.set("targetId", targetId.trim());
      qs.set("limit", "200");
      const data = await api<{ entries: AuditRow[] }>(`/api/admin/audit?${qs.toString()}`);
      setRows(data.entries);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro ao carregar auditoria";
      setError(msg);
      onMessage(msg, true);
    }
  }, [action, targetType, adminId, targetId, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section style={S.card}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={S.input} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">todas as ações</option>
            <option value="DISPUTE_RESOLVED">DISPUTE_RESOLVED</option>
            <option value="REPORT_RESOLVED">REPORT_RESOLVED</option>
            <option value="VERIFICATION_APPROVED">VERIFICATION_APPROVED</option>
            <option value="VERIFICATION_REJECTED">VERIFICATION_REJECTED</option>
            <option value="PAYOUT_RELEASED_MANUAL">PAYOUT_RELEASED_MANUAL</option>
            <option value="PAYOUT_BATCH_TRIGGERED">PAYOUT_BATCH_TRIGGERED</option>
            <option value="ADJUSTMENT_CREATED">ADJUSTMENT_CREATED</option>
            <option value="RECONCILIATION_RUN">RECONCILIATION_RUN</option>
          </select>
          <input
            style={S.input}
            placeholder="targetType (ex.: Hiring)"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
          />
          <input
            style={S.input}
            placeholder="adminId"
            value={adminId}
            onChange={(e) => setAdminId(e.target.value)}
          />
          <input
            style={S.input}
            placeholder="targetId (ex.: hiringId)"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          />
          <button style={S.btnGhost} onClick={load}>
            Atualizar
          </button>
        </div>
        <p style={S.muted}>
          Somente leitura. Quem age via <code>x-internal-secret</code> aparece como{" "}
          <code>system</code> em <code>adminVia=secret</code>.
        </p>
        {error && <p style={S.err}>{error}</p>}
      </section>

      {rows === null ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p style={S.muted}>Nenhum registro de auditoria para os filtros atuais.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Quando</th>
              <th style={S.th}>Admin</th>
              <th style={S.th}>Via</th>
              <th style={S.th}>Ação</th>
              <th style={S.th}>Alvo</th>
              <th style={S.th}>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={S.td}>{dt(r.createdAt)}</td>
                <td style={S.td}>{r.adminId}</td>
                <td style={S.td}>{r.adminVia}</td>
                <td style={S.td}>{r.action}</td>
                <td style={S.td}>
                  {r.targetType}
                  {r.targetId ? (
                    <>
                      <br />
                      <span style={S.muted}>{r.targetId}</span>
                    </>
                  ) : null}
                </td>
                <td style={S.td}>
                  {r.metadata ? (
                    <>
                      <button
                        style={S.btnGhost}
                        onClick={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                      >
                        {expanded === r.id ? "ocultar" : "ver"}
                      </button>
                      {expanded === r.id && (
                        <pre
                          style={{
                            margin: "6px 0 0",
                            padding: 8,
                            background: "#f5f5f5",
                            borderRadius: 6,
                            fontSize: 12,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {JSON.stringify(r.metadata, null, 2)}
                        </pre>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
