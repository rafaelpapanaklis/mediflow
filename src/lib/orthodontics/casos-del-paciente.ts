// ═══════════════════════════════════════════════════════════════════════════
// «CASOS DE ESTE PACIENTE» (ws1-t8). Puro: un paciente puede tener más de un
// caso (uno viejo terminado o abandonado y uno nuevo). La ficha enseña el
// ACTIVO por defecto y deja cambiar de caso con `?caso=<id>`; la sección
// «Casos» del módulo enlaza directo a ESE caso.
// ═══════════════════════════════════════════════════════════════════════════

import { ETIQUETA_ESTADO_CASO, type EstadoCasoOrto } from "./resumen-para-ficha";

/** El parámetro de la dirección que elige el caso en la pestaña Ortodoncia. */
export const PARAMETRO_CASO = "caso";

const ESTADO_POR_STATUS: Record<string, EstadoCasoOrto> = {
  PLANNED: "planeado",
  IN_PROGRESS: "en-curso",
  ON_HOLD: "pausado",
  RETENTION: "retencion",
  COMPLETED: "terminado",
  DROPPED_OUT: "abandonado",
};

/** Un caso que ya cerró: terminado o abandonado. */
export function esCasoCerrado(status: string): boolean {
  return status === "COMPLETED" || status === "DROPPED_OUT";
}

/** La ficha del paciente, pestaña Ortodoncia, en ESE caso. */
export function destinoDelCaso(patientId: string, planId: string): string {
  return `/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia&${PARAMETRO_CASO}=${encodeURIComponent(planId)}`;
}

/** Lo que llega en `?caso=`, saneado: solo un texto no vacío y corto; lo demás es «sin pedir». */
export function leerCasoPedido(valor: string | string[] | undefined): string | null {
  const v = (Array.isArray(valor) ? valor[0] : valor)?.trim();
  return v && v.length <= 64 && /^[\w-]+$/.test(v) ? v : null;
}

export interface CasoDelPaciente {
  id: string;
  status: string;
  /** ISO de cuando se colocó la aparatología; `null` si aún no. */
  installedAt: string | null;
  /** ISO de cuando se abrió el caso. */
  createdAt: string;
  /** Nombre de la técnica, ya resuelto («Brackets metálicos»). */
  tecnica: string;
}

/**
 * El caso que la ficha enseña: el pedido si es de este paciente; si no, el más
 * reciente que siga abierto; si todos cerraron, el más reciente. Los casos
 * llegan ya ordenados del más nuevo al más viejo.
 */
export function casoPorDefecto(casos: readonly { id: string; status: string }[], pedido?: string | null): string | null {
  if (pedido && casos.some((c) => c.id === pedido)) return pedido;
  return (casos.find((c) => !esCasoCerrado(c.status)) ?? casos[0])?.id ?? null;
}

export interface OpcionDeCaso {
  id: string;
  /** «Brackets metálicos · En curso · desde sep 2026». */
  etiqueta: string;
  estado: EstadoCasoOrto | null;
  actual: boolean;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «sep 2026», en UTC como el resto de las fechas de caso sin hora. */
function mesYAnio(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function opcionesDeCasos(casos: readonly CasoDelPaciente[], actualId: string | null): OpcionDeCaso[] {
  return casos.map((c) => {
    const estado = ESTADO_POR_STATUS[c.status] ?? null;
    const inicio = mesYAnio(c.installedAt ?? c.createdAt);
    const partes = [c.tecnica, estado ? ETIQUETA_ESTADO_CASO[estado] : null, inicio ? (c.installedAt ? `desde ${inicio}` : `abierto ${inicio}`) : null];
    return { id: c.id, etiqueta: partes.filter(Boolean).join(" · "), estado, actual: c.id === actualId };
  });
}
