"use server";
// ws1-t8 (revisión de ws1-t9, fallo 2): desde la FICHA, la hoja de hoy ya firmada «sin cita» se liga a la cita
// de hoy (ligar-hoja-firmada-db.ts). La usan «Ver el control de hoy (firmado)» de la pestaña Ortodoncia y
// «Terminar consulta». La cita es la desde la que se abrió (consulta en curso o `?appointment=` de la ficha, de
// este paciente y de hoy) o ninguna; sin cita de origen, la primera cita de control de hoy del paciente. Nunca
// una cita que la sesión no pueda mover (un doctor, solo las suyas): cita-para-ligar-hoja.ts.
import { prisma } from "@/lib/prisma";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { citaParaLigarLaHoja } from "@/lib/orthodontics/cita-para-ligar-hoja";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { ligarHojaFirmadaDeHoyALaCita, type HojaFirmadaLigada } from "@/lib/orthodontics/ligar-hoja-firmada-db";

export async function ligarControlFirmadoDeHoy(
  treatmentPlanId: string,
  /** La cita desde la que se abrió la hoja: la consulta en curso o la de `?appointment=` de la ficha. */
  citaId?: string | null,
): Promise<ActionResult<HojaFirmadaLigada>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");
  const patient = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(patient)) return patient;

  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  const zona = clinic?.timezone ?? "America/Mexico_City";
  const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(new Date(), zona), zona);

  // Revisión final de ws1-t9 (fallo nuevo 2): la cita desde la que se abrió la hoja, o ninguna; y nunca una
  // que la sesión no pueda mover (citaParaLigarLaHoja). Una sola consulta: las citas de hoy del paciente.
  const citasDeHoy = await prisma.appointment.findMany({
    where: { clinicId: ctx.clinicId, patientId: plan.patientId, startsAt: { gte: startUtc, lt: endUtc } },
    orderBy: { startsAt: "asc" },
    select: { id: true, type: true, status: true, startsAt: true, doctorId: true },
  });
  const elegida = citaParaLigarLaHoja(citasDeHoy, citaId, { id: ctx.userId, role: String(ctx.role) });
  const cita = elegida ? { id: elegida.id, status: elegida.status, startsAt: elegida.startsAt } : null;
  if (!cita) return ok({ cardId: null, citaCerrada: null });

  return ok(
    await ligarHojaFirmadaDeHoyALaCita({
      clinicId: ctx.clinicId,
      patientId: plan.patientId,
      planId: plan.id,
      cita,
      rol: String(ctx.role),
      zona,
    }),
  );
}
