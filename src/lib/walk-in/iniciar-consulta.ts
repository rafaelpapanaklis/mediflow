// «Iniciar» en la fila de walk-in CREA LA CITA DEL MOMENTO (ws1-t4, decisión 8 de Rafael, 2-oct-2026).
//
// «Asignar» solo marca quién atenderá. Al pulsar «Iniciar» la fila pasa a IN_PROGRESS y, en la MISMA transacción,
// nace la cita de hoy, ahora, con ese profesional y en estado IN_PROGRESS (en consulta): así queda en la Agenda,
// en el expediente y se puede cobrar. Sin avisos al paciente: la cita se escribe directo, sin recordatorios ni
// WhatsApp. Sin profesional asignado no se inicia: se pide elegir uno (`assignedTo_required`).
//
// Si la fila no trae paciente (el formulario de «Agregar a espera» solo recoge nombre y servicio) se da de alta
// uno con ese nombre. Si el profesional ya tiene otra cita encima, la restricción de no-solape de la base la
// rechaza y se contesta 409 SIN tocar la fila (la transacción se deshace): se elige otro profesional.
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { cuerpoDoctorNoRecibeCitasDe } from "@/lib/agenda/roles-que-atienden-db";
import { isAppointmentOverlapError } from "@/lib/agenda/transitions";
import { modoDeLaCita } from "@/lib/agenda/teleconsulta-por-categoria";
import { assertPatientVisible, ensureUserCanSeePatient } from "@/lib/patient-visibility";
import { nextPatientNumber, withPatientNumberRetry, PatientNumberExhaustedError } from "@/lib/patients/next-patient-number";
import { logMutation } from "@/lib/audit";

export const MINUTOS_POR_DEFECTO = 30;

export type EntradaFila = { id: string; patientId: string | null; patientName: string; service: string; assignedTo: string | null };
export type Actor = { userId: string; role: string; clinicId: string };

export type ResultadoIniciar =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

class FilaYaMovida extends Error {}

/** «Ana María López Ruiz» → nombre «Ana», apellido «María López Ruiz» (la fila solo guarda un texto libre). */
export function partirNombre(completo: string): { firstName: string; lastName: string } {
  const partes = completo.trim().split(/\s+/).filter(Boolean);
  return { firstName: partes[0] ?? "", lastName: partes.slice(1).join(" ") };
}

