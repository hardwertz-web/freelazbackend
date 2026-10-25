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
| `ScreenHeader` | header persistente: ícone oficial (`/logo_f-96.png`, 40px, alinhado à esquerda), sino (Fase 2, desabilitado) e avatar → `/perfil` |
| `BottomTabBar` | 5 itens: Início `/`, Buscar `/buscar`, Mensagens `/mensagens`, Carteira `/carteira`, Perfil `/perfil`; ativo em azul, inativo cinza |
| `Icons` | SVG inline (traço, `currentColor`) — sem biblioteca externa |
| `AuthShell` | casca de login/cadastro: cartão centrado, ícone oficial (48px), título, subtítulo |

Badge "Verificado": fundo `--selected`, texto azul, ícone de escudo
(`ShieldCheckIcon`).

### Imagens (Fase 1.2)

- **Logo:** `public/logo_f-96.png` (96×96, 9 KB, círculo azul com "F" branco e
  **alfa real**; retina 2x dos 48px do login). No header tem 40×40px; no
  login/cadastro, 48×48px (`object-fit: contain`, `border-radius: 50%`).
  Sem wordmark nem tagline ao lado — só o ícone, alinhado à esquerda.
  O `public/logo_f.png` original (1254×1254, 1,2 MB, sem alfa) fica no repo
  como fonte para outros contextos, sem uso nas telas. O antigo
  `public/logo.jpg` também é preservado como asset reserva.
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

### 4.2 Home (Fase 2.4a — redesign visual)

Header persistente (logo + sino + avatar) no layout. Abaixo, na ordem:

1. **Hero** em card com gradiente `#0066FF → #0B1F44`, raio 20px, padding
   20px e margem inferior 20px. Título "Encontre seu próximo trabalho" (24px,
   branco), subtítulo "Vagas de hoje e amanhã, perto de você." (14px), pill
   translúcida "Itajubá - MG" (40px) e botão branco "Ver vagas →" que ancora em
   `#lista-vagas` com scroll suave. Foto da Serra da Mantiqueira
   (`public/hero-itajuba.jpg`) no lado direito com overlay azul; se a foto não
   carregar, o gradiente sustenta o contraste. Crédito da foto em 8px no canto.
