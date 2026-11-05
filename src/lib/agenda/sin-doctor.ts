/**
 * Cita «Sin doctor» (ws1-t11 · fase 2 · P1). Plan:
 * ~/gerentes/trabajos/20261104-1815-cita-sin-doctor-opcion-sin-doctor-por-de/PLAN.md
 *
 * `Appointment.doctorId = null` es una cita que todavía no es de nadie: se
 * asigna al llegar («¿Quién lo atiende?», opcional) o al INICIAR la consulta
 * (obligatorio; el DOCTOR que la inicia se la queda).
 *
 * Las reglas que se repiten en muchas rutas viven aquí, puras:
 *  · Una cita sin doctor NO ocupa a ningún doctor. Choca solo por su sillón,
 *    como la constraint `appt_doctor_no_overlap` (NULL nunca es igual a NULL).
 *    Ojo con Prisma: `where: { doctorId: null }` es `IS NULL` y empataría a
 *    todas las «Sin doctor» entre sí; por eso la rama del doctor se OMITE.
 *  · `{ doctorId: { not: X } }` en SQL excluye las filas NULL: quien quiera
 *    «las de otro doctor o sin doctor» tiene que pedirlo con `OR`.
 *  · `{ in: [null] }` revienta en Prisma: las listas de doctores se arman con
 *    `doctorIdsDe`.
 *  · Una teleconsulta nunca es «Sin doctor» (la sala, el pago y el cierre son
 *    del doctor).
 *
 * Sin dependencias de base: se prueba sola.
 */
import { MARCA_SOBREAGENDADA, esSobreagendada } from "./agenda-flexible";

/** Error de la API: una teleconsulta necesita doctor. */
export const ERROR_TELECONSULTA_SIN_DOCTOR = "teleconsult_requires_doctor" as const;
/** Error de la API: falta pegar `sql/cita-sin-doctor.sql` (la columna sigue NOT NULL). */
export const ERROR_SIN_DOCTOR_NO_DISPONIBLE = "sin_doctor_unavailable" as const;
/** Error de la API: iniciar la consulta pide saber quién atiende. */
export const ERROR_DOCTOR_PARA_INICIAR = "doctor_required_to_start" as const;

export const TEXTO_SIN_DOCTOR_NO_DISPONIBLE =
  "Todavía no se pueden agendar citas sin doctor en esta clínica: falta aplicar sql/cita-sin-doctor.sql. Elige un doctor.";
export const TEXTO_TELECONSULTA_SIN_DOCTOR = "Una teleconsulta necesita doctor: elige quién la atiende.";
export const TEXTO_DOCTOR_PARA_INICIAR = "Elige quién atiende al paciente antes de iniciar la consulta.";
export const TEXTO_DOCTOR_EN_CONSULTA = "Una cita en consulta no puede quedarse sin doctor: cámbiale el doctor por otro.";

/** Rótulo de una cita sin doctor en pantallas sin diccionario (el panel de solicitudes del portal). */
export const TEXTO_SIN_DOCTOR = "Sin doctor";

/**
 * Nombre del doctor de una cita para mostrarlo en el panel (ws1-t11, unión: R1). Sin doctor devuelve el rótulo
 * —`TEXTO_SIN_DOCTOR` o el que pase la pantalla, ya traducido—, nunca una celda vacía ni «—».
 */
export function nombreDoctorDeCita(
  doctor: { firstName?: string | null; lastName?: string | null } | null | undefined,
  sinDoctor: string = TEXTO_SIN_DOCTOR,
): string {
  if (!doctor) return sinDoctor;
  return [doctor.firstName, doctor.lastName].filter(Boolean).join(" ").trim();
}

/**
 * Valor del filtro de doctores de la agenda que pide las citas «Sin doctor»
 * (`/api/agenda/range?doctorIds=…`). No es un id de la base (no tiene la
 * forma de un cuid ni de un uuid).
 */
export const FILTRO_SIN_DOCTOR = "__sin_doctor__" as const;

/**
 * `doctorId` del cuerpo de un ALTA:
 *  · `null` explícito → «Sin doctor»;
 *  · un string no vacío → ese doctor;
 *  · cualquier otra cosa (ausente, "", número) → falta (el 400 de siempre).
 * Ausente NO es «Sin doctor»: un cliente viejo que olvida el campo sigue
 * recibiendo `missing_doctorId` en vez de crear citas sin doctor sin querer.
 */
export function doctorDelAlta(v: unknown): { ok: boolean; doctorId: string | null } {
  if (v === null) return { ok: true, doctorId: null };
  if (typeof v === "string" && v.trim().length > 0) return { ok: true, doctorId: v };
  return { ok: false, doctorId: null };
}

/**
 * `doctorId` del cuerpo de un CAMBIO:
 *  · ausente o "" → no cambia (lo de siempre: el formulario reenvía lo que hay);
 *  · `null` → quitarle el doctor (vuelve a «Sin doctor»);
 *  · un string → ese doctor.
 */
