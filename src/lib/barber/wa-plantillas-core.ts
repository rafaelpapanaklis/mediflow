/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — plantillas de WhatsApp: qué se le ENSEÑA a la
   barbería del estado y de los fallos que manda Meta. PURO (sin red ni
   base), client-safe. Pruebas: src/lib/barber/__tests__/wa-plantillas.test.ts.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Motivos de rechazo que Meta documenta para `rejected_reason`
 * (Message Template API reference, consultada el 15-nov-2026). Cada uno
 * tiene su texto en barber.whatsapp.templates.rejected.<CÓDIGO>; el resto
 * cae en «other».
 */
export const BARBER_TEMPLATE_REJECTION_CODES = [
  "ABUSIVE_CONTENT",
  "CATEGORY_NOT_AVAILABLE",
  "INCORRECT_CATEGORY",
  "INVALID_FORMAT",
  "PROMOTIONAL",
  "SCAM",
  "TAG_CONTENT_MISMATCH",
  "NONE_OF_THE_ABOVE",
] as const;

/**
 * El motivo de rechazo que SÍ hay que enseñar, o null.
 *
 * Meta manda `rejected_reason: "NONE"` cuando NO hay rechazo (también en las
 * que están en revisión o aprobadas). En producción se pintaba «NONE» en
 * rojo bajo cada plantilla «En revisión» (15-nov-2026). Solo una plantilla
 * RECHAZADA con un motivo real lleva motivo.
 */
export function barberTemplateRejection(status: string | null | undefined, raw: unknown): string | null {
  if (String(status ?? "").toUpperCase() !== "REJECTED") return null;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!code || code === "NONE") return null;
  return code;
}

/** La llave de texto para un motivo (ya filtrado con barberTemplateRejection). */
export function barberTemplateRejectionKey(code: string): string {
  return (BARBER_TEMPLATE_REJECTION_CODES as readonly string[]).includes(code)
    ? `templates.rejected.${code}`
    : "templates.rejected.other";
}
