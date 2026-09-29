import { prisma } from "@/lib/prisma";
import { registrarMovimientoExterno } from "@/lib/movimientos-paciente/registrar";
import { textoCita } from "@/lib/movimientos-paciente/textos";
import { zonaDeClinica } from "@/lib/movimientos-paciente/zona";

/**
 * Lo que hace el bot de WhatsApp queda en los movimientos del paciente como
 * «Bot de WhatsApp» (ws1-t12; sin usuario del equipo → `actorType: 'bot'`).
 * Todo aquí es best-effort y NUNCA tira: el bot ya hizo lo suyo, un fallo del
 * rastro no puede devolverle un error al paciente. Sin
 * sql/audit-logs-actor-externo.sql no escribe (ver registrarMovimientoExterno).
 * Sin clinicId no se consulta (un `undefined` no filtra nada).
 */

async function citaParaMovimiento(clinicId: string, appointmentId: string) {
  if (!clinicId || !appointmentId) return null;
  try {
    return await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: { id: true, patientId: true, startsAt: true },
    });
  } catch {
    return null;
  }
}

/** Foto de la cita ANTES de moverla (para decir «del … al …»). */
export async function citaAntesDeMover(clinicId: string, appointmentId: string) {
  return citaParaMovimiento(clinicId, appointmentId);
}

export async function anotarCitaCreadaPorBot(args: { clinicId: string; appointmentId: string | undefined | null }): Promise<void> {
  try {
    if (!args.appointmentId) return;
    const cita = await citaParaMovimiento(args.clinicId, args.appointmentId);
    if (!cita) return;
    await registrarMovimientoExterno({
      actor: "bot",
      clinicId: args.clinicId,
      patientId: cita.patientId,
      entityType: "appointment",
      entityId: cita.id,
      action: "create",
      texto: textoCita.agendada(cita.startsAt, await zonaDeClinica(args.clinicId)),
    });
  } catch (e) {
    console.error("[bot/movimientos] cita creada:", e);
  }
}

export async function anotarCitaMovidaPorBot(args: {
  clinicId: string;
  appointmentId: string | undefined | null;
  antes: { startsAt: Date } | null;
}): Promise<void> {
  try {
    if (!args.appointmentId) return;
    const cita = await citaParaMovimiento(args.clinicId, args.appointmentId);
    if (!cita) return;
    const zona = await zonaDeClinica(args.clinicId);
    await registrarMovimientoExterno({
      actor: "bot",
      clinicId: args.clinicId,
      patientId: cita.patientId,
      entityType: "appointment",
      entityId: cita.id,
      action: "update",
      texto: args.antes ? textoCita.movida(args.antes.startsAt, cita.startsAt, zona) : textoCita.editada(cita.startsAt, zona),
    });
  } catch (e) {
    console.error("[bot/movimientos] cita movida:", e);
  }
}

/** La respuesta del paciente a un recordatorio («CONFIRMAR» / «CANCELAR»). */
export async function anotarRespuestaARecordatorio(args: {
  clinicId: string;
  cita: { id: string; patientId: string; startsAt: Date; status: string };
  accion: "confirm" | "cancel";
}): Promise<void> {
  try {
    const zona = await zonaDeClinica(args.clinicId);
    await registrarMovimientoExterno({
      actor: "bot",
      clinicId: args.clinicId,
      patientId: args.cita.patientId,
      entityType: "appointment",
      entityId: args.cita.id,
      action: "update",
      texto:
        args.accion === "cancel"
          ? `${textoCita.cancelada(args.cita.startsAt, zona)} (respondió por WhatsApp)`
          : `${textoCita.estado(args.cita.startsAt, args.cita.status, "CONFIRMED", zona)} (respondió por WhatsApp)`,
      campos: ["status"],
    });
  } catch (e) {
    console.error("[bot/movimientos] respuesta a recordatorio:", e);
  }
}

export async function anotarPacienteCreadoPorBot(args: { clinicId: string; patientId: string }): Promise<void> {
  try {
    await registrarMovimientoExterno({
      actor: "bot",
      clinicId: args.clinicId,
      patientId: args.patientId,
      entityType: "patient",
      entityId: args.patientId,
      action: "create",
      texto: "Se creó el perfil del paciente desde WhatsApp",
    });
  } catch (e) {
    console.error("[bot/movimientos] paciente creado:", e);
  }
}
