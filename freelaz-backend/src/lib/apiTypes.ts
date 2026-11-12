// Contratos das respostas das APIs que o front consome. Espelham exatamente o
// que as rotas já devolvem hoje — nenhum endpoint foi alterado (Fase 1).

// Modalidade da vaga (Fase 2.3c). PRESTADORA é aceita pela API, mas ainda sem
// aba no MVP.
export type JobModality = "FREELANCE" | "CLT" | "PRESTADORA";

export type JobCard = {
  id: string;
  title: string;
  description: string;
  category: string;
  city: string | null;
  state: string | null;
  modality: JobModality;
  valueCents: number;
  status: string;
  visibility: string;
  urgentBoost: boolean;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  contractor: {
    id: string;
    name: string;
    tradeName: string | null;
    city: string | null;
    state: string | null;
    verified: boolean;
  };
};

export type JobsResponse = {
  items: JobCard[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export type JobDetail = JobCard & {
  applicationsCount: number;
  targetProfessionalId?: string;
};

export type JobDetailResponse = { jobPosting: JobDetail };

export type StatementItem = {
  date: string;
  kind: "CREDITO" | "TRANSFERENCIA";
  label: string;
  hiringId: string;
  amountCents: number;
  feeCents?: number;
  status?: string;
};

export type WalletResponse = {
  wallet: {
    aReceberCents: number;
    disponivelCents: number;
    emProcessamentoCents: number;
    sacadoCents: number;
    instantWithdrawalFeeBps: number;
  };
  statement: StatementItem[];
};

export type ActiveMode = "PROFISSIONAL" | "CONTRATANTE" | "BOTH";

export type PublicUser = {
  id: string;
  name: string;
  tradeName: string | null;
  email: string;
  phone: string;
  documentType: "CPF" | "CNPJ";
  documentMasked: string;
  birthDate: string | null;
  city: string | null;
  state: string | null;
  termsAcceptedAt: string | null;
  emailConfirmedAt: string | null;
  activeMode?: ActiveMode;
};

export type Role = { role: "PROFISSIONAL" | "CONTRATANTE" | "ADMIN"; status: string };

export type MeResponse = {
  user: PublicUser;
  roles: Role[];
  professionalProfile: {
    bio: string | null;
    categories: string[];
    verificationStatus: string;
    headline: string | null;
  } | null;
  contractorProfile: { verificationStatus: string } | null;
  activeMode?: ActiveMode;
};

export type PortfolioItem = { id: string; kind: "FOTO" | "VIDEO"; url: string; position: number };

export type WorkExperience = {
  id: string;
  company: string;
  role: string;
  periodStart: string;
  periodEnd: string | null;
};

export type ProfessionalProfile = {
  id: string;
  userId: string;
  bio: string | null;
  categories: string[];
  headline: string | null;
  region: string | null;
  availability: string[];
  softSkills: string[];
  referencePriceCents: number | null;
  resumeUrl: string | null;
  verificationStatus: string;
  reliabilityScore: number | null;
  ratingAverage: number | null;
  isInfluencer: boolean;
  // Contagem de avaliações liberadas (Fase 2.3b). 0 = "Sem avaliações ainda".
  evaluationCount: number;
  createdAt: string;
  updatedAt: string;
  portfolioItems: PortfolioItem[];
  workExperiences: WorkExperience[];
};

export type ProfileResponse = {
  profile: ProfessionalProfile;
  profileStrength: number;
  pixKey: string | null;
};

export type ChatSummary = {
  id: string;
  status: "AGUARDANDO_PAGAMENTO" | "ABERTO" | "ENCERRADO";
  lastMessageAt: string | null;
  lastMessage?: { body: string; createdAt: string; senderId: string } | null;
  unreadCount?: number;
};

export type ChatStatus = ChatSummary["status"];

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  sender: { id: string; name: string; tradeName: string | null };
  mine: boolean;
};

export type ChatInfo = {
  id: string;
  status: ChatStatus;
  openedAt: string | null;
  closedAt: string | null;
  closeReason?: string | null;
};

/** GET /api/hirings/:id/chat — histórico em ordem cronológica (mais novas no fim). */
export type ChatResponse = {
  chat: ChatInfo;
  messages: ChatMessage[];
  hasMore: boolean;
  nextBefore: string | null;
};

/**
 * Avaliação cega (Fase 2.3b): `theirs` só traz `rating`/`comment` quando
 * `revealed` é true (as duas partes avaliaram ou o prazo de 30d venceu).
 */
export type HiringEvaluationPeer = {
  exists: boolean;
  rating?: number;
  comment?: string | null;
};

export type HiringEvaluations = {
  mine: HiringEvaluationPeer | null;
  theirs: HiringEvaluationPeer | null;
  revealed: boolean;
  deadline: string | null;
};

/**
 * GET /api/hirings/:id — cabeçalho da conversa + dados do turno.
 *
 * Os códigos de turno saem para AMBAS as partes ("não são segredo entre as
 * partes" — ver a rota). Quem digita é sempre a empresa: o POST devolve 403
 * para o profissional (codeService/route).
 */
export type HiringDetailResponse = {
  hiring: {
    id: string;
    status: string;
    jobTitle: string;
    side: "CONTRACTOR" | "PROFESSIONAL";
    grossValueCents: number;
    netValueCents: number;
    createdAt: string;
    completedAt: string | null;
    counterpart: {
      id: string;
      name: string;
      tradeName: string | null;
      city: string | null;
      state: string | null;
    };
    jobPosting: {
      id: string;
      title: string;
      category: string;
      startsAt: string;
      endsAt: string;
      status: string;
    };
    openingCode: string | null;
    closingCode: string | null;
    closingCodeUsedAt: string | null;
    evaluations: HiringEvaluations;
    chat: {
      id: string;
      status: ChatStatus;
      openedAt: string | null;
      closedAt: string | null;
    } | null;
  };
};

/** Resposta de POST /api/hirings/:id/codes (só a empresa confirma). */
export type HiringCodeResponse = {
  hiring: {
    id: string;
    status: string;
    openingCode: string | null;
    closingCode: string | null;
    closingCodeUsedAt: string | null;
  };
};

export type HiringSummary = {
  id: string;
  status: string;
  jobTitle: string;
  grossValueCents: number;
  netValueCents: number;
  commissionBps: number;
  createdAt: string;
  completedAt: string | null;
  side: "CONTRACTOR" | "PROFESSIONAL";
  jobPosting: {
    id: string;
    title: string;
    category: string;
    startsAt: string;
    endsAt: string;
    status: string;
  } | null;
  chat: ChatSummary | null;
  counterpart: {
    id: string;
    name: string;
    tradeName: string | null;
    avatarUrl: string | null;
    verified: boolean;
  };
};

export type HiringsResponse = { hirings: HiringSummary[] };

export type ApplicationStatus =
  | "PENDENTE"
  | "CONTRAPROPOSTA"
  | "SELECIONADO"
  | "SUPLENTE"
  | "DESISTIU";

/** GET /api/jobs/:id/applications — só o contratante dono da vaga (Fase 2.1.1). */
export type JobApplication = {
  id: string;
  status: ApplicationStatus;
  message: string | null;
  counterOfferValueCents: number | null;
  counterOfferBy: string | null;
  agreedValueCents: number | null;
  createdAt: string;
  professional: PublicUser & {
    // Nota + contagem de avaliações liberadas (Fase 2.3b).
    ratingAverage: number | null;
    evaluationCount: number;
    professionalProfile: {
      headline: string | null;
      bio: string | null;
      categories: string[];
      region: string | null;
      availability: string[];
      referencePriceCents: number | null;
      verificationStatus: string;
      ratingAverage: number | null;
      reliabilityScore: number | null;
    } | null;
    portfolioItemsCount: number;
    workExperiencesCount: number;
  };
};

export type JobApplicationsResponse = { applications: JobApplication[] };

// ----- Fase 2.5: profissionais públicos, "Me contrate" e propostas -----

/** Item de GET /api/professionals (bio já truncada em 200 chars). */
export type ProfessionalSummary = {
  id: string;
  name: string;
  headline: string | null;
  bio: string | null;
  categories: string[];
  city: string | null;
  state: string | null;
  referencePriceCents: number | null;
  ratingAverage: number | null;
  evaluationCount: number;
  verificationStatus: string;
};

export type ProfessionalsResponse = {
  professionals: ProfessionalSummary[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

export type PublicPortfolioItem = {
  id: string;
  kind: "FOTO" | "VIDEO";
  url: string;
  position: number;
};

export type PublicWorkExperience = {
  id: string;
  company: string;
  role: string;
  periodStart: string;
  periodEnd: string | null;
};

/** GET /api/professionals/:id — projeção pública (sem PII nem campos internos). */
export type PublicProfessionalProfile = {
  id: string;
  name: string;
  headline: string | null;
  bio: string | null;
  categories: string[];
  availability: string[];
  softSkills: string[];
  region: string | null;
  city: string | null;
  state: string | null;
  referencePriceCents: number | null;
  ratingAverage: number | null;
  evaluationCount: number;
  portfolio: PublicPortfolioItem[];
  workExperience: PublicWorkExperience[];
  isInfluencer: boolean;
  verificationStatus: string;
  createdAt: string;
};

export type PublicProfessionalResponse = {
  professional: PublicProfessionalProfile;
};

/** Proposta privada ("Me contrate") — GET /api/proposals. */
export type ProposalSide = "RECEIVED" | "SENT";

export type Proposal = {
  id: string;
  status: ApplicationStatus;
  side: ProposalSide;
  /** true quando a resposta é desta sessão (é o que conta no badge). */
  awaitingMe: boolean;
  message: string | null;
  valueCents: number;
  counterOfferValueCents: number | null;
  counterOfferBy: string | null;
  agreedValueCents: number | null;
  createdAt: string;
  counterpart: { id: string; name: string; tradeName: string | null };
  jobPosting: {
    id: string;
    title: string;
    category: string;
    city: string | null;
    state: string | null;
    valueCents: number;
    startsAt: string;
    endsAt: string;
    status: string;
  };
  hiring: { id: string; status: string } | null;
};

export type ProposalsResponse = {
  proposals: Proposal[];
  counts: { pending: number; received: number; sent: number; active: number };
};