2. **Busca compacta**: input de 46px com lupa ("Buscar por profissão, categoria
   ou empresa") + botão de filtros. Filtra em tempo real sobre `/api/jobs`.
3. **Categorias**: até 6 chips de 60x60 (ícone 24px + rótulo 12px), scroll
   horizontal com gap 12px e sem scrollbar. Ativo em `#EAF1FF` com ícone azul;
   inativo branco/cinza. Derivadas de `/api/jobs` e agrupadas por chave
   normalizada (une "eventos" e "EVENTOS"); clicar filtra, clicar de novo limpa.
   Categoria desconhecida usa ícone de grade.
4. **"Vagas perto de você"** + "Ver todas": carrossel horizontal com snap,
   cards de 260px e gap 12px. Cada card tem foto da categoria, "Verificado" (só
   quando o contratante é verificado), coração desabilitado (Fase 2), título,
   data/hora com calendário, local + contagem real de vagas com pino, valor em
   18px e "Ver detalhes" outlined azul. O card inteiro é link para `/vaga/[id]`.
   Urgentes primeiro, depois as mais recentes (até 5).
5. **"Oportunidades mais recentes"** com `id="lista-vagas"`: lista vertical de
   linhas (miniatura, título, dia + horário, localização, selo verificado, valor
   e chevron) e contador "N de total".

O painel de filtros (cidade, faixa de valor e ordenação por data/valor) fica
atrás do botão de filtros, preservando a funcionalidade da v1.

### 4.3 Buscar

A rota `/buscar` e a 5ª aba foram removidas na Fase 2.4a. A busca vive na Home,
logo abaixo do hero, e o botão de busca da tab bar não existe mais. Acesso
direto a `/buscar` responde 404.

### 4.4 Vaga única

Header com voltar. Bloco hero em gradiente com a categoria em caixa alta,
badge "Vaga aberta" e coração (Fase 2, desabilitado), título grande branco.
Abaixo: pill azul com o valor ("R$ 180 /dia"), data por extenso com ícone de
calendário ("Sábado, 18:00 – 02:00") e localização com pino. Três métricas em
cards: candidaturas, empresa verificada, visibilidade. Cards "Sobre a vaga"
(descrição real), "Pagamento" (valor + aviso de retenção até a conclusão) e
"Sobre a empresa" (avatar com iniciais, nome/razão social, selo e local).
Botão primário "Enviar proposta" abre um modal de confirmação com o campo
"Mensagem (opcional)" (até 500 caracteres, com contador; vazio = sem mensagem)
e chama `POST /api/jobs/[id]/apply` com `{ message }`. Em caso de sucesso:
toast "Proposta enviada" e retorno para a Home; duplicata (409) desabilita o
botão como "Proposta enviada".

Dono da vaga: a seção "Propostas recebidas (N)" lista as candidaturas com nome,
status, mensagem e data. Candidaturas PENDENTES têm "Selecionar candidato"
(`POST /api/jobs/[id]/select`); o sucesso leva a `/checkout/[hiringId]`. As
demais aparecem como "Suplente" (o backend converte as PENDENTES restantes).

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
contraparte, badge "Chat aberto"/"Encerrado", título da vaga, lado ("Você
contrata" / "Você trabalha"), valor e horário relativo. Cada linha abre
`/mensagens/[hiringId]`. Estado vazio explica que o chat só abre após o
pagamento confirmado.

### 4.7.1 Conversa (`/mensagens/[hiringId]`)

Cabeçalho com voltar, avatar, nome da contraparte, vaga e badge de status
("Chat aberto"/"Encerrado"). Corpo com bolhas: minhas à direita em azul, da
contraparte à esquerda em branco; hora da mensagem e "✓" quando lida. Rodapé
fixo acima da tab bar com input e botão enviar (desabilitados quando o chat não
está ABERTO, com aviso "Conversa encerrada"). Histórico via
`GET /api/hirings/[id]/chat`, envio via `POST .../chat/messages`, polling de 5s
(sem WebSocket) e `PATCH .../chat/messages/read` ao abrir/ao chegar mensagem
nova. Chat oculto/inexistente (404) → "Conversa não disponível".

### 4.7.2 Checkout Pix (`/checkout/[hiringId]`)

Cabeçalho "Checkout Pix" + vaga. Card com valor total, card do QR Code
(`data:image/png;base64,` de `pix.qrCodeBase64`) com instrução "Abra o app do
seu banco e escaneie o QR Code", campo "Pix copia e cola" (monoespaçado, com
"Copiar código Pix") e card de status "Aguardando confirmação do pagamento...".
Chama `POST /api/payments/create` ao montar e faz polling de 5s em
`GET /api/hirings/[id]` até o status sair de `AGUARDANDO_PAGAMENTO` (máx. 30
tentativas/2,5 min); então redireciona para `/mensagens/[hiringId]`. Ao estourar
o prazo: "Pagamento não confirmado. Verifique seu banco." + "Já paguei". 503 =
"Asaas não configurado" → "Pagamento indisponível no momento" + retry.

### 4.7.3 Código de turno (na conversa)

Card fixo (`position: sticky`) logo abaixo do cabeçalho da conversa, visível em
`RETIDO` e `EM_ANDAMENTO`:

- **Profissional:** código de 6 dígitos em destaque (23px, espaçado) + "Copiar"
  e a instrução "Mostre este código à empresa no início/fim do turno".
- **Empresa:** campo numérico de 6 dígitos + "Confirmar código" (só habilita com
  6 dígitos) e a instrução "Peça o código ao profissional...".
- **Código ainda não gerado:** "Disponível a partir de {1h antes de
  início/fim}" e a explicação de que a geração é automática 1h antes.
- **Estados finais:** "Serviço concluído em {data}", "Contratação cancelada",
  e avisos neutros para `EM_DISPUTA`/`LIBERADO`.