export function doctorDelCambio(v: unknown): { cambia: boolean; doctorId: string | null } {
  if (v === null) return { cambia: true, doctorId: null };
  if (typeof v === "string" && v.trim().length > 0) return { cambia: true, doctorId: v };
  return { cambia: false, doctorId: null };
}

/** La lista para `leerBloqueosDelRango` / `leerHorariosDeDoctores`: vacía sin doctor (quedan solo los de toda la clínica). */
export function doctorIdsDe(doctorId: string | null | undefined): string[] {
  return doctorId ? [doctorId] : [];
}

/** La rama «mismo doctor» de un `OR` de choques: ninguna sin doctor. */
export function ramaDelDoctor(doctorId: string | null | undefined): { doctorId: string }[] {
  return doctorId ? [{ doctorId }] : [];
}

/**
 * «De OTRO doctor (o sin doctor)», para `paciente-empalmado` y parecidos. Sin
 * doctor en la cita de referencia, no se filtra por doctor (devuelve null).
 */
export function deOtroDoctorOSinDoctor(doctorId: string | null | undefined): { OR: ({ doctorId: { not: string } } | { doctorId: null })[] } | null {
  if (!doctorId) return null;
  return { OR: [{ doctorId: { not: doctorId } }, { doctorId: null }] };
}

/** ¿Esta combinación no se permite? Una teleconsulta sin doctor. */
export function teleconsultaSinDoctor(mode: string | null | undefined, doctorId: string | null | undefined): boolean {
  return mode === "TELECONSULTATION" && !doctorId;
}

/**
 * ¿Un usuario con este rol puede tocar esta cita?
 * Fuera del rol DOCTOR, sí (lo de siempre). Un DOCTOR: las suyas, y las «Sin
 * doctor» (para tomarlas; qué puede hacer con ellas lo dicen las funciones
 * de abajo).
 */
export function doctorPuedeVer(role: string, userId: string, citaDoctorId: string | null): boolean {
  if (role !== "DOCTOR") return true;
  return citaDoctorId === null || citaDoctorId === userId;
}

/**
 * PATCH de una cita por un DOCTOR. Las suyas, como siempre. Una «Sin doctor»
 * solo si en el mismo cambio se la asigna a SÍ MISMO (la toma); no la puede
 * mover ni editar mientras no sea suya, ni dársela a otro.
 */
export function doctorPuedeEditar(
  role: string,
  userId: string,
  citaDoctorId: string | null,
  cambio: ReturnType<typeof doctorDelCambio>,
): boolean {
  if (role !== "DOCTOR") return true;
  // v2 (m6): un DOCTOR no pasa su cita a «Sin doctor»; eso lo hace recepción. Dársela a otro, como siempre.
  if (citaDoctorId === userId) return !(cambio.cambia && cambio.doctorId === null);
  if (citaDoctorId !== null) return false;
  return cambio.cambia && cambio.doctorId === userId;
}

/** Estados en los que el paciente ya está siendo atendido: la cita tiene que tener doctor. */
const ATENDIENDO = new Set(["IN_PROGRESS"]);
/** ¿En este estado la cita no puede quedarse «Sin doctor»? (en consulta). */
export function esEstadoQueExigeDoctor(status: string): boolean {
  return ATENDIENDO.has(status);
}
/** Lo que un DOCTOR puede hacer con una «Sin doctor» desde el cambio de estado. */
const DOCTOR_PUEDE_CON_SIN_DOCTOR = new Set(["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT"]);
/** Al llegar a estos estados, un DOCTOR que toca una «Sin doctor» se la queda. */
const EL_DOCTOR_SE_LA_QUEDA = new Set(["IN_PROGRESS", "COMPLETED", "CHECKED_OUT"]);

/**
 * `rechazo` ≠ null = no se puede (403 de siempre, o 409 «elige quién atiende»). Una sola forma (y no una unión
 * por `ok`): con `strict: false` TypeScript no estrecha por la bandera.
 */
export interface DoctorAlCambiarEstado {
  asignar: string | null;
  rechazo: null | { status: 403 | 409; error: string; reason?: string };
}
const NO_ES_TUYA: DoctorAlCambiarEstado = { asignar: null, rechazo: { status: 403, error: "not_your_appointment" } };

/**
 * El doctor de la cita al cambiar su estado (llegó, sillón, iniciar,
 * terminar…). `pedido` = el «¿Quién lo atiende?» de la pantalla (opcional).
 * `asignar` = el id que hay que escribirle a la cita en el mismo cambio
 * (null = no se toca el doctor).
 *
 *  · Cita con doctor: no se reasigna por aquí (eso es «Editar cita»). Un
 *    DOCTOR que no es el suyo, 403 como siempre.
 *  · «Sin doctor» y quien cambia es DOCTOR: puede marcar llegada / sillón sin
 *    quedársela (salvo que se elija a sí mismo), y al iniciar o terminar se la
 *    queda. Cancelar o marcar no-asistió una cita que no es suya, no.
 *  · «Sin doctor» y otro rol: se asigna el elegido si lo hay; iniciar la
 *    consulta sin elegir → 409 (D9 del plan).
 */
