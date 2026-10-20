// Forma segura de devolver um usuário em JSON: sem hash de senha e com o
// documento mascarado (o número completo não trafega em resposta de API).

type UserLike = {
  id: string;
  name: string;
  tradeName: string | null;
  email: string;
  phone: string;
  documentType: string;
  document: string;
  birthDate: Date | null;
  city: string | null;
  state: string | null;
  termsAcceptedAt: Date | null;
  emailConfirmedAt: Date | null;
};

export function maskDocument(document: string): string {
  if (document.length === 11) {
    return `***.${document.slice(3, 6)}.${document.slice(6, 9)}-**`;
  }
  if (document.length === 14) {
    return `${document.slice(0, 2)}.***.${document.slice(5, 8)}/${document.slice(8, 12)}-**`;
  }
  return "***";
}

export function publicUser(user: UserLike) {
  return {
    id: user.id,
    name: user.name,
    tradeName: user.tradeName,
    email: user.email,
    phone: user.phone,
    documentType: user.documentType,
    documentMasked: maskDocument(user.document),
    birthDate: user.birthDate,
    city: user.city,
    state: user.state,
    termsAcceptedAt: user.termsAcceptedAt,
    emailConfirmedAt: user.emailConfirmedAt,
  };
}
