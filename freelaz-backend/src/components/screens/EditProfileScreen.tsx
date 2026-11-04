"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/apiClient";
import type { MeResponse, ProfileResponse } from "@/lib/apiTypes";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChevronLeftIcon } from "@/components/Icons";
import styles from "./EditProfileScreen.module.css";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export function EditProfileScreen() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profileData, setProfileData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [portfolioUploading, setPortfolioUploading] = useState(false);
  const portfolioInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [meRes, profileRes] = await Promise.all([
      apiGet<MeResponse>("/api/auth/me"),
      apiGet<ProfileResponse>("/api/profile/professional"),
    ]);
    if (!meRes.ok) {
      if (meRes.status === 401) router.replace("/login");
      else setError(meRes.error);
      setLoading(false);
      return;
    }
    setMe(meRes.data);
    if (profileRes.ok) {
      setProfileData(profileRes.data);
      setAvatarPreview((profileRes.data.profile as any)?.avatarUrl ?? null);
    } else {
      setError(profileRes.error);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      alert("Foto muito grande (máximo 2,5 MB)");
      return;
    }
    setAvatarUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await apiPost<{ avatarUrl: string }>("/api/profile/avatar", { dataUrl });
      if (!res.ok) {
        alert(res.error);
        return;
      }
      setAvatarPreview(res.data.avatarUrl);
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handlePortfolioChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      alert("Foto muito grande (máximo 2,5 MB). Vídeo em breve.");
      return;
    }
    setPortfolioUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await apiPost<{ item: { id: string; url: string } }>(
        "/api/profile/portfolio",
        { dataUrl, kind: "FOTO" }
      );
      if (!res.ok) {
        alert(res.error);
        return;
      }
      await load();
    } finally {
      setPortfolioUploading(false);
    }
  }

  async function handleRemoveItem(id: string) {
    if (!confirm("Remover este item?")) return;
    const res = await fetch(`/api/profile/portfolio/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Erro ao remover");
      return;
    }
    await load();
  }

  if (loading) {
    return <div className={styles.screen}><h1 className={styles.title}>Editar perfil</h1></div>;
  }

  if (error || !me) {
    return (
      <div className={styles.screen}>
        <h1 className={styles.title}>Editar perfil</h1>
        <Card>
          <p>{error ?? "Erro ao carregar"}</p>
          <Button onClick={() => void load()}>Tentar de novo</Button>
        </Card>
      </div>
    );
  }

  const portfolioItems = (profileData?.profile as any)?.portfolioItems ?? [];

  return (
    <div className={styles.screen}>
      <button className={styles.back} onClick={() => router.push("/perfil")}>
        <ChevronLeftIcon size={16} /> Voltar
      </button>
      <h1 className={styles.title}>Editar perfil</h1>
      <p className={styles.subtitle}>Foto e portfólio aparecem no seu perfil público.</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Foto de perfil</h2>
        <Card>
          <div className={styles.avatarBlock}>
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarPreview} alt="Foto" className={styles.avatarImg} />
            ) : (
              <div className={styles.avatarPlaceholder}>Sem foto</div>
            )}
            <div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void handleAvatarChange(e)}
                style={{ display: "none" }}
              />
              <Button size="sm" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
                {avatarUploading ? "Enviando..." : avatarPreview ? "Trocar foto" : "Enviar foto"}
              </Button>
              <p className={styles.hint}>JPG, PNG ou WebP. Máximo 2,5 MB.</p>
            </div>
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Portfólio ({portfolioItems.length}/12)</h2>
        <Card>
          <div className={styles.portfolioGrid}>
            {portfolioItems.map((item: any) => (
              <div key={item.id} className={styles.portfolioItem}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt="Item" />
                <button className={styles.removeBtn} onClick={() => void handleRemoveItem(item.id)}>×</button>
              </div>
            ))}
            {portfolioItems.length < 12 && (
              <div className={styles.addCard} onClick={() => portfolioInputRef.current?.click()}>
                {portfolioUploading ? "Enviando..." : "+ Adicionar"}
              </div>
            )}
          </div>
          <input
            ref={portfolioInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void handlePortfolioChange(e)}
            style={{ display: "none" }}
          />
          <p className={styles.hint}>Máximo 12 itens. Cada foto até 2,5 MB.</p>
        </Card>
      </section>
    </div>
  );
}
