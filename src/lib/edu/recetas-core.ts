/**
 * DaleControl INSTITUCIONAL — Ola 14 · RECETAS, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin
 * `node:crypto`): lo importan la pantalla de la ficha, la bandeja y el
 * módulo de servidor. Aquí viven los topes de captura, la validación de
 * los renglones, el snapshot que entra al hash del gate y las formas que
 * viajan a la pantalla.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE ESTA OLA, EN UN PÁRRAFO
 *
 * Un alumno de especialidad NO tiene cédula profesional, y en México la
 * receta la expide un profesional con cédula. Así que en una escuela la
 * receta no puede funcionar como en una clínica privada: el alumno la
 * PROPONE, queda PENDIENTE (y no se imprime, no se manda y no se
 * descarga), y el DOCENTE con cédula la revisa, la firma y ahí queda
 * EXPEDIDA — con los dos nombres en el documento y la cédula del docente.
 * La autorización es una fila más de EduCaseApproval (etapa PRESCRIPTION,
 * Ola 4): mismo hash, misma bandeja, mismo "nadie firma su propia
 * petición". No hay un segundo mecanismo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduApprovalPrescriptionSnapshot } from "@/lib/edu/autorizaciones-core";
import type { EduPrescriptionStatus } from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · TOPES DE CAPTURA
//
// Los mismos que el `@db.VarChar` del schema: si aquí fueran más grandes,
// la base rebotaría la escritura con un error de Postgres en vez de un
// mensaje escrito para una persona.
// ═══════════════════════════════════════════════════════════════════════

export const EDU_RECETA_DRUG_MAX = 200;
export const EDU_RECETA_PRESENTATION_MAX = 160;
export const EDU_RECETA_DOSE_MAX = 120;
export const EDU_RECETA_ROUTE_MAX = 80;
export const EDU_RECETA_FREQUENCY_MAX = 120;
export const EDU_RECETA_DURATION_MAX = 120;
export const EDU_RECETA_QUANTITY_MAX = 60;
export const EDU_RECETA_ITEM_NOTES_MAX = 500;

/** Las columnas son Text; el tope es de la aplicación, no de Postgres. */
export const EDU_RECETA_DIAGNOSIS_MAX = 1000;
export const EDU_RECETA_INDICATIONS_MAX = 2000;

/**
 * Cuántos medicamentos caben en UNA receta. No es un límite técnico: una
 * receta odontológica con más de quince renglones no es una receta, es
 * una lista que nadie va a surtir — y un docente no puede leerla completa
 * de pie con el teléfono, que es la condición para firmarla.
 */
export const EDU_RECETA_MAX_ITEMS = 15;

/** Motivo de anulación: mínimo por lo mismo que el de la urgencia de la
 *  Ola 4 — "ya" no es un motivo que alguien pueda leer dentro de un año. */
export const EDU_RECETA_VOID_REASON_MIN = 8;
export const EDU_RECETA_VOID_REASON_MAX = 500;

/**
 * La cédula profesional del docente. No se valida contra la SEP —no hay
 * padrón consultable en este producto— pero sí que sea una cédula
 * plausible y no una casilla rellenada para pasar: dígitos y letras, de 5
 * caracteres para arriba.
 */
export const EDU_RECETA_CEDULA_MIN = 5;
export const EDU_RECETA_CEDULA_MAX = 30;

/** Techo de filas por consulta a la pestaña, como en todas las listas. */
export const EDU_RECETA_MAX_ROWS = 200;

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS RENGLONES: validación SIN base de datos
// ═══════════════════════════════════════════════════════════════════════

/** Un renglón tal como viaja del formulario al servidor. */
export interface EduRecetaItemDraft {
  drug: string;
  presentation: string | null;
  dose: string;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  notes: string | null;
}

