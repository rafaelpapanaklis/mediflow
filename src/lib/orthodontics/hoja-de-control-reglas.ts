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
 * ws1-t8 (ticket BEVADENT, punto 10): solo lo OBLIGATORIO bloquea la firma. El Plan (P) es lo único
 * obligatorio (`canSignSoap`); un hueco en S, O o A ya no impide firmar: se firma como «sin dato»
 * (ver `rellenarHuecosOpcionales`). Este mensaje solo habla de los huecos del Plan.
 * «Quedan 2 huecos (____) en el Plan, que es obligatorio. Llénalos para poder firmar.» `null` si no hay.
 */
export function mensajeDeHuecos(nota: NotaConHuecos): string | null {
  const enPlan = huecosDeLaNota(nota).porCampo.find((c) => c.campo === "p")?.huecos ?? 0;
  if (enPlan === 0) return null;
  return enPlan === 1
    ? `Queda 1 hueco (${HUECO}) en el Plan, que es obligatorio. Llénalo para poder firmar.`
    : `Quedan ${enPlan} huecos (${HUECO}) en el Plan, que es obligatorio. Llénalos para poder firmar.`;
}

/**
 * Lo que se escribe en la nota firmada en lugar de un hueco «____» de una parte OPCIONAL (S/O/A). Una nota
 * firmada no lleva huecos de plantilla (NOM-004): se dice explícitamente que ese dato no se registró. No se
 * borra la frase: puede llevar algo que el doctor sí escribió («Refiere ____ y molestia en el 24»).
 */
export const SIN_DATO = "[sin dato]";

/** «3 datos opcionales sin llenar (____) en Subjetivo y Objetivo: puedes firmar así…». `null` si no hay. */
export function avisoDeHuecosOpcionales(nota: NotaConHuecos): string | null {
  const opcionales = huecosDeLaNota(nota).porCampo.filter((c) => c.campo !== "p");
  if (opcionales.length === 0) return null;
  const total = opcionales.reduce((n, c) => n + c.huecos, 0);
  const dondes = opcionales.map((c) => c.etiqueta);
  const donde = dondes.length > 1 ? `${dondes.slice(0, -1).join(", ")} y ${dondes[dondes.length - 1]}` : dondes[0];
  return `${total === 1 ? "1 dato opcional sin llenar" : `${total} datos opcionales sin llenar`} (${HUECO}) en ${donde}: puedes firmar así y quedará escrito «${SIN_DATO}».`;
}

/** La nota tal como se firma: los huecos de S/O/A pasan a «[sin dato]»; el Plan no se toca (con hueco no se firma). */
export function rellenarHuecosOpcionales<T extends NotaConHuecos>(nota: T): T {
  const cambiar = (t: string) => (t ?? "").split(HUECO).join(SIN_DATO);
  return { ...nota, s: cambiar(nota.s), o: cambiar(nota.o), a: cambiar(nota.a) };
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

// ── ws1-t8 (ticket BEVADENT, punto 3): UNA nota por visita ──────────────────────────────
//
// «Pasar a consulta» crea el borrador de la nota de esa cita; si el doctor atiende el control con la hoja
// de ortodoncia, la hoja ADOPTA ese borrador al firmar (no crea una segunda nota). Lo que el doctor ya
// hubiera escrito en el borrador no se pierde: va delante de lo de la hoja.

/** El texto de una parte de la nota adoptada: lo del borrador de la consulta + lo de la hoja, sin repetir. */
export function fusionarTexto(borrador: string | null | undefined, hoja: string): string {
  const b = (borrador ?? "").trim();
  if (!b) return hoja;
  if (!hoja.trim()) return b;
  if (hoja.includes(b)) return hoja;
  return `${b}\n\n${hoja}`;
}

export function fusionarNotaDeConsulta(
  borrador: { subjective: string | null; objective: string | null; assessment: string | null; plan: string | null },
  hoja: NotaConHuecos,
): NotaConHuecos {
  return {
    s: fusionarTexto(borrador.subjective, hoja.s),
    o: fusionarTexto(borrador.objective, hoja.o),
    a: fusionarTexto(borrador.assessment, hoja.a),
    p: fusionarTexto(borrador.plan, hoja.p),
  };
}
