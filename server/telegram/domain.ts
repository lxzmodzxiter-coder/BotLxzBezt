export type DocumentType = "dni" | "ruc";

const DNI_PATTERN = /^\d{8}$/;
const RUC_PATTERN = /^\d{11}$/;
const RUC_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function isValidDni(value: string): boolean {
  return DNI_PATTERN.test(value) && value !== "00000000";
}

export function isValidRuc(value: string): boolean {
  if (!RUC_PATTERN.test(value) || value === "00000000000") return false;
  const sum = RUC_WEIGHTS.reduce(
    (total, weight, index) => total + Number(value[index]) * weight,
    0,
  );
  const remainder = 11 - (sum % 11);
  const expectedCheckDigit = remainder === 10 ? 0 : remainder === 11 ? 1 : remainder;
  return Number(value[10]) === expectedCheckDigit;
}

export function parseDocument(type: DocumentType, value: string) {
  const normalized = value.trim();
  const valid = type === "dni" ? isValidDni(normalized) : isValidRuc(normalized);
  return valid ? normalized : undefined;
}

export function inferDocumentType(value: string): DocumentType | undefined {
  const normalized = value.trim();
  if (normalized.length === 8) return "dni";
  if (normalized.length === 11) return "ruc";
  return undefined;
}

export function isValidTelegramUserId(value: string): boolean {
  return /^\d{5,20}$/.test(value);
}