function texto(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/**
 * ⚠️ Las claves del otro brazo van como `?: undefined` a propósito: este
 * repo compila con strict:false y ahí TypeScript NO estrecha el
 * discriminante (`if (!p.ok)` no quita el brazo contrario), así que
 * `p.error` tiene que EXISTIR en los dos brazos para poder leerse.
 */
export type EduRecetaItemsParse =
  | { ok: true; items: EduRecetaItemDraft[]; error?: undefined }
  | { ok: false; error: string; items?: undefined };

/**
 * Valida la lista de renglones que manda el cliente.
 *
 * Devuelve un resultado y no lanza, a propósito: este módulo es PURO y el
 * error tipado del vertical (EduPadronError) vive en el módulo de
 * servidor. Quien llama traduce `ok: false` al 400 con este texto.
 *
 * 🔴 MEDICAMENTO y DOSIS son obligatorios en CADA renglón. Una receta con
 * un medicamento sin dosis no es una instrucción: es una adivinanza que
 * el paciente resuelve en la farmacia. El resto (vía, frecuencia,
 * duración, cantidad, presentación, indicaciones) es opcional — no todo
 * medicamento lleva todo.
 */
export function eduRecetaParseItems(raw: unknown): EduRecetaItemsParse {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Agrega al menos un medicamento a la receta." };
  }
  if (raw.length > EDU_RECETA_MAX_ITEMS) {
    return {
      ok: false,
      error: `Una receta lleva como mucho ${EDU_RECETA_MAX_ITEMS} medicamentos. Si de verdad hacen falta más, haz una segunda receta.`,
    };
  }

  const items: EduRecetaItemDraft[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    if (typeof it !== "object" || it === null) {
      return { ok: false, error: `El renglón ${i + 1} no se pudo leer. Recarga y vuelve a intentarlo.` };
    }
    const r = it as Record<string, unknown>;
    const drug = texto(r.drug, EDU_RECETA_DRUG_MAX);
    if (!drug || drug.length < 2) {
      return { ok: false, error: `Escribe el medicamento del renglón ${i + 1}.` };
    }
    const dose = texto(r.dose, EDU_RECETA_DOSE_MAX);
    if (!dose) {
      return {
        ok: false,
        error: `Escribe la dosis de ${drug}. Un medicamento sin dosis no es una instrucción: es una adivinanza.`,
      };
    }
    items.push({
      drug,
      presentation: texto(r.presentation, EDU_RECETA_PRESENTATION_MAX),
      dose,
      route: texto(r.route, EDU_RECETA_ROUTE_MAX),
      frequency: texto(r.frequency, EDU_RECETA_FREQUENCY_MAX),
      duration: texto(r.duration, EDU_RECETA_DURATION_MAX),
      quantity: texto(r.quantity, EDU_RECETA_QUANTITY_MAX),
      notes: texto(r.notes, EDU_RECETA_ITEM_NOTES_MAX),
    });
  }
  return { ok: true, items };
}

/** La cédula, limpia. null = no sirve como cédula. */
export function eduRecetaCleanCedula(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < EDU_RECETA_CEDULA_MIN || t.length > EDU_RECETA_CEDULA_MAX) return null;
  // Dígitos, letras y guiones: lo que cabe en una cédula real (las de la
  // SEP son numéricas; se admite el formato viejo con letras). Cualquier
  // otra cosa es un dedazo o una casilla rellenada para pasar.
  if (!/^[0-9A-Za-zÁÉÍÓÚÑáéíóúñ-]+( [0-9A-Za-zÁÉÍÓÚÑáéíóúñ-]+)*$/.test(t)) return null;
  return t;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL SNAPSHOT QUE ENTRA AL HASH DEL GATE
// ═══════════════════════════════════════════════════════════════════════

/**
 * De la fila (con sus renglones YA en orden) al snapshot que digiere
 * `eduApprovalHash`. Es la ÚNICA forma de construirlo en todo el
 * vertical: si el servidor y la prueba lo armaran cada uno a su manera,
 * un campo olvidado en uno de los dos haría que "editó la receta" no
 * venciera la firma.
 */
