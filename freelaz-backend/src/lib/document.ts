/**
 * Validação de CPF e CNPJ sem dependência externa (só dígitos + dígito
 * verificador), cobrindo também o CNPJ alfanumérico vigente a partir de
 * 2026 (o valor de cada caractere é ASCII - 48, o que faz o mesmo cálculo
 * valer para o formato antigo só-numérico e o novo com letras).
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Normaliza CPF/CNPJ aceitando pontuação ou, no caso do CNPJ novo, letras. */
export function normalizeDocument(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

function charValue(c: string): number {
  // Regra oficial da Receita: dígito = ASCII - 48; letra 'A'-'Z' = 17-42.
  return c.charCodeAt(0) - 48;
}

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += charValue(base[i]) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCPF(raw: string): boolean {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return false;
  // CPFs com todos os dígitos iguais passam no cálculo, mas são inválidos.
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const d1 = checkDigit(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(cpf.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cpf[9] === String(d1) && cpf[10] === String(d2);
}

export function isValidCNPJ(raw: string): boolean {
  const doc = normalizeDocument(raw);
  if (doc.length !== 14 || !/^[0-9A-Z]{14}$/.test(doc)) return false;
  const d1 = checkDigit(doc.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(doc.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return doc[12] === String(d1) && doc[13] === String(d2);
}

/**
 * Maior de idade, checada na data atual (bloqueio automático de menores,
 * regra do cadastro CPF).
 */
export function isAtLeast18(birthDate: Date): boolean {
  const today = new Date();
  const adult = new Date(
    birthDate.getFullYear() + 18,
    birthDate.getMonth(),
    birthDate.getDate()
  );
  return adult <= today;
}
