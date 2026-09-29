// Piezas PURAS de las citas de Dentalink (05_Citas) — ws1-t10, 29-sep-2026. Sin Prisma ni motor: las usan el handler de
// citas vivas, el de historial, el de saldos y la tarjeta «Citas anteriores (migradas)» de la ficha (por eso este archivo
// no importa nada de servidor).
//
// Una cita pasada de Dentalink trae un «Estado Cita» que NO siempre dice cómo terminó: «Atendido», «No asiste» y las
// cancelaciones sí; «Cambio de fecha» dice que la cita se movió; y «Confirmado por pcte.», «No confirmado», «Notif. …»,
// «Recordado por IA»… son el último aviso que se mandó, no el resultado. Ninguno se descarta: entran todas, y las que no
// dicen si el paciente vino se llaman «sin registro de asistencia» (con el estado original conservado en la nota).

import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";

/** Minúsculas, sin acentos, sin espacios ni signos: la forma en que se comparan los textos del archivo. */
function comparable(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export type GrupoDeEstado =
  | "atendida"
  | "no_asistio"
  | "cancelada"
  | "reagendada"
  | "confirmada"
  /** Vigente pero sin confirmar («Agendado», «No confirmado», «Notificado…», «Recordado por IA», vacío…). */
  | "vigente";

/** Estado de Dentalink → grupo. Lo que no se reconoce cae en «vigente» (nunca se descarta una cita por su estado). */
export function grupoDeEstado(v: unknown): GrupoDeEstado {
  const n = comparable(v);
  if (!n) return "vigente";
  if (/cambiodefecha|reagend|reprogram|cambiofecha/.test(n)) return "reagendada";
  if (/anul|cancel|elimin|rechaz|suspend/.test(n)) return "cancelada";
  if (/noasist|inasist|ausent|falt|noshow/.test(n)) return "no_asistio";
  if (/atendid|realizad|complet|finaliz|terminad|attended/.test(n)) return "atendida";
  // «No confirmado», «Sin confirmar», «Por confirmar», «Pendiente de confirmación» NO están confirmadas.
  if (/(sin|no|por|pendiente)(de)?confirm/.test(n)) return "vigente";
  if (/confirm/.test(n)) return "confirmada";
  return "vigente";
}

/** El resultado de una cita PASADA en las palabras de la ficha. */
export const RESULTADO = {
  atendida: "Atendida",
  no_asistio: "No asistió",
  cancelada: "Cancelada",
  reagendada: "Reagendada (cambió de fecha)",
  sinRegistro: "Sin registro de asistencia",
} as const;

export type ResultadoDeVisita = (typeof RESULTADO)[keyof typeof RESULTADO];

/**
 * Cómo se guarda una cita pasada en `migrated_visits`. La columna `status` es el enum de citas (COMPLETED | NO_SHOW |
 * CANCELLED | PENDING): «reagendada» se guarda como CANCELLED (ese horario quedó vacío) y «sin registro de asistencia»
 * como PENDING (legado, nadie más lo lee de esa tabla); la palabra exacta va en la primera línea de la nota
 * («Resultado: …») y es la que enseña la ficha.
 */
export function visitaDeEstado(v: unknown): { status: "COMPLETED" | "NO_SHOW" | "CANCELLED" | "PENDING"; resultado: ResultadoDeVisita; grupo: GrupoDeEstado } {
  const grupo = grupoDeEstado(v);
  switch (grupo) {
    case "atendida": return { status: "COMPLETED", resultado: RESULTADO.atendida, grupo };
    case "no_asistio": return { status: "NO_SHOW", resultado: RESULTADO.no_asistio, grupo };
    case "cancelada": return { status: "CANCELLED", resultado: RESULTADO.cancelada, grupo };
    case "reagendada": return { status: "CANCELLED", resultado: RESULTADO.reagendada, grupo };
    default: return { status: "PENDING", resultado: RESULTADO.sinRegistro, grupo };
  }
}

export const PREFIJO_RESULTADO = "Resultado: ";

/** La palabra que enseña la ficha para una cita migrada: la de su nota si la trae; si no, la de su estado. */
export function etiquetaDeVisita(status: string, notes: string | null | undefined): string {
  if (notes) {
    for (const linea of notes.split("\n")) {
      if (linea.startsWith(PREFIJO_RESULTADO)) {
        const t = linea.slice(PREFIJO_RESULTADO.length).trim();
        if (t) return t;
      }
    }
  }
  switch (status) {
    case "COMPLETED": return RESULTADO.atendida;
    case "NO_SHOW": return RESULTADO.no_asistio;
    case "CANCELLED": return RESULTADO.cancelada;
    default: return RESULTADO.sinRegistro;
  }
}

/** La nota sin la línea «Resultado: …» (esa ya se enseña como etiqueta). */
export function notaSinResultado(notes: string | null | undefined): string {
  return (notes ?? "").split("\n").filter((l) => !l.startsWith(PREFIJO_RESULTADO)).join("\n").trim();
}

// ---------------------------------------------------------------------------
// Tipo de cita cuando la cita pertenece a un CASO de ortodoncia.
// ---------------------------------------------------------------------------

export interface TipoConCaso {
  tipo: string | null;
  /** ¿Es el «Control de ortodoncia» mensual (el que cuentan Controles y Alertas)? */
  esControl: boolean;
  /** ¿Se cambió el texto original del motivo? (entonces el original va a la nota) */
  cambio: boolean;
}

/**
 * Una cita ligada a un caso de ortodoncia es, por defecto, su «Control de ortodoncia» (decisión de Rafael: también la que
 * viene sin motivo). Un motivo que claramente es OTRA cosa se respeta —valoración, colocación, urgencia, retiro,
 * retención, una limpieza—: el catálogo de ortodoncia tiene esos tipos y ahí caen; lo demás conserva su texto.
 */
export function tipoParaCaso(motivo: string | null | undefined): TipoConCaso {
  const original = (motivo ?? "").trim();
  const n = comparable(original);
  const igual = (t: string, esControl: boolean): TipoConCaso => ({ tipo: t, esControl, cambio: comparable(t) !== n });
  if (!n) return { tipo: TIPO_CITA_CONTROL_ORTO, esControl: true, cambio: false };
  if (/valoraci/.test(n)) return igual("Valoración de ortodoncia", false);
  if (/colocaci|instalaci/.test(n)) return igual("Colocación de aparatología", false);
  if (/urgencia|emergencia/.test(n)) return igual("Urgencia de ortodoncia", false);
  if (/retiro/.test(n)) return igual("Retiro de aparatología", false);
  if (/retenci|contenci/.test(n) && !/control/.test(n)) return igual("Control de retención", false);
  if (/limpieza|profilaxis|restauraci|extracci|blanque|endodon|resina|caries|infantil|odontopediatr/.test(n)) return { tipo: original, esControl: false, cambio: false };
  if (/control|ajuste|activaci|seguimiento|revisi|damon|mensual|arco|elastic|bracket|cita/.test(n)) return igual(TIPO_CITA_CONTROL_ORTO, true);
  return { tipo: original, esControl: false, cambio: false };
}

// ---------------------------------------------------------------------------
// Sillón (Recurso) → consultorio.
// ---------------------------------------------------------------------------

export interface RecursoDeClinica {
  id: string;
  name: string;
  kind: string;
}

/** «Sobre Agendamiento» no es un sillón: es la marca de una cita sobreagendada. */
export function esSobreagendamiento(sillon: unknown): boolean {
  return /sobre(a|)gend/.test(comparable(sillon));
}

const KINDS_DE_SILLON = new Set(["SILLA_DENTAL", "CONSULTORIO_DENTAL", "CONSULTORIO_GENERAL", "CHAIR", "ROOM"]);

/**
 * El consultorio de la clínica que corresponde al «Sillón (Recurso)» del archivo: el que se llama igual; y, si ninguno
 * se llama así, el ÚNICO consultorio/sillón activo que tenga la clínica. Con varios distintos no se adivina: sin recurso.
 */
export function elegirRecurso(
  sillon: unknown,
  recursos: RecursoDeClinica[],
): { id: string | null; sobreagendada: boolean; porUnico?: boolean } {
  if (esSobreagendamiento(sillon)) return { id: null, sobreagendada: true };
  const n = comparable(sillon);
  if (!n) return { id: null, sobreagendada: false };
  const igual = recursos.filter((r) => comparable(r.name) === n);
  if (igual.length === 1) return { id: igual[0].id, sobreagendada: false };
  if (igual.length > 1) return { id: null, sobreagendada: false };
  const sillones = recursos.filter((r) => KINDS_DE_SILLON.has(r.kind));
  if (sillones.length === 1) return { id: sillones[0].id, sobreagendada: false, porUnico: true };
  return { id: null, sobreagendada: false };
}

// ---------------------------------------------------------------------------
// La nota legible de la cita.
// ---------------------------------------------------------------------------

export type EnlaceDeCita =
  | { tipo: "caso"; ref: string }
  | { tipo: "tratamiento"; ref: string }
  | { tipo: "suelta"; ref: string };

function una(v: unknown, max = 500): string {
  // eslint-disable-next-line no-control-regex
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

export interface DatosDeNota {
  /** Solo en el historial: «Atendida», «Sin registro de asistencia»… (primera línea, la lee la ficha). */
  resultado?: string;
  comentario?: unknown;
  observaciones?: unknown;
  /** El motivo original, cuando el tipo de la cita se cambió (a «Control de ortodoncia», p. ej.). */
  motivoOriginal?: string | null;
  estadoOrigen?: unknown;
  agendadoPor?: unknown;
  creadaEl?: unknown;
  /** El «# Cita» del sistema de origen. */
  citaRef?: unknown;
  sobreagendada?: boolean;
  /** El «Sillón (Recurso)» del archivo, cuando NO se pudo llevar a un consultorio de la clínica. */
  sillonSinEquivalente?: string | null;
  enlace?: EnlaceDeCita | null;
  /** Líneas propias del handler (p. ej. «se asignó a X por choque»). */
  extra?: string[];
}

/** La nota de la cita: una línea por dato, con etiqueta, en el orden en que se lee mejor. `null` si no hay nada. */
export function notasDeCita(d: DatosDeNota): string | null {
  const lineas: string[] = [];
  if (d.resultado) lineas.push(`${PREFIJO_RESULTADO}${d.resultado}`);
  const comentario = una(d.comentario);
  if (comentario) lineas.push(`Comentario: ${comentario}`);
  const obs = una(d.observaciones);
  if (obs) lineas.push(`Observaciones: ${obs}`);
  if (d.motivoOriginal && una(d.motivoOriginal)) lineas.push(`Motivo en Dentalink: ${una(d.motivoOriginal, 200)}`);
  const estado = una(d.estadoOrigen, 120);
  if (estado) lineas.push(`Estado en Dentalink: ${estado}`);
  const quien = una(d.agendadoPor, 120);
  const cuando = una(d.creadaEl, 40);
  if (quien || cuando) lineas.push(`Agendada${quien ? ` por ${quien}` : ""}${cuando ? ` el ${cuando}` : ""}`);
  const ref = una(d.citaRef, 40);
  if (ref) lineas.push(`Cita #${ref.replace(/\.0+$/, "")} de Dentalink`);
  if (d.sobreagendada) lineas.push("Sobreagendada: en Dentalink entró como «Sobre Agendamiento», encima de otra cita");
  else if (d.sillonSinEquivalente) lineas.push(`Sillón en Dentalink: ${una(d.sillonSinEquivalente, 80)}`);
  if (d.enlace) {
    if (d.enlace.tipo === "caso") lineas.push(`Del tratamiento #${d.enlace.ref} de Dentalink (caso de ortodoncia migrado)`);
    else if (d.enlace.tipo === "tratamiento") lineas.push(`Del tratamiento #${d.enlace.ref} de Dentalink (ya migrado)`);
    else lineas.push(`Tratamiento #${d.enlace.ref} de Dentalink (no está entre los tratamientos migrados)`);
  }
  for (const e of d.extra ?? []) if (e) lineas.push(e);
  return lineas.length ? lineas.join("\n") : null;
}