export function eduRecetaSnapshot(receta: {
  diagnosis: string | null;
  indications: string | null;
  items: {
    drug: string | null;
    presentation: string | null;
    dose: string | null;
    route: string | null;
    frequency: string | null;
    duration: string | null;
    quantity: string | null;
    notes: string | null;
  }[];
}): EduApprovalPrescriptionSnapshot {
  return {
    kind: "EduPrescription",
    diagnosis: receta.diagnosis ?? null,
    indications: receta.indications ?? null,
    items: (receta.items ?? []).map((it) => ({
      drug: it.drug ?? null,
      presentation: it.presentation ?? null,
      dose: it.dose ?? null,
      route: it.route ?? null,
      frequency: it.frequency ?? null,
      duration: it.duration ?? null,
      quantity: it.quantity ?? null,
      notes: it.notes ?? null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · QUÉ SE PUEDE HACER EN CADA ESTADO
//
// Escritas como funciones y no como `if` sueltos para que el endpoint, la
// pantalla y la prueba digan EXACTAMENTE lo mismo. La transición completa
// vive en EDU_PRESCRIPTION_TRANSITIONS (types.ts).
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿Se puede EDITAR el contenido?
 *
 * BORRADOR, obvio. Y PENDIENTE también, a propósito: es el mismo criterio
 * que la Ola 4 con las notas — el alumno que ve el dedazo lo corrige, la
 * bandeja marca "la editó después de mandarla", y el hash que queda
 * firmado se calcula sobre lo que el docente LEYÓ al expedir. Bloquear la
 * edición en PENDIENTE solo obligaría a inventar un botón de "retirar"
 * para corregir una letra.
 */
export function eduRecetaEditable(status: EduPrescriptionStatus): boolean {
  return status === "BORRADOR" || status === "PENDIENTE";
}

/**
 * 🔴 ¿Se puede IMPRIMIR / DESCARGAR? — ÉSTE ES EL GATE DE LA OLA.
 *
 * Solo EXPEDIDA y ANULADA. La ANULADA sale marcada con su motivo — el
 * documento existió y esconderlo sería borrar historia — pero BORRADOR,
 * PENDIENTE y RECHAZADA no producen papel: un papel sin la cédula del
 * docente es exactamente lo que esta ola existe para que no salga de una
 * escuela. Si esta función dijera que sí, el gate no existiría.
 */
export function eduRecetaPrintable(status: EduPrescriptionStatus): boolean {
  return status === "EXPEDIDA" || status === "ANULADA";
}

/** ¿Se puede mandar (o re-mandar) a autorización? */
export function eduRecetaSendable(status: EduPrescriptionStatus): boolean {
  return status === "BORRADOR" || status === "PENDIENTE";
}

/** ¿Se puede anular? Solo lo EXPEDIDO se anula: lo demás nunca fue documento. */
export function eduRecetaVoidable(status: EduPrescriptionStatus): boolean {
  return status === "EXPEDIDA";
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Se definen aquí (módulo puro) por lo de siempre: un componente
// "use client" no puede importar el módulo que trae Prisma al navegador.
// Las fechas salen como string ISO Y ADEMÁS con su etiqueta ya formateada
// en la zona del INSTITUTO: la pantalla no vuelve a formatear nada.
// ═══════════════════════════════════════════════════════════════════════

export interface EduRecetaItemRow {
  id: string;
  orden: number;
  drug: string;
  presentation: string | null;
  dose: string;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  notes: string | null;
}

export interface EduRecetaRow {
  id: string;
  caseId: string;
  programName: string;
  status: EduPrescriptionStatus;

  diagnosis: string | null;
  indications: string | null;
  items: EduRecetaItemRow[];

  proposedByName: string;
  proposedByMatricula: string | null;
  createdAtLabel: string;

  issuedByName: string | null;
  issuedByCedula: string | null;
  issuedAtLabel: string | null;

  voidedByName: string | null;
  voidedAtLabel: string | null;
  voidReason: string | null;

  /**
   * La última palabra del docente sobre ESTA receta (el motivo del
   * rechazo o de los cambios pedidos), leída de su autorización de la
   * Ola 4. null = no hay nada que leer.
   */
  lastDecisionNote: string | null;

  /** La propuso quien está mirando. Es lo que abre el botón de editar. */
  mine: boolean;
  printable: boolean;
  editable: boolean;
  sendable: boolean;
  voidable: boolean;
}

/** Un caso al que se le puede colgar una receta nueva. */
export interface EduRecetaCaseOption {
  id: string;
  label: string;
}

/** Lo que se le pinta a quien abrió la pestaña y no le toca nada. */
export const EDU_RECETA_NONE_DETAIL =
  "Tu rol no ve recetas. Caja no las ve a propósito: una receta es un documento clínico, no un cobro. Las ven la dirección (todas), los docentes (las de sus estudiantes vigentes) y cada estudiante (las suyas).";
