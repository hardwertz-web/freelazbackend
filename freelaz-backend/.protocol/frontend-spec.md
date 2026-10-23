# Spec de frontend — Fase 1 (app tocável)

Status: implementado na Fase 1. Documento de referência visual e de contrato com o
backend. Qualquer mudança de tela deve atualizar esta spec.

## 1. Objetivo

Construir o MVP navegável do Freelaz — 7 telas + tab bar fixa — consumindo o backend
real (mesmo repo `freelaz-backend`, Next.js 14 App Router). Mobile-first:
conteúdo com largura máxima de `430px`, centralizado no desktop, cheio no mobile.

**Fora da Fase 1:** candidatura, checkout/pagamento, código de turno, avaliação,
publicar vaga, notificações, admin, chat (abrir conversa e enviar mensagens),
saque/depósito/transferência, edição de perfil.

## 2. Identidade visual

### Paleta

| Token | Hex | Uso |
|---|---|---|
| `--azul-principal` | `#0066FF` | botões, links, tab ativa, badges |
| `--azul-escuro` | `#0B1F44` | títulos, logo, valores |
| `--cinza-claro` | `#E8EEF7` | fundo de página e campos |
| `--primary` | `= --azul-principal` | alias usado pelos componentes |
| `--title` | `= --azul-escuro` | alias usado pelos componentes |
| `--bg` | `= --cinza-claro` | alias usado pelos componentes |
| `--primary-dark` | `#0052CC` | hover do primário |
| `--muted` | `#6B7280` | texto secundário, metadados |
| `--selected` | `#EAF1FF` | chip ativo, avatar, realce |
| `--positive` | `#16A34A` | crédito, status positivo |
| `--tag` | `#F97316` | tags de destaque/atenção |
| `--danger` | `#DC2626` | erro, sair |
| `--border` | `#E5E7EB` | bordas de card |
| `--border-strong` | `#D6DBE3` | bordas de input/chip |
| `--surface` | `#FFFFFF` | cards, header, tab bar |

### Tipografia

- Fonte: **Montserrat** via `next/font/google` (self-host no build, sem `<link>`).
- Pesos: 400, 500, 600, 700, 800. Variável CSS `--font-montserrat` aplicada no
  `<html>`; `--font-family: 'Montserrat', sans-serif` como fallback declarado.
- Escala: título de tela 20–22px/700; seção 14,5–15px/600; corpo 12,5–13px/400;
  metadado 10,3–11,5px/500. `letter-spacing` negativo (−0,02em) nos títulos.

### Formas e elevação

- Card: raio `14px`, borda `1px --border`, sombra `0 1px 2px rgba(11,31,59,.04),
  0 4px 16px rgba(11,31,59,.06)`.
- Botão: raio `12px`; chip e pill: raio total (`999px`).
- Header: sticky, fundo branco 94% com `backdrop-filter: blur(10px)`.
- Tab bar: fixa, fundo branco 96%, `blur(12px)`, respeita `env(safe-area-inset-bottom)`.

## 3. Componentes base (`src/components/`)

| Componente | Contrato |
|---|---|
| `Card` | `children`, `flush` (sem padding), `plain` (sem sombra) |
| `Chip` | `children`, `active`, `onClick`, `count`, `title` — pill, ativo azul sólido |
| `Button` | `variant` (`primary`/`secondary`/`outline`/`danger`), `block`, `size` (`md`/`sm`), atributos nativos |
| `Badge` | `children`, `tone` (`primary`/`success`/`tag`/`neutral`/`danger`/`solid`), `icon` |
| `ScreenHeader` | header persistente: logo oficial (`/logo.jpg`) + wordmark "Freelaz" + tagline "Trabalho que conecta.", sino (Fase 2, desabilitado) e avatar → `/perfil` |
| `BottomTabBar` | 5 itens: Início `/`, Buscar `/buscar`, Mensagens `/mensagens`, Carteira `/carteira`, Perfil `/perfil`; ativo em azul, inativo cinza |
| `Icons` | SVG inline (traço, `currentColor`) — sem biblioteca externa |
| `AuthShell` | casca de login/cadastro: cartão centrado, logo oficial + marca, título, subtítulo |

Badge "Verificado": fundo `--selected`, texto azul, ícone de escudo
(`ShieldCheckIcon`).

### Imagens (Fase 1.2)

- **Logo:** `public/logo.jpg` (símbolo quadrado, 1254×1254, fundo azul-escuro).
  No header tem 32px de altura; no login/cadastro, 40px. O wordmark "Freelaz"
  e a tagline continuam ao lado (o arquivo não traz o nome escrito).
