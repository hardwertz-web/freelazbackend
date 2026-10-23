/**
 * Imagens de capa por categoria (Fase 1.2).
 *
 * As fotos ficam em `public/categories/` (baixadas do Unsplash, 1200x800) e
 * são servidas direto pelo Next como estáticas. O `JobPosting` não tem imagem
 * no backend: a capa é apenas ilustrativa, derivada da categoria.
 *
 * Categorias sem foto caem em `default.jpg` — nenhuma tela fica quebrada.
 */

const CATEGORY_IMAGES: Record<string, string> = {
  bartender: "/categories/bartender.jpg",
  garcom: "/categories/garcom.jpg",
  diarista: "/categories/diarista.jpg",
  pedreiro: "/categories/pedreiro.jpg",
  eletricista: "/categories/eletricista.jpg",
  encanador: "/categories/encanador.jpg",
  seguranca: "/categories/seguranca.jpg",
  eventos: "/categories/eventos.jpg",
  limpeza: "/categories/limpeza.jpg",
  construcao: "/categories/construcao.jpg",
  administracao: "/categories/administracao.jpg",
};

export const DEFAULT_CATEGORY_IMAGE = "/categories/default.jpg";

/** Normaliza a categoria (trim, minúsculas, sem acento) e devolve a capa. */
export function getCategoryImage(category: string): string {
  const key = category
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return CATEGORY_IMAGES[key] ?? DEFAULT_CATEGORY_IMAGE;
}
