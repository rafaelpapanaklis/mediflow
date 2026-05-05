// Periodontics — atajos de teclado y parser "5-2". SPEC §5.4.

/**
 * Parsea el input numérico de captura del periodontograma.
 *
 * Acepta separador `-`, `/`, `,` o espacio normalizado. Formatos válidos:
 *   "5-2"    → pdMm=5, recMm=2
 *   "5/2"    → pdMm=5, recMm=2
 *   "5"      → pdMm=5, recMm=null
 *   "5-"     → pdMm=5, recMm=null
 *   "-2"     → pdMm=null, recMm=2  (rec aislada en formato 2-segmento)
 *   "5--2"   → pdMm=5, recMm=-2    (rec negativa, encía sobre CEJ)
 *
 * Rangos válidos: pdMm 0..15, recMm -5..15. Fuera de rango devuelve null
 * para ese campo (la celda muestra error y el operador re-tipea).
 */
export function parsePdRecInput(raw: string): { pdMm: number | null; recMm: number | null } {
  const normalized = raw.trim().replace(/\s+/g, "").replace(/[/,]/g, "-");
  if (!normalized) return { pdMm: null, recMm: null };

  // Caso especial: "-N" (sólo segundo segmento negativo) → rec aislada.
  // Ej. "-2" → pd=null, rec=-2.
  // Diferenciamos de "5--2" que tiene primer segmento.
  const lone = /^-?(\d{1,2})$/.exec(normalized);
  // Si arranca con "-" y sólo tiene 1-2 dígitos, asume rec aislada.
  if (/^-\d{1,2}$/.test(normalized)) {
    const rec = parseInt(normalized, 10);
    return {
      pdMm: null,
      recMm: rec >= -5 && rec <= 15 ? rec : null,
    };
  }
  if (lone) {
    const pd = parseInt(lone[1]!, 10);
    return {
      pdMm: pd >= 0 && pd <= 15 ? pd : null,
      recMm: null,
    };
  }

  // Formato "pd-rec" (rec puede ser negativo, ej. "5--2").
  const m = /^(\d{1,2})-(-?\d{1,2})?$/.exec(normalized);
  if (m) {
    const pd = parseInt(m[1]!, 10);
    const rec = m[2] !== undefined && m[2] !== "" ? parseInt(m[2]!, 10) : null;
    return {
      pdMm: pd >= 0 && pd <= 15 ? pd : null,
      recMm: rec !== null && rec >= -5 && rec <= 15 ? rec : null,
    };
  }

  return { pdMm: null, recMm: null };
}

/**
 * Atajos de captura del periodontograma. Documentados en `KeyboardCaptureLayer`.
 *
 * Tab            → siguiente sitio
 * Shift+Tab      → sitio anterior
 * Espacio        → toggle BoP
 * p / P          → toggle placa
 * s / S          → toggle supuración
 * Enter          → confirmar y avanzar (alternativa a Tab)
 * Escape         → cancelar edición de la celda actual
 */
export const SHORTCUTS = {
  TOGGLE_BOP: " ",
  TOGGLE_PLAQUE: "p",
  TOGGLE_SUPPURATION: "s",
  NEXT_SITE: "Tab",
  PREV_SITE: "Shift+Tab",
  CONFIRM: "Enter",
  CANCEL: "Escape",
} as const;

export type ShortcutKey = (typeof SHORTCUTS)[keyof typeof SHORTCUTS];
