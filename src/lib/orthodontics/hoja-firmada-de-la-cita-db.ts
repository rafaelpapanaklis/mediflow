// ws1-t8 (revisión final de ws1-t9, fallo nuevo 4): «Registrar control» salía en filas ya «Completadas» y con
// la hoja firmada (Hoy, panel de la cita, Tablero y Controles del módulo); al pulsarlo abría la hoja firmada.
// La etiqueta sugería que faltaba algo. Para decir «Ver control» hay que saber si el control de ESA cita ya
// está firmado, y eso pasa de dos maneras:
//   1. La hoja firmada está ligada a la cita (`orthoTreatmentCard.appointmentId`).
//   2. La cita es de HOY y el caso tiene la hoja de hoy firmada «sin cita»: al abrirla desde la cita se liga a
//      ella (ligar-hoja-firmada-db.ts), así que el botón ya no registra nada, la enseña.
// Sin el SQL de la hoja (tabla ausente) se calla: el botón sigue diciendo «Registrar control».
import { prisma } from "@/lib/prisma";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/** De estos casos, ¿cuáles tienen la hoja de HOY firmada y aún sin cita? Una sola consulta. */
export async function casosConHojaDeHoyFirmadaSinCita(
  clinicId: string,
  planIds: readonly string[],
  zona: string,
  ahora: Date = new Date(),
): Promise<Set<string>> {
  // `clinicId: undefined` no filtra en Prisma: sin clínica (o sin casos) no se consulta nada.
  if (!clinicId || planIds.length === 0) return new Set();
  const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(ahora, zona), zona);
  try {
    const filas = await prisma.orthoTreatmentCard.findMany({
      where: {
        clinicId,
        treatmentPlanId: { in: Array.from(new Set(planIds)) },
        status: "SIGNED",
        appointmentId: null,
        visitDate: { gte: startUtc, lt: endUtc },
      },
      select: { treatmentPlanId: true },
    });
    return new Set(filas.map((f) => f.treatmentPlanId));
  } catch (e) {
    if (esRelacionAusente(e)) return new Set();
    throw e;
  }
}

/** ¿El control de esta cita ya está firmado (ligado, o el de hoy «sin cita» del mismo caso si la cita es de hoy)? */
export async function hojaFirmadaDeLaCita(a: {
  clinicId: string;
  appointmentId: string;
  planId: string;
  zona: string;
  ahora?: Date;
}): Promise<boolean> {
  if (!a.clinicId || !a.appointmentId || !a.planId) return false;
  const ahora = a.ahora ?? new Date();
  try {
    const [ligada, cita] = await Promise.all([
      prisma.orthoTreatmentCard.findFirst({
        where: { clinicId: a.clinicId, appointmentId: a.appointmentId },
        select: { status: true },
      }),
      prisma.appointment.findFirst({
        where: { id: a.appointmentId, clinicId: a.clinicId },
        select: { startsAt: true },
      }),
    ]);
    if (ligada) return ligada.status === "SIGNED";
    if (!cita) return false;
    const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(ahora, a.zona), a.zona);
    if (cita.startsAt < startUtc || cita.startsAt >= endUtc) return false;
  } catch (e) {
    if (esRelacionAusente(e)) return false;
    throw e;
  }
  return (await casosConHojaDeHoyFirmadaSinCita(a.clinicId, [a.planId], a.zona, ahora)).has(a.planId);
}
