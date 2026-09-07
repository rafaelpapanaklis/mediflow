/**
 * DaleControl INSTITUCIONAL — el cerebro del EXPEDIENTE, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido: el `now` siempre se pasa). Aquí viven las tres decisiones que,
 * si se escriben dos veces, terminan discrepando:
 *
 *   1. EL ALCANCE  · quién puede abrir un expediente (y caja NO)
 *   2. LA NOTA     · qué se puede editar y a qué estado se puede pasar
 *   3. LAS FORMAS  · lo que viaja del servidor a la pantalla
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ALCANCE DEL EXPEDIENTE ES EL DEL RECURSO "cases". PUNTO ÚNICO.
 *
 * Las notas cuelgan del CASO; el odontograma y los estudios cuelgan del
 * PACIENTE. Pero los tres se leen con el MISMO alcance —el de "cases"—
 * porque eso es lo que dice el contrato de la ola:
 *
 *   ALUMNO    → el expediente de SUS casos
 *   DOCENTE   → el de los alumnos que supervisa CON ASIGNACIÓN VIGENTE
 *   CAJA      → NADA. Ni notas, ni estudios, ni odontograma.
 *   DIRECCION → todo
 *
 * Si el odontograma se leyera con el alcance de "patients" (que es de
 * donde cuelga en la base), caja lo vería entero: para caja "patients" es
 * `all` y "cases" es `none`. Ese es exactamente el error que esta función
 * de una línea existe para impedir, y por eso los tres módulos de servidor
 * de esta ola la llaman a ella y no a `eduVisibility` directamente.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduRecordStatus } from "@/lib/edu/types";
import { EDU_RECORD_STATUSES, EDU_RECORD_TRANSITIONS } from "@/lib/edu/types";
import {
  eduVisibility,
  type EduVisibilityActor,
  type EduVisibilityScope,
} from "@/lib/edu/visibility";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ALCANCE
// ═══════════════════════════════════════════════════════════════════════

/**
 * El alcance con el que se lee TODO el expediente clínico: notas,
 * odontograma y estudios.
 *
 * No recibe el recurso como parámetro a propósito. Si lo recibiera, algún
 * endpoint acabaría pasándole "patients" —porque el odontograma es "del
 * paciente"— y caja leería el expediente de la escuela entera.
 */
export function eduClinicalScope(actor: EduVisibilityActor): EduVisibilityScope {
  return eduVisibility(actor, "cases");
}

/** Lo que se le pinta a quien abrió un expediente que no le toca. */
export const EDU_CLINICAL_NONE_DETAIL =
  "Tu rol no abre expedientes clínicos. Caja no los ve a propósito: recibe, agenda y cobra. Los ven la dirección (todos), los docentes (los de sus estudiantes vigentes) y cada estudiante (los de sus casos).";

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA NOTA
// ═══════════════════════════════════════════════════════════════════════

/** Topes de cada campo del SOAP. Los mismos que el `@db.VarChar` del
 *  schema: si aquí fueran más grandes, la base rebotaría la escritura con
 *  un error de Postgres en vez de un mensaje escrito para una persona. */
export const EDU_RECORD_TEXT_MAX = 4000;
export const EDU_RECORD_DIAGNOSIS_MAX = 500;

/**
 * Techo de notas por consulta.
 *
 * 🔴 SE LEE `MAX + 1` Y SE DEVUELVE `truncated`. El tope existe para que
 * una consulta rota no se traiga la tabla entera, pero un expediente
 * clinico que corta en 200 y CALLA es peor que uno lento: el alumno que
 * busca la nota de la primera sesion de un caso largo concluye que no
 * existe. Medido con el instituto de demo: 240 notas, se pintaban 200 y no
 * habia una sola palabra en pantalla que lo dijera. El resto del panel
 * (casos, pacientes, agenda, equipo, padron, caja, evaluacion, facturacion
 * y autorizaciones) ya avisaba; estas dos eran la excepcion.
 */
export const EDU_RECORD_MAX_ROWS = 200;

/** Los cuatro campos del SOAP, en el orden en que se escriben. */
export const EDU_SOAP_FIELDS = ["subjetivo", "objetivo", "analisis", "plan"] as const;
export type EduSoapField = (typeof EDU_SOAP_FIELDS)[number];

/** Cómo se llama cada campo EN PANTALLA, y qué se espera dentro. */
export const EDU_SOAP_LABELS: Record<EduSoapField, string> = {
  subjetivo: "Subjetivo",
  objetivo: "Objetivo",
  analisis: "Análisis",
  plan: "Plan",
};

export const EDU_SOAP_HINTS: Record<EduSoapField, string> = {
  subjetivo: "Lo que el paciente cuenta: motivo de consulta, síntomas, desde cuándo.",
  objetivo: "Lo que tú encuentras: exploración, signos, medidas, lo que se ve en el estudio.",
  analisis: "Tu interpretación: a qué te lleva lo anterior.",
  plan: "Qué se hizo hoy y qué sigue en la próxima cita.",
};