- **Capas de vaga:** `public/categories/<categoria>.jpg` (Unsplash, 1200×800),
  resolvidas por `src/lib/categoryImages.ts` → `getCategoryImage(category)`.
  O lookup normaliza (trim, minúsculas, sem acento) e cai em
  `/categories/default.jpg` quando a categoria não tem foto.
- Categorias com foto: bartender, garcom, diarista, pedreiro, eletricista,
  encanador, seguranca, eventos, limpeza, construcao, administracao, default.
- No card de destaque: `object-fit: cover`, 120px de altura; no detalhe: 200px.
  Overlay `::after` com `rgba(0, 102, 255, 0.1)`. O gradiente antigo fica
  apenas como fundo de fallback atrás da foto.
- Sempre `<img>` (não `next/image`), porque as imagens são estáticas locais e
  não precisam de otimização em runtime.

## 4. Descrição textual das telas de referência

As descrições abaixo vêm da análise das 6 imagens de referência (WhatsApp,
17/10). A Home canônica é a **v1** (funcional); a variante com banner hero foi
descartada para o MVP.

### 4.1 Login / Cadastro (sem referência — mesma linguagem)

Não havia imagem. Segue a linguagem: fundo com gradiente azul suave, cartão
branco de 400px, marca "Freelaz — Trabalho que conecta." centralizada, campos
de 44px com raio 12, botão primário azul de largura total. Login: e-mail + senha,
link "Criar conta". Cadastro: seletor CPF/CNPJ, documento, nome/razão social,
nascimento (CPF) ou nome fantasia (CNPJ), e-mail, telefone, senha, escolha de
papéis (Oferecer serviços / Contratar) e aceite de termos.

### 4.2 Home (v1 — canônica)

Fundo branco. Header fixo: marca "Freelaz" com símbolo azul e a tagline pequena
"Trabalho que conecta."; à direita, sino e avatar. Abaixo, saudação em duas
linhas ("Encontre o trabalho ideal para você.") em azul-marinho, com subtítulo
cinza. Campo de busca grande, arredondado, com lupa e botão azul de filtros ao
lado. Fileira horizontal de chips de categoria ("Todas", "Eventos", "Garçom",
"Segurança"…), com o ativo em azul sólido. Fileira de pills de filtro
("Data", "Valor", "Mais filtros"). Seção **"Oportunidades em destaque"** com
grade de 2 colunas de cards: bloco superior colorido com o nome da categoria,
badge "Destaque", título em duas linhas, localização com pino e valor em reais
por dia. Seção **"Oportunidades mais recentes"** com lista de linhas: miniatura
quadrada colorida, título, dia + horário, localização, selo de empresa
verificada, valor à direita e chevron. Contador "N de total" no cabeçalho da
seção.

### 4.3 Buscar

Não existe tela dedicada nas referências. Decisão da Fase 1: a busca vive na
Home. A tab "Buscar" redireciona para `/?focus=search`, que foca o campo e
mantém a tab Buscar ativa.

### 4.4 Vaga única

Header com voltar. Bloco hero em gradiente com a categoria em caixa alta,
badge "Vaga aberta" e coração (Fase 2, desabilitado), título grande branco.
Abaixo: pill azul com o valor ("R$ 180 /dia"), data por extenso com ícone de
calendário ("Sábado, 18:00 – 02:00") e localização com pino. Três métricas em
cards: candidaturas, empresa verificada, visibilidade. Cards "Sobre a vaga"
(descrição real), "Pagamento" (valor + aviso de retenção até a conclusão) e
"Sobre a empresa" (avatar com iniciais, nome/razão social, selo e local).
Botão primário "Enviar proposta" desabilitado com nota "Fase 2".

### 4.5 Perfil

Cartão superior centralizado: avatar circular com iniciais em gradiente azul,
nome em destaque, badge "Verificado" com escudo, headline/bio curta e
localização com pino. Três métricas em caixas cinza claro: avaliação (estrela),
confiabilidade (%) e força do perfil (%). Abaixo: chips de categorias, card
"Sobre" com a bio, lista de experiências (ícone de maleta, cargo, empresa,
período), grade 3×3 de portfólio (fotos reais de `/api/uploads/`), tags de
disponibilidade e soft skills, barra de progresso "Força do perfil" (visível só
para o dono) e card "Conta" (e-mail, telefone, documento mascarado, local,
papéis). Botões "Editar perfil (Fase 2)" e "Sair".

### 4.6 Carteira

Cabeçalho "Carteira" + subtítulo. Cartão azul em gradiente com "Saldo
disponível", valor grande, "A receber" e botão translúcido com a taxa de saque
instantâneo. Grade de 4 ações (Depositar, Sacar, Transferir, Histórico) em
cards com ícone circular — desabilitadas na Fase 1. Seção "Resumo" com 4 cards
(disponível, a receber, em processamento, total já sacado). Seção
"Movimentações recentes": linhas com ícone (entrada verde / saída azul), rótulo,
data, taxa quando houver, valor com sinal e badge de status do repasse.

