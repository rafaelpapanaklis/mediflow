// Ortodoncia — «Completar varios a la vez» (ws1-t8, auditoría de BEVADENT: F11 y mejora 8). Puro: sin base ni React.
//
// Los casos MIGRADOS de otro sistema entran casi vacíos y todos salían en «Casos con diagnóstico o plan incompleto»
// (45 de 45 en BEVADENT), así que las alertas reales se perdían. Aquí vive:
//  · qué es un caso migrado (`esCasoMigrado`), aunque su diagnóstico ya se haya completado aquí;
//  · qué se puede cambiar de varios casos a la vez y cómo se valida lo que llega del cliente (`validarCambiosEnBloque`):
//    doctor tratante (solo si el caso no tiene), tiempo de tratamiento, controles previstos y la marca «migrado, sin
//    datos de diagnóstico». El diagnóstico NO se captura aquí: lo captura la clínica en la ficha.
//  · la propuesta de «controles previstos» (`controlesSugeridos` de siempre: la duración del caso entre la frecuencia
//    de control de la clínica).

import { CONTROLES_MAXIMOS, controlesSugeridos, type PiezaFaltante, type PasoDelCaso } from "./plan-detalle";

/** Lo que el importador deja escrito en un caso migrado (Dentalink hoy; el texto dice «migrado de <sistema>»). */
const MARCA_EN_DIAGNOSTICO = /migrado de dentalink/i;
const MARCA_EN_RESUMEN = /^\s*caso migrado de /i;
const MARCA_EN_RETENCION = /\(caso migrado de /i;

/**
 * ¿El caso vino de otro sistema? La marca del diagnóstico (`etiologyNotes`) se borra en cuanto la clínica completa el
 * diagnóstico, así que también se miran el resumen del diagnóstico y el plan de retención que escribe el importador,
 * y la marca M8 del plan. Basta una.
 */
export function esCasoMigrado(c: {
  etiologyNotes?: string | null;
  clinicalSummary?: string | null;
  retentionPlanText?: string | null;
  migradoSinDiagnostico?: boolean | null;
}): boolean {
  return (
    c.migradoSinDiagnostico === true ||
    MARCA_EN_DIAGNOSTICO.test(c.etiologyNotes ?? "") ||
    MARCA_EN_RESUMEN.test(c.clinicalSummary ?? "") ||
    MARCA_EN_RETENCION.test(c.retentionPlanText ?? "")
  );
}

/** La colocación ya está registrada: tiene fecha, o el caso ya no está «Por colocar». */
export function estaColocado(c: { installedAt?: Date | string | null; status?: string | null }): boolean {
  return Boolean(c.installedAt) || (Boolean(c.status) && c.status !== "PLANNED");
}

// ─── La tabla ───────────────────────────────────────────────────────────

export const DURACION_MINIMA_MESES = 1;
export const DURACION_MAXIMA_MESES = 120;
/** Cuántos casos se guardan de una vez (una transacción por caso; más, en otra vuelta). */
export const CASOS_POR_GUARDADO = 60;

/** Una fila de la tabla: el caso incompleto con lo que se puede editar desde aquí. */
export interface FilaParaCompletar {
  planId: string;
  patientId: string;
  patientName: string;
  faltan: PiezaFaltante[];
  paso: PasoDelCaso;
  /** Vino de otro sistema (solo a esos se les ofrece la marca «migrado, sin datos de diagnóstico»). */
  migrado: boolean;
  /** La marca ya está puesta. */
  sinDiagnosticoMarcado: boolean;
  /** Le falta el diagnóstico (lo que la marca saca de la alerta). */
  faltaDiagnostico: boolean;
  doctorId: string | null;
  /** Meses del caso; `null` si son el relleno neutro («sin capturar»). */
  duracionMeses: number | null;
  controlesPrevistos: number | null;
  /** Lo que se propone para «controles previstos» con la duración y la frecuencia de la clínica; null sin duración. */
  controlesPropuestos: number | null;
  /** El plan se puede guardar (existe la columna `planDetalle`). */
  planGuardable: boolean;
}

/** La propuesta de controles previstos de un caso: la duración real (no el relleno) entre la frecuencia de la clínica. */
export function propuestaDeControles(duracionMeses: number | null, frecuenciaDias: number): number | null {
  return duracionMeses ? controlesSugeridos(duracionMeses, frecuenciaDias) : null;
}

/**
 * C-84 (auditoría de uso): lo que dice «Proponer controles previstos». Antes, con casos sin tiempo de tratamiento,
 * no proponía nada y solo decía «Ninguno de los elegidos…»; ahora dice cuántos no tienen tiempo y qué hacer.
 */
export function mensajeDePropuesta(c: { propuestos: number; sinTiempo: number; yaTenian: number }): { tipo: "exito" | "aviso"; texto: string } {
  const casos = (n: number) => `${n} caso${n === 1 ? "" : "s"}`;
  const partes: string[] = [];
  if (c.sinTiempo > 0) {
    partes.push(`${casos(c.sinTiempo)} sin tiempo de tratamiento: escríbelo en su columna «Tiempo de tratamiento» y vuelve a proponer`);
  }
  if (c.yaTenian > 0) partes.push(`${casos(c.yaTenian)} ya tenía${c.yaTenian === 1 ? "" : "n"} controles previstos`);
  if (c.propuestos > 0) {
    return { tipo: "exito", texto: [`Propuestos en ${casos(c.propuestos)}. Revisa y guarda.`, ...partes.map((p) => `${p}.`)].join(" ") };
  }
  return { tipo: "aviso", texto: partes.length > 0 ? `No se propuso nada: ${partes.join("; ")}.` : "No se propuso nada: elige al menos un caso." };
}

/** Lo que llega del cliente para UN caso. Cada campo ausente = no tocarlo. */
export interface CambioDeUnCaso {
  planId: string;
  /** Solo si el caso no tiene doctor tratante. */
  doctorId?: string;
  duracionMeses?: number;
  controlesPrevistos?: number;
  /** true = poner la marca; false = quitarla. */
  migradoSinDiagnostico?: boolean;
}

// Los dos campos en las dos formas: con `"strict": false` TypeScript no estrecha la unión por `ok`.
export type ValidacionEnBloque = { ok: true; cambios: CambioDeUnCaso[]; error?: undefined } | { ok: false; error: string; cambios?: undefined };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function entero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Lo que manda la tabla, validado. Estricto: un dato fuera de rango se rechaza con su mensaje y no se guarda nada.
 * Un caso sin ningún cambio se descarta. Un caso repetido es un error (no se sabe cuál de los dos vale).
 */
export function validarCambiosEnBloque(raw: unknown): ValidacionEnBloque {
  if (!Array.isArray(raw)) return { ok: false, error: "Los cambios llegaron en un formato que no se entiende." };
  if (raw.length > CASOS_POR_GUARDADO) return { ok: false, error: `Guarda de ${CASOS_POR_GUARDADO} casos en ${CASOS_POR_GUARDADO} como máximo.` };
  const vistos = new Set<string>();
  const cambios: CambioDeUnCaso[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return { ok: false, error: "Un cambio llegó en un formato que no se entiende." };
    const o = x as Record<string, unknown>;
    if (typeof o.planId !== "string" || !ID.test(o.planId)) return { ok: false, error: "Un caso no se reconoce." };
    if (vistos.has(o.planId)) return { ok: false, error: "Un caso llegó dos veces." };
    vistos.add(o.planId);
    const c: CambioDeUnCaso = { planId: o.planId };
    if (o.doctorId !== undefined && o.doctorId !== null && o.doctorId !== "") {
      if (typeof o.doctorId !== "string" || !ID.test(o.doctorId)) return { ok: false, error: "Doctor tratante: elige uno de la lista." };
      c.doctorId = o.doctorId;
    }
    if (o.duracionMeses !== undefined && o.duracionMeses !== null && o.duracionMeses !== "") {
      const n = entero(o.duracionMeses, DURACION_MINIMA_MESES, DURACION_MAXIMA_MESES);
      if (n === null) return { ok: false, error: `Tiempo de tratamiento: escribe un número entero de ${DURACION_MINIMA_MESES} a ${DURACION_MAXIMA_MESES} meses.` };
      c.duracionMeses = n;
    }
    if (o.controlesPrevistos !== undefined && o.controlesPrevistos !== null && o.controlesPrevistos !== "") {
      const n = entero(o.controlesPrevistos, 1, CONTROLES_MAXIMOS);
      if (n === null) return { ok: false, error: `Controles previstos: escribe un número entero de 1 a ${CONTROLES_MAXIMOS}.` };
      c.controlesPrevistos = n;
    }
    if (o.migradoSinDiagnostico !== undefined && o.migradoSinDiagnostico !== null) {
      if (typeof o.migradoSinDiagnostico !== "boolean") return { ok: false, error: "La marca de migrado llegó en un formato que no se entiende." };
      c.migradoSinDiagnostico = o.migradoSinDiagnostico;
    }
    if (Object.keys(c).length > 1) cambios.push(c);
  }
  return { ok: true, cambios };
}

/**
 * Por qué NO se puede aplicar un cambio a un caso tal como está hoy (lo comprueba el servidor con el caso releído),
 * o null. La marca solo va en casos migrados; el doctor solo se pone donde falta (cambiarlo es «Datos del caso»).
 */
export function motivoParaNoAplicar(
  cambio: CambioDeUnCaso,
  caso: { migrado: boolean; doctorId: string | null; planGuardable: boolean },
): string | null {
  if (cambio.migradoSinDiagnostico === true && !caso.migrado) {
    return "La marca «migrado, sin datos de diagnóstico» solo va en casos que vinieron de otro sistema.";
  }
  if (cambio.doctorId !== undefined && caso.doctorId && caso.doctorId !== cambio.doctorId) {
    return "Este caso ya tiene doctor tratante: se cambia desde «Datos del caso».";
  }
  const tocaElPlan = cambio.controlesPrevistos !== undefined || cambio.duracionMeses !== undefined || cambio.migradoSinDiagnostico !== undefined;
  if (tocaElPlan && !caso.planGuardable) return "Falta pegar sql/ortodoncia-plan-de-tratamiento.sql: el plan no se puede guardar.";
  return null;
}

/** La frase de Movimientos al poner / quitar la marca. */
export function textoDeMovimientoDeLaMarca(puesta: boolean): string {
  return puesta
    ? "Marcó el caso de ortodoncia como «migrado, sin datos de diagnóstico» (sale de Casos incompletos; el diagnóstico sigue sin capturar)"
    : "Quitó la marca «migrado, sin datos de diagnóstico» del caso de ortodoncia";
}
