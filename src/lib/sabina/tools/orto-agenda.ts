/**
 * Agendar ORTODONCIA con `agendar_cita` (ws1-t11, decisión de Rafael del
 * 28-sep-2026: «opción B»). Sabina agenda ortodoncia igual que agenda lo demás:
 * PROPONE, y la cita solo existe cuando el usuario toca el botón.
 *
 * ── QUÉ ES «UNA CITA DE ORTODONCIA» ────────────────────────────────────
 * `Appointment.type` es texto libre, y `POST /api/appointments` guarda ahí el
 * motivo. La Agenda, el Tablero, Controles y las Alertas reconocen un control
 * por ese texto EXACTO (`TIPO_CITA_CONTROL_ORTO`). Así que agendar bien un
 * control es mandar como motivo el texto del catálogo de Configuración →
 * Ortodoncia, letra por letra; «control de orto» en minúsculas se guardaría, y
 * el módulo no lo vería.
 *
 * Aquí se decide, a partir de lo que dijo el usuario:
 *  · el TIPO de cita del catálogo de la clínica (el suyo si lo editó; si no, el
 *    de fábrica) — `elegirTipoDeCita`;
 *  · su DURACIÓN: la que la clínica le puso a ese tipo; si no le puso, la regla
 *    del bot de WhatsApp y de la reserva web (`suggestOrthoAppointmentDuration`
 *    y, si tampoco, 30 min);
 *  · el DOCTOR: el tratante del caso; para quien no tiene caso, el tratante por
 *    defecto de Configuración. Si el usuario nombró a otro, manda el usuario.
 *
 * La disponibilidad, los bloqueos, el horario, el sillón, el rol y la key
 * `agenda.create` NO se tocan: son los de `agendar_cita`, que sigue siendo quien
 * arma la propuesta.
 *
 * ── CUÁNDO SE APLICA ───────────────────────────────────────────────────
 * Solo en clínicas dentales con el módulo contratado (mismo criterio que
 * `hasActiveOrthodonticsModule`). Un paciente con caso activo también viene a
 * limpieza: si el motivo no es de ortodoncia, la cita es una cita normal.
 *
 * Todo se lee por `ctx.db`, como el resto de `agendar_cita`, y con el
 * `clinicId` de la sesión. Sin Prisma global y sin `server-only`: este archivo
 * lo carga el catálogo entero.
 */

import { suggestOrthoAppointmentDuration } from "@/lib/orthodontics/appointment-durations";
import { DEFAULT_ORTHO_APPOINTMENT_TYPES } from "@/lib/orthodontics/clinic-settings-db";
import { ACTIVE_PLAN_STATUSES } from "@/lib/orthodontics/specialty-kpis";
import {
  ID_TIPO_CITA_CONTROL,
  nombreComparable,
  normalizarCatalogo,
  type TipoDeCita,
} from "@/lib/orthodontics/tipos-de-cita";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { detectaInteresOrtodoncia } from "@/lib/whatsapp/bot/booking-parse";
import type { SabinaCtx } from "../tipos";

/** Las claves de fábrica del catálogo que aquí se nombran. */
const ID_VALORACION = "valoracion";
const ID_CONTROL_RETENCION = "control-retencion";

/** Lo mismo que el bot y la reserva web cuando nadie fijó la duración. */
const DURACION_POR_DEFECTO_MIN = 30;

export interface CasoParaAgendar {
  planId: string;
  status: string;
  /** `null` = la clínica no le asignó doctor tratante. */
  treatingDoctorId: string | null;
}

export interface OrtoParaAgendar {
  /** Sede dental con el módulo contratado y vigente. */
  modulo: boolean;
  /** El catálogo de tipos de cita de Configuración (o el de fábrica). */
  catalogo: TipoDeCita[];
  /** El caso ACTIVO del paciente en esta sede, si lo tiene. */
  caso: CasoParaAgendar | null;
  /** «Doctor tratante por defecto» de Configuración. */
  doctorPorDefecto: string | null;
}

const SIN_ORTO: OrtoParaAgendar = { modulo: false, catalogo: [], caso: null, doctorPorDefecto: null };

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

function esCatalogo(v: unknown): v is TipoDeCita[] {
  return (
    Array.isArray(v) &&
    v.every((o) => o && typeof o === "object" && typeof (o as TipoDeCita).id === "string" && typeof (o as TipoDeCita).label === "string")
  );
}

/**
 * Lo que `agendar_cita` necesita saber de ortodoncia para ESTE paciente.
 *
 * Tres lecturas, con el mismo `where` que usan el guardia del módulo
 * (`hasActiveOrthodonticsModule`), el cargador de Configuración
 * (`loadOrthoClinicSettings`) y el bot (`getOrthoBookingContext`). Si la sede
 * no tiene el módulo, solo se hace la primera.
 */
