// Ortodoncia — reglas puras de la hoja de control (ws1-t10, hallazgos #2, #11 y #17 de la
// revisión final de ws1-t9). Sin React ni Prisma: lo usan el cajón, la ficha y el servidor.

import { HUECO } from "./consulta-ortodoncia";

// ── #2 (NOM-004): no se firma una nota con huecos «____» ────────────────────────────────

export interface NotaConHuecos {
  s: string;
  o: string;
  a: string;
  p: string;
}

const CAMPOS = [
  { k: "s", etiqueta: "Subjetivo" },
  { k: "o", etiqueta: "Objetivo" },
  { k: "a", etiqueta: "Análisis" },
  { k: "p", etiqueta: "Plan" },
] as const;

export interface ReporteDeHuecos {
  total: number;
  porCampo: Array<{ campo: "s" | "o" | "a" | "p"; etiqueta: string; huecos: number }>;
}

/** Cuántos huecos quedan y en qué parte de la nota (S/O/A/P). */
export function huecosDeLaNota(nota: NotaConHuecos): ReporteDeHuecos {
  const porCampo = CAMPOS.map(({ k, etiqueta }) => ({
    campo: k,
    etiqueta,
    huecos: (nota[k] ?? "").split(HUECO).length - 1,
  })).filter((c) => c.huecos > 0);
  return { total: porCampo.reduce((n, c) => n + c.huecos, 0), porCampo };
}

/**
 * «Quedan 3 huecos (____): 1 en Subjetivo y 2 en Plan. Llénalos para poder firmar.»
 * `null` si no queda ninguno.
 */
export function mensajeDeHuecos(nota: NotaConHuecos): string | null {
  const { total, porCampo } = huecosDeLaNota(nota);
  if (total === 0) return null;
  const dondes = porCampo.map((c) => `${c.huecos} en ${c.etiqueta}`);
  const donde = dondes.length > 1 ? `${dondes.slice(0, -1).join(", ")} y ${dondes[dondes.length - 1]}` : dondes[0];
  return `${total === 1 ? "Queda 1 hueco" : `Quedan ${total} huecos`} (${HUECO}): ${donde}. Llénalos para poder firmar.`;
}

// ── #17: ¿ya hay una hoja FIRMADA de hoy? ───────────────────────────────────────────────

export interface HojaResumida {
  id: string;
  status: string;
  visitDate: string;
}

const claveDeDia = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** La hoja firmada cuya visita es de HOY (día de calendario del navegador), o null. */
export function hojaFirmadaDeHoy<T extends HojaResumida>(hojas: readonly T[], ahora: Date = new Date()): T | null {
  const hoy = claveDeDia(ahora);
  return hojas.find((h) => h.status === "SIGNED" && claveDeDia(new Date(h.visitDate)) === hoy) ?? null;
}

// ── #11: la fecha propuesta del próximo control ─────────────────────────────────────────

/** El horario en que se propone un control si no hay una hora de cita que respetar. */
export const HORA_POR_DEFECTO_DEL_CONTROL = 10;
const PRIMERA_HORA = 8;
const ULTIMA_HORA = 19;

/**
 * «Próximo control en N semanas», con HORA razonable. Antes tomaba la hora actual: firmar a
 * las 10:26 p. m. proponía las 10:26 p. m. y «Agendar este control» fallaba con «cae fuera
 * del horario de la clínica». Si la visita tiene hora de CITA (`horaDeCita`), se respeta;
 * si no, se conserva la hora de la visita solo cuando cae entre las 8:00 y las 19:59 (a la
 * media hora) y, si no, se propone las 10:00. El día sí sale de la visita + N semanas.
 */
export function proximaFechaDeControl(args: { desde: string | null; semanas: number; horaDeCita?: boolean }): string {
  const base = args.desde ? new Date(args.desde) : new Date();
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + args.semanas * 7);
  if (!args.horaDeCita) {
    const h = d.getHours();
    if (h < PRIMERA_HORA || h > ULTIMA_HORA) {
      d.setHours(HORA_POR_DEFECTO_DEL_CONTROL, 0, 0, 0);
    } else {
      d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
    }
  }
  return d.toISOString();
}

/**
 * Ayuda bajo el desplegable «Arco nuevo» cuando el caso no tiene ningún arco planificado (sin ella el desplegable solo
 * ofrece «Sin cambio» y no explica por qué). Con plan, «Otro arco…» permite sumar uno desde la misma hoja.
 */
export function avisoSinArcosPlanificados(cantidadDeArcos: number, conPlan: boolean): string | null {
  if (cantidadDeArcos > 0) return null;
  const base = "Aún no hay arcos planificados: cárgalos en Aparatología y arcos → Secuencia de arcos → Agregar arco.";
  return conPlan ? `${base} O usa «Otro arco…» aquí para sumar el de hoy.` : base;
}
