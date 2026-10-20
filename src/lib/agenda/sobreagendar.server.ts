/**
 * SOBREAGENDAR (WS1-T5 · grupo Salamanca) — lo que las rutas de citas del
 * equipo (POST y PATCH /api/appointments) preguntan a la base antes de
 * guardar, cuando la clínica tiene la bandera `agenda-flexible`.
 *
 * Por qué no basta con esperar al 23P01 de la constraint: la constraint NO VE
 * las citas con `overrideReason`, y una sobreagendada lo lleva. Si la cita
 * original se cancela, la sobreagendada queda sola a esa hora y una tercera
 * entraría sin que nadie avisara. Aquí se cuentan TODAS las citas vivas.
 */
import { prisma } from "@/lib/prisma";
import { sinApartadoVencido } from "./apartado";
import { MARCA_SOBREAGENDADA } from "./agenda-flexible";
import { canSeePatient, type VisibilityViewer } from "@/lib/patient-visibility";
import type { AppointmentStatus } from "./types";

export interface ChoqueDeCita {
  id: string;
  patientName: string;
  startsAt: string;
  endsAt: string;
  doctorId: string;
  resourceId: string | null;
  status: AppointmentStatus;
  /** Cuántas citas MÁS pisan el hueco además de ésta (el aviso lo dice). */
  otras: number;
}

/**
 * La primera cita viva del mismo doctor (o del mismo sillón) que pisa
 * `[startsAt, endsAt)`, también si está sobreagendada o forzada. `null` = libre.
 * El nombre del paciente se tapa si quien pregunta no puede verlo, igual que
 * en el 409 de siempre.
 */
export async function buscarChoqueDeCita(args: {
  clinicId: string;
  doctorId: string;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
  excluirId?: string;
  viewer?: VisibilityViewer | null;
  /**
   * Solo las SOBREAGENDADAS. Para las clínicas que ya no tienen la bandera:
   * la constraint sigue parando el choque con una cita normal, pero no ve una
   * sobreagendada que se quedó sola (se canceló la original, o se apagó la
   * bandera con citas así en la agenda). Esto la ve.
   */
  soloMarcadas?: boolean;
  /**
   * `false` = solo por sillón. Para cambiar SOLO el sillón de una cita que no
   * se mueve: con su doctor ya estaba (y ya se confirmó en su día).
   */
  porDoctor?: boolean;
}): Promise<ChoqueDeCita | null> {
  // Corta ANTES de consultar: un clinicId vacío no filtra nada en Prisma.
  if (!args.clinicId) return null;
  const candidatas = await prisma.appointment.findMany({
    where: {
      clinicId: args.clinicId,
      OR: [
        ...(args.porDoctor === false ? [] : [{ doctorId: args.doctorId }]),
        ...(args.resourceId ? [{ resourceId: args.resourceId }] : []),
      ],
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { lt: args.endsAt },
      endsAt: { gt: args.startsAt },
      ...(args.excluirId ? { id: { not: args.excluirId } } : {}),
      ...(args.soloMarcadas ? { overrideReason: { startsWith: MARCA_SOBREAGENDADA } } : {}),
      AND: [sinApartadoVencido()],
    },
    include: { patient: { select: { firstName: true, lastName: true, visibleUserIds: true } } },
    // Orden ESTABLE (revisión t8, A7): con dos a la misma hora, la pantalla y
    // el servidor nombran la misma.
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    // Hasta 6: la primera se enseña con nombre y hora, el resto se cuenta.
    take: 6,
  });
  const a = candidatas[0];
  if (!a) return null;
  const visible =
    !args.viewer ||
    canSeePatient(args.viewer, (a.patient as { visibleUserIds?: string[] }).visibleUserIds);
  const nombre = visible ? [a.patient.firstName, a.patient.lastName].filter(Boolean).join(" ").trim() : "Paciente privado";
  return {
    id: a.id,
    patientName: nombre || "—",
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    doctorId: a.doctorId,
    resourceId: a.resourceId,
    status: a.status as AppointmentStatus,
    otras: candidatas.length - 1,
  };
}

/**
 * Una cita que SE MUEVE por una puerta que no sabe de sobreagendar (el
 * portal, aprobar un cambio del portal) pierde la marca: en su hueco nuevo
 * es una cita normal y la constraint tiene que volver a verla. Va DENTRO de
 * la transacción que la mueve. Sin la marca no toca nada.
 */
export async function quitarMarcaDeSobreagenda(
  tx: { appointment: { updateMany(args: any): Promise<unknown> } },
  citaId: string,
  clinicId: string,
): Promise<void> {
  if (!clinicId || !citaId) return;
  await tx.appointment.updateMany({
    where: { id: citaId, clinicId, overrideReason: { startsWith: MARCA_SOBREAGENDADA } },
    data: { overrideReason: null, overriddenBy: null, overriddenAt: null },
  });
}
