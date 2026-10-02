// ws1-t8 (revisión en panel.108 de ws1-t9, fallo 2): la hoja de control se firmó «sin cita» y DESPUÉS
// apareció la cita de hoy (recepción agendó tarde, o el paciente llegó sin cita y luego se le dio una). La
// cita se quedaba «Agendada» / «por registrar» en Hoy y en el módulo, y no había forma de cerrarla desde la
// hoja; «Terminar consulta» habría firmado otra nota para la misma visita.
//
// Regla (una nota por visita): esa hoja ES el control de esa cita. Cuando se abre la hoja desde la cita
// (Hoy, Agenda, Controles), desde «Ver el control de hoy» de la ficha o al «Terminar consulta», la hoja
// firmada de hoy sin cita se liga a la cita de hoy y la cita se cierra como al firmar con ella
// (`planDeCierreDeCita`, misma máquina de estados y la misma invitación a reseña). Su nota firmada no se
// reescribe (NOM-004): solo se apunta a la cita. Si en la consulta ya se escribió una nota propia, la hoja
// se liga pero la cita NO se cierra aquí: «Terminar consulta» firma esa nota como siempre.
//
// No se toca: una cita de otro día, una cita ya atendida/cancelada, una cita que ya tiene su hoja, ni una
// hoja que ya está ligada a otra cita.
import { Prisma, type AppointmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isClinicalNoteEmpty } from "@/lib/clinical/note-validation";
import { sendReviewInvitation } from "@/lib/reviews/invite";
import { tarjetaDeControlDeHoy } from "@/lib/orthodontics/redesign/control-del-dia";
import { datosDeCierreDeCita, diaEnZona, planDeCierreDeCita } from "@/lib/orthodontics/cerrar-cita-al-firmar";
import { buscarBorradorDeLaConsulta, buscarNotaDeHoja } from "@/lib/orthodontics/procedimientos-de-hoja-db";

const CITA_YA_CERRADA = new Set(["COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]);

export interface LigarHojaFirmada {
  clinicId: string;
  patientId: string;
  planId: string;
  cita: { id: string; status: string; startsAt: Date };
  rol: string;
  zona: string;
  ahora?: Date;
}

export interface HojaFirmadaLigada {
  /** La hoja firmada de hoy que quedó ligada a la cita (null = no había nada que ligar). */
  cardId: string | null;
  /** La cita se cerró («Atendida»). null si se ligó pero la consulta tiene su propia nota escrita. */
  citaCerrada: string | null;
}

const NADA: HojaFirmadaLigada = { cardId: null, citaCerrada: null };

export async function ligarHojaFirmadaDeHoyALaCita(a: LigarHojaFirmada): Promise<HojaFirmadaLigada> {
  const ahora = a.ahora ?? new Date();
  if (!a.clinicId || !a.patientId || !a.planId) return NADA;
  if (CITA_YA_CERRADA.has(a.cita.status)) return NADA;
  if (diaEnZona(a.cita.startsAt, a.zona) !== diaEnZona(ahora, a.zona)) return NADA;

  // La cita ya tiene su hoja (firmada o en borrador): no hay nada que ligar.
  const yaLigada = await prisma.orthoTreatmentCard.findFirst({
    where: { clinicId: a.clinicId, appointmentId: a.cita.id },
    select: { id: true },
  });
  if (yaLigada) return NADA;

  const firmadasSinCita = await prisma.orthoTreatmentCard.findMany({
    where: { clinicId: a.clinicId, treatmentPlanId: a.planId, status: "SIGNED", appointmentId: null },
    select: { id: true, visitDate: true },
  });
  const hoja = tarjetaDeControlDeHoy(firmadasSinCita, a.zona, ahora);
  if (!hoja) return NADA;

  // Condicionado a que siga sin cita: dos pestañas a la vez no la ligan dos veces.
  let ligadas = 0;
  try {
    ligadas = (
      await prisma.orthoTreatmentCard.updateMany({
        where: { id: hoja.id, clinicId: a.clinicId, appointmentId: null },
        data: { appointmentId: a.cita.id },
      })
    ).count;
  } catch (e) {
    // P2002: otra hoja se ligó a esta cita en el mismo instante.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return NADA;
    throw e;
  }
  if (ligadas === 0) return NADA;

  // La nota firmada de la hoja no se reescribe: solo queda apuntando a la cita.
  const nota = await buscarNotaDeHoja(a.clinicId, hoja.id);
  if (nota) {
    await prisma.medicalRecord.update({
      where: { id: nota.id },
      data: { specialtyData: { ...nota.specialtyData, appointmentId: a.cita.id } as unknown as Prisma.InputJsonValue },
    });
  }

  // ¿La consulta de esta cita ya tiene su propia nota escrita? Entonces la cita la cierra «Terminar consulta».
  const borrador = await buscarBorradorDeLaConsulta(a.clinicId, a.patientId, a.cita.id);
  if (borrador && !isClinicalNoteEmpty(borrador)) return { cardId: hoja.id, citaCerrada: null };
  if (borrador && nota) {
    // El borrador vacío de «Pasar a consulta» queda absorbido por la nota de la hoja (no se borra).
    await prisma.medicalRecord.update({
      where: { id: borrador.id },
      data: { specialtyData: { ...borrador.specialtyData, absorbidaEnNota: nota.id } as unknown as Prisma.InputJsonValue },
    });
  }

  const cierre = datosDeCierreDeCita(planDeCierreDeCita(a.cita.status, a.rol, ahora, a.cita.startsAt), ahora);
  if (!cierre) return { cardId: hoja.id, citaCerrada: null };
  const cerradas = await prisma.appointment.updateMany({
    where: { id: a.cita.id, clinicId: a.clinicId, status: a.cita.status as AppointmentStatus },
    data: cierre,
  });
  if (cerradas.count === 0) return { cardId: hoja.id, citaCerrada: null };
  // Igual que al firmar con la cita (signTreatmentCard): idempotente y nunca lanza.
  await sendReviewInvitation(a.cita.id);
  return { cardId: hoja.id, citaCerrada: a.cita.id };
}
