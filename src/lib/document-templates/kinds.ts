// Los dos tipos de plantilla, y solo dos. Coinciden 1:1 con el enum
// `DocumentTemplateKind` de prisma/schema.prisma; viven aquí como cadenas para
// que el cliente (que no importa @prisma/client) use los mismos valores.

export const DOCUMENT_TEMPLATE_KINDS = ["NOTA_EVOLUCION", "CONSENTIMIENTO"] as const;

export type DocumentTemplateKindValue = (typeof DOCUMENT_TEMPLATE_KINDS)[number];

export function isDocumentTemplateKind(v: unknown): v is DocumentTemplateKindValue {
  return typeof v === "string" && (DOCUMENT_TEMPLATE_KINDS as readonly string[]).includes(v);
}

export const MAX_NAME_LENGTH = 120;

/** El nombre tal como se guarda y se compara: sin espacios de sobra. */
export function normalizeTemplateName(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}