### 4.7 Mensagens

Título "Mensagens" + subtítulo. Campo de busca de conversa. Chips com contagem:
"Todas 8", "Contratantes 3", "Profissionais 5", "Não lidas 2" na referência —
na Fase 1 usamos Todas/Contratantes/Profissionais com contagem real (não há
contador de não lidas no backend). Lista de linhas: avatar com iniciais, nome da
contraparte, badge "Chat aberto", título da vaga, lado ("Você contrata" /
"Você trabalha"), valor e horário relativo. Estado vazio explica que o chat só
abre após o pagamento confirmado.

### 4.8 Tab bar

Barra fixa inferior com 5 itens (Início, Buscar, Mensagens, Carteira, Perfil),
ícones outline de 20px sobre o rótulo de 10px. Item ativo em azul com fundo
`--selected`; inativos em cinza. A referência da Carteira tinha 5 itens e as
outras 4 — padronizamos em 5.

## 5. Rotas e arquivos

```
src/app/
  layout.tsx                  raiz (Montserrat, globals.css, metadata/viewport)
  globals.css                 tokens, reset, utilitários
  login/page.tsx              fora do route group (sem tab bar)
  cadastro/page.tsx           fora do route group (sem tab bar)
  (web)/
    layout.tsx                guarda de sessão + ScreenHeader + BottomTabBar
    page.tsx                  Home (v1)
    buscar/page.tsx           redirect → /?focus=search
    mensagens/page.tsx
    carteira/page.tsx
    perfil/page.tsx
    vaga/[id]/page.tsx
src/components/
  Card.tsx / Chip.tsx / Button.tsx / Badge.tsx
  ScreenHeader.tsx / BottomTabBar.tsx / Icons.tsx / AuthShell.tsx
  screens/{Home,JobDetail,Messages,Wallet,Profile}Screen.tsx
src/lib/
  apiClient.ts                fetch same-origin com erro tipado
  apiTypes.ts                 contratos das respostas
  format.ts                   BRL, datas, iniciais, categorias
```

Cada componente/tela tem seu `.module.css` ao lado (CSS Modules — o projeto não
usa Tailwind).

## 6. Integração com o backend (somente leitura)

| Tela | Endpoint | Observação |
|---|---|---|
| Sessão/guard | `GET /api/auth/me` | layout `(web)` redireciona para `/login` sem sessão |
| Login | `POST /api/auth/login` | cookie `freelaz_session` (httpOnly) |
| Cadastro | `POST /api/auth/register` | papéis `PROFISSIONAL`/`CONTRATANTE` |
| Home | `GET /api/jobs?limit=50` | busca e filtros **client-side**; `total`/`hasMore` da resposta |
| Vaga | `GET /api/jobs/[id]` | 404 → estado "Vaga não encontrada" |
| Perfil | `GET /api/auth/me` + `GET /api/profile/professional` | 409 = papel não ativado (estado próprio) |
| Carteira | `GET /api/wallet?limit=50` | 403 = papel Profissional inativo (estado próprio) |
| Mensagens | `GET /api/hirings` | filtra `chat.status === "ABERTO"` no cliente |

Nenhum endpoint foi criado ou alterado. Nenhum dado mock: tudo vem do backend.

## 7. Estados e comportamento

Toda tela com dados tem 4 estados: **carregando** (skeleton), **erro** (mensagem
real da API + "Tentar de novo"), **vazio** (texto explicando o porquê) e
**conteúdo**.

- Home: busca em tempo real por título, descrição, categoria, empresa e cidade;
  filtros de cidade e faixa de valor; ordenação por data ou valor; chips de
  categoria derivados das vagas carregadas.
- Buscar: `/?focus=search` foca o campo e destaca a tab Buscar.
- Mensagens: filtro por lado (`side`) e busca por nome/vaga; contagens reais.
- Carteira: valores calculados pelo backend; nunca somados no front.
- Perfil: mostra `profileStrength` e dados do papel; se o papel estiver
  PENDENTE, explica o que falta em vez de esconder a tela.

## 8. Regras de honestidade de UI

- Controles de Fase 2 aparecem **desabilitados** com `title`/nota explícita
  ("Fase 2") — nunca fingem funcionar e nunca inventam números.
- Sem badge de notificações não lidas (o backend não expõe contador).
- Sem gráfico de ganhos (não há série histórica na API).
- Sem requisitos/benefícios de vaga inventados (não existem no modelo).
- Sem foto de empresa vaga (não há imagem no modelo de `JobPosting`); usamos
  gradiente derivado da categoria como elemento decorativo.
