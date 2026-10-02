"use server";
// Orthodontics — Control y agenda (ws1-t4, Ola 1, sep-2026).
//
// Datos mínimos para que `BotonHojaControl` (agenda/BotonHojaControl.tsx)
// pueda abrir `DrawerTreatmentCard` desde una cita de control, sin arrastrar
// las ~14 consultas de `loadOrthoRedesignData` (pensado para la ficha
// completa del paciente, no para un botón de la agenda). Cuatro consultas
// en paralelo — bajo el límite de 7 por Promise.all de las reglas de la
// casa.
//
// Tolera P2021/P2022 en `orthoTreatmentCard` (columnas nuevas de
// sql/ortodoncia-nucleo.sql y sql/ortodoncia-control-agenda.sql aún sin
// aplicar en esta base) — mismo patrón que loader.ts / cobranza-db.ts:
// si la tabla/columna no existe todavía, se trata como "sin hojas
// anteriores", no como error.
//
// Arreglo de la revisión cruzada (REPORTE-ws1-t1.md, sección «Revisión
// cruzada»): no comprobaba visibilidad de paciente — cualquier usuario
// autenticado de la clínica con `medicalRecord.view` podía leer el plan,
// wires y foto-sets de un paciente restringido con solo adivinar su
// treatmentPlanId/appointmentId. Ahora reusa `loadPatientForOrtho`
// (`_helpers.ts`), el mismo chequeo que el resto del módulo.
//
// Ronda 6 (ws1-t8, «El día de la ortodoncista», M6/M12): la construcción del
// contexto se separó en `buildTreatmentCardContext` para que
// `getTreatmentCardContextForPatient.ts` (entrada desde la ficha, "Registrar
// control" sin pasar por una cita concreta) devuelva EXACTAMENTE lo mismo —
// "una sola forma de registrar el control" también en el backend, no solo en
// el botón. Dos añadidos sobre la Ola 1:
//   · M12 — `lastElastics`/`lastIndications`: lo que la ÚLTIMA hoja firmada
//     dejó anotado, para precargar la hoja nueva (hallazgo 12: "la hoja
//     empieza en blanco cada vez").
//   · M6/hallazgo 7 — si YA hay una hoja de HOY para este plan (por fecha de
//     calendario en la zona de la clínica, `tarjetaDeControlDeHoy`), se
//     devuelve como `existingCard` aunque no esté ligada a ESTA cita: se
//     CONTINÚA esa hoja en vez de crear una segunda del mismo día.
import { prisma } from "@/lib/prisma";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import {
  buildTreatmentCardContext,
  type TreatmentCardAgendaContext,
} from "@/lib/orthodontics/treatment-card-context";
import { ligarHojaFirmadaDeHoyALaCita } from "@/lib/orthodontics/ligar-hoja-firmada-db";

// El núcleo `buildTreatmentCardContext` vive en
// src/lib/orthodontics/treatment-card-context.ts: exportado desde este archivo
// "use server" era una acción invocable sin sesión (ver el encabezado de allá).
export type { TreatmentCardAgendaContext };

export async function getTreatmentCardContextForAppointment(
  appointmentId: string,
  treatmentPlanId: string,
): Promise<ActionResult<TreatmentCardAgendaContext>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      installedAt: true,
      startDate: true,
      createdAt: true,
      // Fila 12: datos de la nota precargada.
      technique: true,
      patient: { select: { firstName: true, lastName: true } },
      paymentPlan: { select: { status: true } },
    },
  });
  if (!plan) return fail("Plan no encontrado");

  // Visibilidad por paciente (arreglo de la revisión cruzada, REPORTE-ws1-t1.md):
  // sin este chequeo, un doctor sin acceso a un paciente restringido
  // (excluido de `visibleUserIds`) podía igual leer su plan, sus wires y
  // sus foto-sets con solo conocer el treatmentPlanId/appointmentId.
  const patient = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(patient)) return patient;

  // Tenant + integridad: la cita tiene que ser de este mismo paciente/clínica.
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId, patientId: plan.patientId },
    select: { id: true, startsAt: true, endsAt: true, status: true },
  });
  if (!appt) return fail("Cita no encontrada para este paciente");

  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  const zona = clinic?.timezone ?? "America/Mexico_City";

  // ws1-t8 (revisión de ws1-t9, fallo 2): si la hoja de hoy ya se firmó «sin cita» (antes de que existiera esta
  // cita), abrirla desde esta cita de hoy la liga y cierra la cita: era «por registrar» con el control ya hecho.
  const ligada = await ligarHojaFirmadaDeHoyALaCita({
    clinicId: ctx.clinicId,
    patientId: plan.patientId,
    planId: plan.id,
    cita: appt,
    rol: String(ctx.role),
    zona,
  });
  const citaVigente = ligada.citaCerrada
    ? ((await prisma.appointment.findFirst({
        where: { id: appt.id, clinicId: ctx.clinicId },
        select: { id: true, startsAt: true, endsAt: true, status: true },
      })) ?? appt)
    : appt;

  const context = await buildTreatmentCardContext(plan, citaVigente, zona);
  return ok(ligada.cardId ? { ...context, hojaFirmadaLigada: { citaCerrada: ligada.citaCerrada !== null } } : context);
}