export function doctorAlCambiarEstado(args: {
  role: string;
  userId: string;
  citaDoctorId: string | null;
  destino: string;
  pedido: unknown;
}): DoctorAlCambiarEstado {
  const { role, userId, citaDoctorId, destino } = args;
  const pedido = doctorDelCambio(args.pedido);
  if (citaDoctorId !== null) {
    if (role === "DOCTOR" && citaDoctorId !== userId) return NO_ES_TUYA;
    return { asignar: null, rechazo: null };
  }
  if (role === "DOCTOR") {
    if (!DOCTOR_PUEDE_CON_SIN_DOCTOR.has(destino)) return NO_ES_TUYA;
    // Un DOCTOR solo se la puede dar a sí mismo.
    if (pedido.cambia && pedido.doctorId !== null && pedido.doctorId !== userId) {
      return NO_ES_TUYA;
    }
    const seLaQueda = EL_DOCTOR_SE_LA_QUEDA.has(destino) || (pedido.cambia && pedido.doctorId === userId);
    return { asignar: seLaQueda ? userId : null, rechazo: null };
  }
  // v2 (revisión del delta): el «¿Quién lo atiende?» solo cuenta al llegar, al sillón, al iniciar o al terminar.
  // En cualquier otro cambio (reabrir, cancelar, no vino, confirmar) se ignora: reasignar es «Editar cita».
  const elegido = pedido.cambia && DOCTOR_PUEDE_CON_SIN_DOCTOR.has(destino) ? pedido.doctorId : null;
  if (!elegido && ATENDIENDO.has(destino)) {
    return { asignar: null, rechazo: { status: 409, error: ERROR_DOCTOR_PARA_INICIAR, reason: TEXTO_DOCTOR_PARA_INICIAR } };
  }
  return { asignar: elegido, rechazo: null };
}

/** «Movió la cita» NO incluye ponerle doctor a una «Sin doctor» (sí cambiarle uno por otro). */
export function cambiaDeDoctor(antes: string | null, despues: string | null): boolean {
  return antes !== null && antes !== despues;
}

// ═══════════════ v2 (M1/m1 de la revisión de t12): el doctor que la toma ya tiene otra cita ═══════════════
//
// La constraint `appt_doctor_no_overlap` cuenta TODA cita viva del doctor (también la que ya terminó): la
// Dra. que atiende una tras otra las «Sin doctor» de las 10:00 no podría iniciar la segunda. Regla:
//  · al INICIAR o TERMINAR (ya lo está atendiendo) la cita entra sola como sobreturno, con rastro, igual que
//    el adelanto a hoy (`planDeAdelanto`);
//  · al MARCAR LA LLEGADA con el doctor elegido se pregunta «¿Seguro?» (409 `sobreagendable`) y se confirma
//    con la cita que se enseñó (`confirmacionValida`), también sin la bandera de agenda flexible: el paciente
//    ya está en la clínica, como en el adelanto. P2 pinta el «¿Seguro?».
// Vale igual si la «Sin doctor» ya venía sobreagendada (m1): la constraint no la ve, así que se mira aquí.

/** Destinos en los que el que se asigna ya lo está atendiendo: sobreturno sin preguntar. */
const SOBRETURNO_SIN_PREGUNTAR = new Set(["IN_PROGRESS", "COMPLETED", "CHECKED_OUT"]);

export function sobreturnoSinPreguntar(destino: string): boolean {
  return SOBRETURNO_SIN_PREGUNTAR.has(destino);
}

/** Campos del sobreturno al asignarle a la cita un doctor que ya tiene otra a esa hora. */
export interface DatosDeSobreturno {
  overrideReason?: string;
  overriddenBy?: string;
  overriddenAt?: Date;
}

/**
 * Sin marca: la marca de sobreagendada, quién y cuándo. Ya sobreagendada: conserva la marca y quién y cuándo
 * pasan a ser los de ahora (como al reabrir confirmando). Con OTRO motivo (el de un administrador, el del
 * adelanto a hoy): ya está fuera de la constraint y su motivo se conserva tal cual.
 */
export function datosDeSobreturno(overrideActual: string | null | undefined, userId: string, ahora: Date): DatosDeSobreturno {
  if (!overrideActual) return { overrideReason: MARCA_SOBREAGENDADA, overriddenBy: userId, overriddenAt: ahora };
  if (esSobreagendada(overrideActual)) return { overriddenBy: userId, overriddenAt: ahora };
  return {};
}

/** El «¿Seguro?» de la llegada: texto del servidor para las pantallas que no saben preguntar. */
export function textoSobreturnoAlLlegar(doctor: string | null, paciente: string, otras: number): string {
  const quien = `${paciente}${otras > 0 ? ` y ${otras} más` : ""}`;
  return `${doctor || "Ese doctor"} ya tiene otra cita a esa hora (${quien}). Si de todos modos lo atiende, confírmalo y la cita queda como sobreturno.`;
}