- Erros da API aparecem inline (`role="alert"`): "Código incorreto" e o aviso
  de bloqueio após 5 tentativas (input e botão desabilitados).
- O polling de 5s da conversa busca também `GET /api/hirings/[id]`, então a
  transição de turno aparece sem reload.

### 4.8 Tab bar

Barra fixa inferior com 4 itens (Início, Mensagens, Carteira, Perfil) em
`grid-template-columns: repeat(4, 1fr)`, ícones outline de 20px sobre o rótulo
de 10px. Item ativo em azul com fundo `--selected`; inativos em cinza. A aba
"Buscar" foi removida na Fase 2.4a (a busca vive na Home).

## 5. Rotas e arquivos

```
src/app/
  layout.tsx                  raiz (Montserrat, globals.css, metadata/viewport)
  globals.css                 tokens, reset, utilitários
  login/page.tsx              fora do route group (sem tab bar)
  cadastro/page.tsx           fora do route group (sem tab bar)
  (web)/
    layout.tsx                guarda de sessão + ScreenHeader + BottomTabBar
    page.tsx                  Home (Fase 2.4a)
    mensagens/page.tsx
    mensagens/[hiringId]/page.tsx   conversa (Fase 2.1)
    carteira/page.tsx
    perfil/page.tsx
    vaga/[id]/page.tsx
src/components/
  Card.tsx / Chip.tsx / Button.tsx / Badge.tsx
  ScreenHeader.tsx / BottomTabBar.tsx / Icons.tsx / AuthShell.tsx
  screens/{Home,JobDetail,Messages,Chat,Wallet,Profile}Screen.tsx
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
| Mensagens | `GET /api/hirings` | chats `ABERTO` e `ENCERRADO`; `AGUARDANDO_PAGAMENTO` fica fora |
| Vaga — candidatura | `POST /api/jobs/[id]/apply` | `{ message? }` (1–500 chars; vazio = sem mensagem); 201/409 |
| Conversa | `GET /api/hirings/[id]/chat` | histórico cronológico + status; 404 = oculto/sem acesso |
| Conversa — cabeçalho | `GET /api/hirings/[id]` | contraparte, vaga, status, códigos e datas do turno |
| Conversa — enviar | `POST /api/hirings/[id]/chat/messages` | `{ body }`; 409 = chat encerrado |
| Conversa — lidas | `PATCH /api/hirings/[id]/chat/messages/read` | ao abrir e ao chegar mensagem nova |
| Seleção | `POST /api/jobs/[id]/select` | `{ applicationId }` → cria Hiring `AGUARDANDO_PAGAMENTO` |
| Pagamento | `POST /api/payments/create` | `{ hiringId }` → QR/copia-e-cola; 503 sem Asaas; 409 fora de `AGUARDANDO_PAGAMENTO` |
| Turno — confirmar | `POST /api/hirings/[id]/codes` | `{ kind: "OPENING"\|"CLOSING", code }`; só a empresa (403); 422 regra/limite |

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
- Conversa: polling de 5s, scroll automático para a última mensagem, envio
  otimista (a resposta 201 já entra na lista), sem WebSocket e sem anexos.
- Carteira: valores calculados pelo backend; nunca somados no front.
- Perfil: mostra `profileStrength` e dados do papel; se o papel estiver
  PENDENTE, explica o que falta em vez de esconder a tela.

## 8. Regras de honestidade de UI

- Controles ainda fora de escopo aparecem **desabilitados** com `title`/nota
  explícita ("Fase 2") — nunca fingem funcionar e nunca inventam números.
- Sem badge de notificações não lidas (o backend não expõe contador).
- Candidatura sem texto: o campo "Mensagem (opcional)" aparece **desabilitado**
  porque `POST /api/jobs/[id]/apply` não aceita body — nunca descartamos texto
  digitado em silêncio.
- Sem gráfico de ganhos (não há série histórica na API).
- Sem requisitos/benefícios de vaga inventados (não existem no modelo).
- Sem foto de empresa vaga (não há imagem no modelo de `JobPosting`); usamos
  gradiente derivado da categoria como elemento decorativo.
