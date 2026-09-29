// ─────────────────────────────────────────────────────────────────────────────
// Cuándo se puede emitir un PDF que DA POR TERMINADO el tratamiento activo
// (ws1-t4, 29-sep-2026) — puro, sin I/O.
//
// La carta de alta y la carta «de término» al doctor que refirió dicen «concluyó
// la fase activa» / «ha concluido su tratamiento». Con el caso todavía en curso
// eso es falso, así que el servidor las niega aunque alguien llegue por la ruta
// directa. Misma regla para las dos: retención o terminado.
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS_TERMINADOS = new Set(["RETENTION", "COMPLETED"]);

/** ¿El caso ya dejó atrás la fase activa (retención o terminado)? */
export function casoConFaseActivaTerminada(status: string | null | undefined): boolean {
  return ESTADOS_TERMINADOS.has(String(status ?? ""));
}

export const MENSAJE_CARTA_DE_ALTA_EN_CURSO =
  "La carta de alta se emite cuando el caso está en retención o terminado.";

export const MENSAJE_CARTA_DE_TERMINO_EN_CURSO =
  "La carta de término para el doctor que refirió se emite cuando el caso está en retención o terminado. Mientras el tratamiento siga en curso, usa la carta de inicio.";

/** null = se puede emitir; si no, el motivo para el 400. */
export function motivoParaNoEmitirCartaDeAvance(stage: "inicio" | "termino", status: string | null | undefined): string | null {
  if (stage === "termino" && !casoConFaseActivaTerminada(status)) return MENSAJE_CARTA_DE_TERMINO_EN_CURSO;
  return null;
}