export async function iniciarConsultaWalkIn(args: {
  req: NextRequest;
  actor: Actor;
  entry: EntradaFila;
  assignedTo?: string | null;
}): Promise<ResultadoIniciar> {
  const { req, actor, entry } = args;
  const clinicId = actor.clinicId;
  const doctorId = (args.assignedTo || entry.assignedTo || "").trim();
  if (!doctorId) {
    return {
      ok: false,
      status: 400,
      body: { error: "assignedTo_required", reason: "Elige quién atenderá al paciente antes de iniciar la consulta." },
    };
  }

  // La misma regla única de «quién puede recibir citas» que la Agenda, con el tenant de la sesión.
  const profesional = await prisma.user.findFirst({
    where: { id: doctorId, clinicId, ...RECIBE_CITAS_WHERE },
    select: { id: true },
  });
  // Con el MOTIVO concreto (recepción, cuenta inactiva, casilla apagada…), como Citas y la lista de espera.
  if (!profesional) return { ok: false, status: 404, body: await cuerpoDoctorNoRecibeCitasDe(clinicId, doctorId) };

  if (entry.patientId) {
    const denegado = await assertPatientVisible(entry.patientId, actor);
    if (denegado) return { ok: false, status: denegado.status, body: await denegado.json() };
  }

  const clinica = await prisma.clinic.findFirst({
    where: { id: clinicId },
    select: { category: true, defaultSlotMinutes: true },
  });
  if (!clinica) return { ok: false, status: 401, body: { error: "Unauthorized" } };
  const minutos = clinica.defaultSlotMinutes && clinica.defaultSlotMinutes > 0 ? clinica.defaultSlotMinutes : MINUTOS_POR_DEFECTO;

  const ahora = new Date();
  const fin = new Date(ahora.getTime() + minutos * 60_000);
  let citaId = "";
  let pacienteId = entry.patientId;

  try {
    await withPatientNumberRetry(() =>
      prisma.$transaction(async (tx) => {
        // La transición se valida en la misma escritura: dos «Iniciar» a la vez crean UNA sola cita.
        const { count } = await tx.walkInQueue.updateMany({
          where: { id: entry.id, clinicId, status: { in: ["WAITING", "ASSIGNED"] } },
          data: { status: "IN_PROGRESS", startedAt: ahora, assignedTo: profesional.id },
        });
        if (count === 0) throw new FilaYaMovida();

        if (!pacienteId) {
          await tx.$executeRaw`SELECT 1 FROM clinics WHERE id = ${clinicId} FOR UPDATE`;
          const { firstName, lastName } = partirNombre(entry.patientName);
          const nuevo = await tx.patient.create({
            data: {
              clinicId,
              patientNumber: await nextPatientNumber(clinicId, tx),
              firstName,
              lastName,
              primaryDoctorId: profesional.id,
            },
            select: { id: true },
          });
          pacienteId = nuevo.id;
          await tx.walkInQueue.updateMany({ where: { id: entry.id, clinicId }, data: { patientId: nuevo.id } });
        }

        const cita = await tx.appointment.create({
          data: {
            clinicId,
            patientId: pacienteId,
            doctorId: profesional.id,
            startsAt: ahora,
            endsAt: fin,
            status: "IN_PROGRESS",
            checkedInAt: ahora,
            startedAt: ahora,
            type: entry.service || "Consulta general",
            mode: modoDeLaCita(clinica.category, false),
            source: "STAFF",
            requiresValidation: false,
          },
          select: { id: true },
        });
        citaId = cita.id;
        await ensureUserCanSeePatient(tx, pacienteId, profesional.id, clinicId);
      }),
    );
  } catch (err) {
    if (err instanceof FilaYaMovida) return { ok: false, status: 409, body: { error: "invalid_transition" } };
    if (isAppointmentOverlapError(err)) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "appointment_overlap",
          reason: "Ese profesional ya tiene una cita en este horario. Elige a otro profesional para iniciar la consulta.",
        },
      };
    }
    if (err instanceof PatientNumberExhaustedError) {
      return { ok: false, status: 409, body: { error: "patient_number_conflict", reason: err.message } };
    }
    throw err;
  }

  await ligarCitaALaFila(entry.id, clinicId, citaId);

  await logMutation({
    req,
    clinicId,
    userId: actor.userId,
    entityType: "appointment",
    entityId: citaId,
    action: "create",
    patientId: pacienteId,
    after: { patientId: pacienteId, doctorId: profesional.id, startsAt: ahora, status: "IN_PROGRESS", origen: "walk-in", walkInId: entry.id },
  });

  try {
    const { revalidateAfter } = await import("@/lib/cache/revalidate");
    revalidateAfter("appointments");
  } catch { /* fuera de Next (pruebas) no hay caché que invalidar */ }
  return { ok: true };
}

// La liga fila → cita vive en `walk_in_queue."appointmentId"` (sql/ws1-t4-walkin-cita.sql, la pega Rafael). El
// modelo de Prisma NO la declara a propósito: si declarara una columna que aún no existe, CADA lectura de la
// fila reventaría. Aquí es un UPDATE crudo, después de confirmar la transacción, y si la columna no está se
// sigue sin ella (una sola vez por proceso; sin bucles de error en los logs).
const g = globalThis as { __walkInSinLiga?: boolean };

async function ligarCitaALaFila(filaId: string, clinicId: string, citaId: string): Promise<void> {
  if (g.__walkInSinLiga) return;
  try {
    await prisma.$executeRaw`UPDATE walk_in_queue SET "appointmentId" = ${citaId} WHERE id = ${filaId} AND "clinicId" = ${clinicId}`;
  } catch {
    g.__walkInSinLiga = true;
  }
}