export function parseEduRecordStatus(raw: unknown): EduRecordStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_RECORD_STATUSES as string[]).includes(raw) ? (raw as EduRecordStatus) : null;
}

/**
 * ¿Se puede pasar de `from` a `to`?
 *
 * La tabla vive en types.ts (EDU_RECORD_TRANSITIONS) y no en un `switch`
 * aquí: la UI necesita la MISMA respuesta para saber qué botones pintar, y
 * dos copias de una máquina de estados es cómo se llega a un botón que la
 * pantalla ofrece y el endpoint rechaza.
 */
export function eduRecordCanTransition(from: EduRecordStatus, to: EduRecordStatus): boolean {
  return (EDU_RECORD_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * 🔴 LA REGLA DE LA NOM-004, EN UNA FUNCIÓN.
 *
 * Una nota FIRMADA no se edita. Ni el texto, ni el diagnóstico, ni la cita
 * a la que apunta, ni por la dirección del instituto. Se corrige con una
 * nota NUEVA que la referencia (`correctsId`).
 */
export function eduRecordIsEditable(status: EduRecordStatus): boolean {
  return status !== "FIRMADA";
}

/**
 * 🔴 ¿SE PUEDE RETIRAR ESTA NOTA? (H-23, Ola B)
 *
 * SOLO un BORRADOR. Y la lista de lo que NO se puede retirar es la razón
 * de que esta función exista en una línea y no como un `if` suelto en el
 * endpoint:
 *
 *   · una FIRMADA no se toca — es la NOM-004 entera. Se corrige con una
 *     nota nueva que la referencia (`correctsId`) y se leen las dos;
 *   · una ENVIADA tampoco, y ésta es la que se cuela: el alumno ya la
 *     entregó, su docente la tiene en la bandeja y puede haberla leído.
 *     Retirarla sería sacarle de las manos algo que le pidieron revisar.
 *     Para eso está "Devolver" (vuelve a BORRADOR, con su transición
 *     registrada) y desde ahí sí se retira.
 *
 * Retirar es para el borrador que NUNCA DEBIÓ EXISTIR —el que se abrió en
 * el paciente equivocado, o el que quedó vacío de un doble clic—, no para
 * deshacer trabajo entregado.
 */
export function eduRecordCanWithdraw(status: EduRecordStatus): boolean {
  return status === "BORRADOR";
}

/**
 * 🔴 H-23 · EL MOTIVO DE REBOTAR UNA NOTA VACÍA, ESCRITO UNA SOLA VEZ.
 *
 * Lo usan los DOS caminos que pueden dejar una nota sin una palabra: el
 * alta (`createEduRecord`) y la edición (`updateEduRecord`). Dos mensajes
 * distintos para la misma regla es como se llega a que la pantalla enseñe
 * uno y el endpoint conteste el otro.
 */
export const EDU_RECORD_EMPTY_DENIED =
  "La nota está vacía: escribe algo antes de guardarla, entregarla o firmarla.";

/**
 * 🔴 N-1 · LO QUE QUEDA ESCRITO EN LA PETICIÓN DE AUTORIZACIÓN QUE SE CIERRA
 * al retirar la nota.
 *
 * Vive aquí, en el módulo puro, por lo mismo que `EDU_RECORD_WITHDRAW_DENIED`:
 * lo lee una persona en la pantalla del docente, así que tiene que poder
 * comprobarse sin base de datos.
 *
 * Dice que no la decidió nadie porque la fila se cierra SIN `decidedById`:
 * atribuirle a un docente una decisión que no tomó es exactamente lo que la
 * cadena de custodia de este vertical existe para evitar.
 */
export const EDU_RECORD_WITHDRAWN_APPROVAL_NOTE =
  "La nota se retiró del expediente, así que esta petición se cerró sola. No la decidió nadie.";

/** El motivo del rechazo, escrito para una persona y no para un log. */
export const EDU_RECORD_WITHDRAW_DENIED =
  "Solo se retira un BORRADOR. Una nota ENVIADA ya está en la bandeja de tu docente: devuélvela a borrador y entonces se puede retirar. Una FIRMADA no se retira nunca — se corrige con una nota nueva que la referencia, y en el expediente se leen las dos. Es la NOM-004.";

/**
 * Los sellos que se DERIVAN de un cambio de estado. No se capturan:
 * así no puede existir una nota "firmada" sin fecha de firma, ni una fecha
 * de firma en una nota que sigue en borrador. Es la misma regla que
 * `EduCase.closedAt` (Ola 2) y que `eduAppointmentStamps` (agenda-core).
 *
 * Devolver una nota a BORRADOR limpia el sello de envío — si se quedara
 * puesto, la lista diría "entregada hace tres días" de algo que el alumno
 * está reescribiendo ahora.
 */
export interface EduRecordStamps {
  submittedAt?: Date | null;
  signedAt?: Date | null;
  signedByUserId?: string | null;
}

export function eduRecordStamps(
  to: EduRecordStatus,
  now: Date,
  signerUserId: string,
  current: { submittedAt: Date | null },
): EduRecordStamps {
  if (to === "FIRMADA") {
    return {
      // Firmar sin haber pasado por "enviada" es legítimo (la dirección
      // escribe y cierra en un solo acto), y en ese caso la entrega y la
      // firma son el mismo instante.
      submittedAt: current.submittedAt ?? now,
      signedAt: now,
      signedByUserId: signerUserId,
    };
  }
  if (to === "ENVIADA") {
    return { submittedAt: now, signedAt: null, signedByUserId: null };
  }
  // BORRADOR: se devolvió para corregir. Se limpian los dos sellos.
  return { submittedAt: null, signedAt: null, signedByUserId: null };
}

/**
 * Texto de un campo del SOAP tal como llega de un formulario.
 *
 * `undefined` = "no lo mandes"; "" y "   " = BORRAR. Misma semántica que
 * `eduOptionalText` de agenda-core, que es de donde salió — se repite la
 * firma en vez de importarla para no arrastrar el módulo de la agenda a
 * una pantalla que no la usa.
 */
export function eduRecordText(raw: unknown, maxLength: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (v.length === 0) return null;
  return v.slice(0, maxLength);
}

/**
 * Los CINCO campos de contenido de una nota: el SOAP más el diagnóstico.
 *
 * Escritos una vez y no cinco veces a mano en cada sitio que los recorre:
 * el día que el SOAP crezca, un `if` olvidado en uno de esos sitios sería
 * un campo que se puede reescribir sin que se note (S-3).
 */
export const EDU_RECORD_CONTENT_FIELDS = [
  "subjetivo",
  "objetivo",
  "analisis",
  "plan",
  "diagnostico",
] as const;
export type EduRecordContentField = (typeof EDU_RECORD_CONTENT_FIELDS)[number];

/** ¿La nota tiene ALGO escrito? Una nota vacía no se firma. */
export function eduRecordHasContent(r: {
  subjetivo?: string | null;
  objetivo?: string | null;
  analisis?: string | null;
  plan?: string | null;
  diagnostico?: string | null;
}): boolean {
  return Boolean(
    (r.subjetivo && r.subjetivo.trim()) ||
      (r.objetivo && r.objetivo.trim()) ||
      (r.analisis && r.analisis.trim()) ||
      (r.plan && r.plan.trim()) ||
      (r.diagnostico && r.diagnostico.trim()),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Se definen aquí (módulo puro) y no en el archivo de servidor por lo de
// siempre: un componente "use client" no puede importar el módulo que trae
// Prisma al navegador. Si el tipo no vive aquí, no hay de dónde.
//
// Las fechas salen como string ISO Y ADEMÁS con su etiqueta ya formateada:
// la pantalla no vuelve a formatear nada.
// ═══════════════════════════════════════════════════════════════════════

export interface EduRecordRow {
  id: string;
  status: EduRecordStatus;

  subjetivo: string | null;
  objetivo: string | null;
  analisis: string | null;
  plan: string | null;
  diagnostico: string | null;

  caseId: string;
  caseProgramName: string;
  patientId: string;

  studentId: string;
  studentName: string;
  studentMatricula: string;

  /** Quién la TECLEÓ (NOM-004: siempre identificable). */
  authorUserId: string;
  authorName: string;
  authorRoleLabel: string;

  appointmentId: string | null;
  /** Día de la cita que documenta, en la zona del instituto. */
  appointmentDayISO: string | null;
  appointmentLabel: string | null;

  submittedAt: string | null;
  signedAt: string | null;
  signedByName: string | null;

  /** La nota a la que corrige, si es una corrección. */
  correctsId: string | null;
  /** Cuántas correcciones tiene ESTA nota colgando. */
  correctionsCount: number;

  createdAt: string;
  createdLabel: string;
  updatedAt: string;
}

/**
 * Una página de notas: las filas Y si se quedó algo fuera.
 *
 * La bandera viaja PEGADA a las filas y no como un segundo valor que la
 * pantalla tenga que pedir aparte: así no puede existir una pantalla que
 * reciba las filas y se olvide de preguntar si estaban todas. Es la misma
 * forma que `EduCasosPanelPage` y que el resto del panel.
 */
export interface EduRecordPage {
  rows: EduRecordRow[];
  truncated: boolean;
}

/** Lo MÍNIMO para el <select> de "¿a qué caso va esta nota?". */
export interface EduCaseOption {
  id: string;
  programName: string;
  studentName: string;
  studentMatricula: string;
  /** Los casos cerrados se pintan, deshabilitados: una nota nueva va a un
   *  caso vivo, pero el expediente de uno cerrado se sigue leyendo. */
  isOpen: boolean;
}
