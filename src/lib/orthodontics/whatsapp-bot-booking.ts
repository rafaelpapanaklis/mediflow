import "server-only";
// ═══════════════════════════════════════════════════════════════════════════
// ws1-t1 (Ortodoncia conectada al bot de WhatsApp) — lo que necesita el flujo
// de AGENDAR del bot (`lib/whatsapp/bot/booking-core.ts`) para reconocer a un
// paciente de ortodoncia y ofrecerle lo correcto:
//
//   · Ya tiene un caso ACTIVO en esta sede → se le ofrece su "Control de
//     ortodoncia" (catálogo de Configuración, id fijo "control") con su
//     doctor tratante, si lo tiene.
//   · No tiene caso, pero el mensaje que disparó "agendar" menciona
//     ortodoncia/brackets/alineadores → se le ofrece "Valoración de
//     ortodoncia" (misma fuente, id "valoracion").
//
// Nada de esto agenda por su cuenta: solo arma las opciones que
// `booking-core.ts` (puro, sin I/O) usa para saltarse preguntas que ya sabe
// contestar. Solo en sedes con el módulo de ortodoncia contratado — sin eso,
// devuelve el mismo "nada que ofrecer" que hoy.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { hasActiveOrthodonticsModule } from "./access";
import { loadOrthoClinicSettings, type OrthoAppointmentTypeOption } from "./clinic-settings-db";
import { ID_TIPO_CITA_CONTROL } from "./tipos-de-cita";
import { suggestOrthoAppointmentDuration } from "./appointment-durations";
import { ACTIVE_PLAN_STATUSES } from "./specialty-kpis";

const ID_TIPO_CITA_VALORACION = "valoracion";

/** Mismo fallback que ya usa el bot para cualquier servicio sin duración
 * configurada (`bot-booking-service.ts`), para cuando NI la clínica fijó un
 * valor NI `appointment-durations.ts` reconoce el texto. */
const DURACION_POR_DEFECTO_MIN = 30;

/**
 * ws1-t1 ronda 2 — orden de preferencia: (1) lo que la clínica configuró
 * para ESTE tipo de cita en Configuración (`durationMin`, editable), (2) el
 * mejor esfuerzo de `suggestOrthoAppointmentDuration()` sobre el texto, (3)
 * 30 min. El catálogo por defecto ya trae (1) puesto para "control" y
 * "valoracion" (`DEFAULT_ORTHO_APPOINTMENT_TYPES`).
 */
function duracionDe(tipo: { label: string; durationMin?: number | null }): number {
  if (tipo.durationMin != null && tipo.durationMin > 0) return tipo.durationMin;
  return suggestOrthoAppointmentDuration(tipo.label)?.minutes ?? DURACION_POR_DEFECTO_MIN;
}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export interface OrthoBookingCasoActivo {
  treatmentPlanId: string;
  /** Doctor tratante del caso, o `null` si la clínica no lo asignó. */
  treatingDoctorId: string | null;
  /** Texto exacto configurado para "Control de ortodoncia" (TIPO_CITA_CONTROL_ORTO, salvo que la clínica lo edite — su clave es fija, su texto no). */
  label: string;
  durationMin: number;
}

export interface OrthoBookingTipoValoracion {
  label: string;
  durationMin: number;
}

export interface OrthoBookingContext {
  /** `null` si el módulo no está activo en esta sede, o el paciente no tiene caso. */
  casoActivo: OrthoBookingCasoActivo | null;
  /** `null` si el módulo no está activo en esta sede. */
  valoracion: OrthoBookingTipoValoracion | null;
}

const SIN_CONTEXTO: OrthoBookingContext = { casoActivo: null, valoracion: null };

/**
 * Arma el contexto de ortodoncia para un turno de "agendar" del bot.
 * `patientId` es el paciente YA resuelto por teléfono (mismo criterio que el
 * resto del flujo de agenda: `phoneOwners[0]`, webhook de WhatsApp) — aquí no
 * se vuelve a buscar ni a desambiguar por número compartido.
 */
export async function getOrthoBookingContext(
  clinicId: string,
  patientId: string | null,
): Promise<OrthoBookingContext> {
  if (!clinicId) return SIN_CONTEXTO;

  let activo = false;
  try {
    activo = await hasActiveOrthodonticsModule(clinicId);
  } catch {
    return SIN_CONTEXTO;
  }
  if (!activo) return SIN_CONTEXTO;

  const { tipoControl, tipoValoracion } = await tiposDeCitaDe(clinicId);

  let casoActivo: OrthoBookingCasoActivo | null = null;
  if (patientId && tipoControl) {
    try {
      const plan = await prisma.orthodonticTreatmentPlan.findFirst({
        where: {
          clinicId,
          patientId,
          deletedAt: null,
          status: { in: ACTIVE_PLAN_STATUSES },
        },
        select: { id: true, treatingDoctorId: true },
        orderBy: { createdAt: "desc" },
      });
      if (plan) {
        casoActivo = {
          treatmentPlanId: plan.id,
          treatingDoctorId: plan.treatingDoctorId,
          label: tipoControl.label,
          durationMin: duracionDe(tipoControl),
        };
      }
    } catch (e) {
      if (!esRelacionAusente(e)) throw e;
    }
  }

  const valoracion: OrthoBookingTipoValoracion | null = tipoValoracion
    ? { label: tipoValoracion.label, durationMin: duracionDe(tipoValoracion) }
    : null;

  return { casoActivo, valoracion };
}

/** Los dos tipos fijos del catálogo (Configuración), o vacíos si la clínica
 * no tiene fila propia (usa los defaults, que siempre traen ambos). */
async function tiposDeCitaDe(
  clinicId: string,
): Promise<{ tipoControl?: OrthoAppointmentTypeOption; tipoValoracion?: OrthoAppointmentTypeOption }> {
  const settings = await loadOrthoClinicSettings(clinicId);
  return {
    tipoControl: settings.appointmentTypes.find((t) => t.id === ID_TIPO_CITA_CONTROL),
    tipoValoracion: settings.appointmentTypes.find((t) => t.id === ID_TIPO_CITA_VALORACION),
  };
}

/**
 * ws1-t1 (Ortodoncia conectada a la reserva web) — "Valoración de
 * ortodoncia" para inyectarla como un servicio más en la reserva pública de
 * la landing (`[slug]/_shared/booking-modal.tsx`). `null` si el módulo no
 * está activo en esta sede, o si la clínica no tiene ese tipo en su
 * catálogo. Nunca lanza: una landing pública no puede caerse por esto.
 */
export async function orthoValoracionParaLanding(
  clinicId: string,
): Promise<{ name: string; durationMin: number } | null> {
  if (!clinicId) return null;
  let activo = false;
  try {
    activo = await hasActiveOrthodonticsModule(clinicId);
  } catch {
    return null;
  }
  if (!activo) return null;
  const { tipoValoracion } = await tiposDeCitaDe(clinicId);
  if (!tipoValoracion) return null;
  return { name: tipoValoracion.label, durationMin: duracionDe(tipoValoracion) };
}
