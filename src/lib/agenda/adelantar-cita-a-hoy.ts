// ws1-t8 (decisión 6 de Rafael, 2-oct): el paciente de una cita FUTURA llega HOY.
//
// Al marcar su llegada, pasarlo al sillón o iniciar su consulta, la cita SE MUEVE A HOY: empieza ahora y
// conserva su duración y su doctor, para que el sistema sepa que la visita fue hoy (último control, «sin
// próximo control», la hoja, los reportes…). Es una corrección de la agenda, no un reagendado: el paciente
// NO recibe el aviso de «cita reprogramada», y los recordatorios que esperaban la fecha vieja se cancelan
// (ya está aquí). Queda en Movimientos y Google Calendar se pone al día.
//
// Conflictos: a esta hora el doctor o el sillón pueden tener otra cita. El paciente ya está en la clínica,
// así que la llegada NUNCA se bloquea por eso:
//   · sillón ocupado → la cita queda sin sillón (el de mañana no dice nada de hoy) y se avisa;
//   · doctor con otra cita encima → la cita entra igual, marcada como sobreturno con el motivo escrito
//     (`overrideReason`, el mismo campo que deja pasar el no-solape), y se avisa con quién se cruza.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { textoCita } from "@/lib/movimientos-paciente/textos";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { cancelPendingRemindersForAppointment } from "@/lib/reminders/reschedule.server";
import { sincronizarCitaEnSegundoPlano } from "@/lib/agenda/google-sync";
import {
  ESTADOS_CON_PACIENTE_PRESENTE,
  MOTIVO_RECORDATORIOS_ADELANTO,
  debeAdelantarseAHoy,
  planDeAdelanto,
  rangoAdelantado,
  type AdelantoAHoy,
  type ChoqueDeAgenda,
} from "./adelanto-a-hoy-regla";

export {
  ESTADOS_CON_PACIENTE_PRESENTE,
  MOTIVO_RECORDATORIOS_ADELANTO,
  adelantoParaRespuesta,
  debeAdelantarseAHoy,
  motivoDelSobreturno,
  planDeAdelanto,
  rangoAdelantado,
  type AdelantoAHoy,
  type AdelantoEnRespuesta,
  type ChoqueDeAgenda,
} from "./adelanto-a-hoy-regla";

/** Citas que ocupan (las mismas que cuenta el no-solape: todo menos canceladas y no asistidas). */
const OCUPA = { notIn: ["CANCELLED", "NO_SHOW"] } as Prisma.EnumAppointmentStatusFilter;

async function choque(where: Prisma.AppointmentWhereInput): Promise<ChoqueDeAgenda | null> {
  const fila = await prisma.appointment.findFirst({
    where,
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, patient: { select: { firstName: true, lastName: true } } },
  });
  if (!fila) return null;
  const paciente = fila.patient ? `${fila.patient.firstName} ${fila.patient.lastName}`.trim() : "otra cita";
  return { id: fila.id, paciente: paciente || "otra cita", startsAt: fila.startsAt };
}

/**
 * Lee la agenda de ahora y arma el adelanto, o `null` si la cita no se mueve (no es de un día futuro o el
 * destino no es una llegada). Solo lee: la escritura va en la transacción del cambio de estado.
 */
export async function prepararAdelantoAHoy(args: {
  clinicId: string;
  cita: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    doctorId: string;
    resourceId: string | null;
    overrideReason: string | null;
  };
  destino: string;
  ahora: Date;
  zona: string;
  userId: string;
}): Promise<AdelantoAHoy | null> {
  const { clinicId, cita, ahora, zona } = args;
  if (!clinicId) return null;
  if (!debeAdelantarseAHoy(cita, args.destino, ahora, zona)) return null;
  const rango = rangoAdelantado(cita, ahora);
  const hueco = {
    clinicId,
    id: { not: cita.id },
    status: OCUPA,
    startsAt: { lt: rango.endsAt },
    endsAt: { gt: rango.startsAt },
  } satisfies Prisma.AppointmentWhereInput;
  const [choqueDoctor, choqueSillon] = await Promise.all([
    choque({ ...hueco, doctorId: cita.doctorId }),
    cita.resourceId ? choque({ ...hueco, resourceId: cita.resourceId }) : Promise.resolve(null),
  ]);
  return planDeAdelanto({ cita, ahora, zona, userId: args.userId, choqueDoctor, choqueSillon });
}

/**
 * Firma de la hoja (signTreatmentCard): una cita de un día futuro que YA tiene al paciente presente (llegó
 * antes de que existiera el adelanto, o se marcó por otro camino) se trae a hoy antes de ligarla y cerrarla,
 * con lo mismo que la llegada: sin aviso al paciente, recordatorios cancelados, Movimientos y Google.
 * Devuelve el inicio nuevo, o `null` si no había nada que mover o no se pudo (la firma sigue igual: la
 * visita lleva la fecha de hoy). Nunca lanza.
 */
export async function adelantarCitaPresenteAHoy(args: {
  clinicId: string;
  appointmentId: string;
  userId: string;
  zona: string;
  ahora?: Date;
}): Promise<Date | null> {
  if (!args.clinicId || !args.appointmentId) return null;
  const ahora = args.ahora ?? new Date();
  try {
    const cita = await prisma.appointment.findFirst({
      where: { id: args.appointmentId, clinicId: args.clinicId },
      select: { id: true, status: true, startsAt: true, endsAt: true, doctorId: true, resourceId: true, overrideReason: true, patientId: true },
    });
    if (!cita || !ESTADOS_CON_PACIENTE_PRESENTE.has(cita.status)) return null;
    const adelanto = await prepararAdelantoAHoy({
      clinicId: args.clinicId,
      cita,
      destino: cita.status,
      ahora,
      zona: args.zona,
      userId: args.userId,
    });
    if (!adelanto) return null;
    const movida = await prisma.$transaction(async (tx) => {
      // Reclama la cita tal como se leyó: si cambió de estado o de hora entre medias, no se toca.
      const r = await tx.appointment.updateMany({
        where: { id: cita.id, clinicId: args.clinicId, status: cita.status, startsAt: cita.startsAt },
        data: adelanto.datos,
      });
      if (r.count !== 1) return false;
      await cancelPendingRemindersForAppointment(tx, {
        appointmentId: cita.id,
        clinicId: args.clinicId,
        reason: MOTIVO_RECORDATORIOS_ADELANTO,
      });
      return true;
    });
    if (!movida) return null;
    await registrarMovimientoDelPaciente({
      clinicId: args.clinicId,
      userId: args.userId,
      patientId: cita.patientId,
      entityType: "appointment",
      entityId: cita.id,
      action: "update",
      texto: textoCita.adelantadaAHoy(adelanto.antes.startsAt, adelanto.despues.startsAt, args.zona),
      campos: Object.keys(adelanto.datos),
      cambios: {
        startsAt: { before: adelanto.antes.startsAt, after: adelanto.despues.startsAt },
        endsAt: { before: adelanto.antes.endsAt, after: adelanto.despues.endsAt },
        ...(adelanto.sinSillon ? { resourceId: { before: cita.resourceId, after: null } } : {}),
      },
    });
    await sincronizarCitaEnSegundoPlano(args.clinicId, cita.id);
    return adelanto.despues.startsAt;
  } catch (e) {
    console.error("[adelantarCitaPresenteAHoy]", e);
    return null;
  }
}