export async function leerOrtoParaAgendar(
  ctx: SabinaCtx,
  /** El mismo cliente de lectura de `agendar_cita` (`dbAgendaDe(ctx)`). */
  db: unknown,
  patientId: string,
): Promise<OrtoParaAgendar> {
  if (ctx.clinicCategory !== "DENTAL") return SIN_ORTO;
  // Un cliente sin el modelo (un Prisma viejo en memoria, o un doble de prueba
  // anterior a esta tarea) es una sede sin módulo: la cita se agenda como siempre.
  if (typeof (db as any)?.clinicModule?.findFirst !== "function") return SIN_ORTO;

  const clinicId = ctx.clinicId;
  const contratado = await (db as any).clinicModule.findFirst({
    where: {
      clinicId,
      status: "active",
      currentPeriodEnd: { gt: new Date() },
      module: { key: ORTHODONTICS_MODULE_KEY },
    },
    select: { id: true },
  });
  if (!contratado) return SIN_ORTO;

  let catalogo: TipoDeCita[] = [...DEFAULT_ORTHO_APPOINTMENT_TYPES];
  let doctorPorDefecto: string | null = null;
  if (typeof (db as any).orthodonticsClinicSettings?.findUnique === "function") {
    try {
      const fila = await (db as any).orthodonticsClinicSettings.findUnique({
        where: { clinicId },
        select: { defaultTreatingDoctorId: true, appointmentTypes: true },
      });
      if (fila) {
        doctorPorDefecto = fila.defaultTreatingDoctorId ?? null;
        if (esCatalogo(fila.appointmentTypes)) catalogo = normalizarCatalogo(fila.appointmentTypes);
      }
    } catch (e) {
      if (!esRelacionAusente(e)) throw e;
    }
  }

  let caso: CasoParaAgendar | null = null;
  const where = { clinicId, patientId, deletedAt: null, status: { in: ACTIVE_PLAN_STATUSES } };
  try {
    const plan = await (db as any).orthodonticTreatmentPlan.findFirst({
      where,
      select: { id: true, status: true, treatingDoctorId: true },
      orderBy: { createdAt: "desc" },
    });
    if (plan) caso = { planId: plan.id, status: plan.status, treatingDoctorId: plan.treatingDoctorId ?? null };
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
    // La columna del doctor tratante aún no existe en esta base: el caso sí.
    const plan = await (db as any).orthodonticTreatmentPlan.findFirst({
      where,
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" },
    });
    if (plan) caso = { planId: plan.id, status: plan.status, treatingDoctorId: null };
  }

  return { modulo: true, catalogo, caso, doctorPorDefecto };
}

/** Los minutos de un tipo de cita: lo configurado, o la regla del bot y la reserva web. */
export function duracionDeTipo(tipo: Pick<TipoDeCita, "label" | "durationMin">): number {
  if (tipo.durationMin != null && Number.isFinite(tipo.durationMin) && tipo.durationMin > 0) return tipo.durationMin;
  return suggestOrthoAppointmentDuration(tipo.label)?.minutes ?? DURACION_POR_DEFECTO_MIN;
}

export type EleccionDeTipo =
  /** El motivo no es de ortodoncia: la cita es una cita normal. */
  | { tipo: "ninguno" }
  | { tipo: "uno"; cita: TipoDeCita }
  /** Puede ser más de uno: se PREGUNTA, no se elige. */
  | { tipo: "varios"; opciones: TipoDeCita[] };

/** Lo que en boca de un paciente CON caso activo quiere decir «su control». */
const PIDE_CONTROL = /\b(control(es)?|ajustes?|activacion(es)?|cambio de (arco|ligas)|ligas|revision de (brackets?|alineadores))\b/;

/**
 * El tipo de cita del catálogo que corresponde a lo que dijo el usuario.
 *
 *  1. Si nombra un tipo del catálogo («control de retención», «urgencia de
 *     ortodoncia»), ése. Si nombra un trozo que cabe en varios, se pregunta.
 *  2. Con caso activo, «su control», «su ajuste», «ortodoncia», «brackets» es
 *     su Control (o se pregunta, si está en retención y hay control de retención).
 *  3. Sin caso, solo es de ortodoncia si lo dice (`detectaInteresOrtodoncia`, el
 *     criterio del bot: estrecho a propósito): lo que toca es la Valoración.
 *  4. Lo demás («limpieza», «revisión») no es de ortodoncia.
 */
export function elegirTipoDeCita(motivo: string, catalogo: readonly TipoDeCita[], caso: CasoParaAgendar | null): EleccionDeTipo {
  const m = nombreComparable(motivo ?? "");
  if (!m || catalogo.length === 0) return { tipo: "ninguno" };
  const porId = (id: string) => catalogo.find((t) => t.id === id);
  const hablaDeOrto = detectaInteresOrtodoncia(m);

  // 1a. El texto exacto de un tipo: no hay nada que interpretar. Es también lo
  // que llega al revalidar la propuesta, así que tiene que dar siempre lo mismo.
  const exacto = catalogo.find((t) => nombreComparable(t.label) === m);
  if (exacto) return { tipo: "uno", cita: exacto };

  // 1b. El nombre entero de un tipo dentro de la frase («su control de retención del jueves»).
  const nombrados = catalogo.filter((t) => m.includes(nombreComparable(t.label)));
  if (nombrados.length === 1) return { tipo: "uno", cita: nombrados[0] };
  if (nombrados.length > 1) {
    // El más largo contiene a los demás («control de retención» ⊃ «control»).
    const masLargo = [...nombrados].sort((a, b) => b.label.length - a.label.length)[0];
    return { tipo: "uno", cita: masLargo };
  }

  if (caso) {
    if (PIDE_CONTROL.test(m) || hablaDeOrto) {
      const control = porId(ID_TIPO_CITA_CONTROL);
      const retencion = porId(ID_CONTROL_RETENCION);
      if (caso.status === "RETENTION" && control && retencion) return { tipo: "varios", opciones: [retencion, control] };
      if (control) return { tipo: "uno", cita: control };
    }
    return { tipo: "ninguno" };
  }

  if (hablaDeOrto) {
    const valoracion = porId(ID_VALORACION);
    if (valoracion) return { tipo: "uno", cita: valoracion };
    return { tipo: "varios", opciones: [...catalogo] };
  }
  return { tipo: "ninguno" };
}
