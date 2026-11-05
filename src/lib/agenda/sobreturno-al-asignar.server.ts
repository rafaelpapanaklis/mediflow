/**
 * ws1-t11 · P1 v2 (M1/m1 de la revisión de t12) — al ASIGNARLE el doctor a una cita «Sin doctor»
 * (llegada, sillón, iniciar, terminar), ¿ese doctor ya tiene otra cita viva a esa hora?
 *
 *  · No: nada que hacer.
 *  · Sí, y ya lo está atendiendo (iniciar / terminar): la cita entra como sobreturno en el MISMO
 *    `updateMany` que el cambio de estado (`datos`), con rastro (`conCita` → Movimientos).
 *  · Sí, al marcar la llegada o el sillón: 409 `sobreagendable` con la otra cita, hasta que la
 *    pantalla confirme con esa cita (`sobreagendar: true, sobreagendarCita, sobreagendarOtras`;
 *    `confirmacionValida`). Sin la bandera de agenda flexible también: el paciente ya llegó.
 *
 * Se mira con `buscarChoqueDeCita` (TODAS las vivas del doctor, también las sobreagendadas que la
 * constraint no ve), así que sirve igual si la «Sin doctor» ya venía sobreagendada (m1).
 * Una forma sola (y no una unión por `ok`): con `strict: false` TypeScript no estrecha.
 */
import { prisma } from "@/lib/prisma";
import type { VisibilityViewer } from "@/lib/patient-visibility";
import { confirmacionValida } from "./agenda-flexible";
import { buscarChoqueDeCita, type ChoqueDeCita } from "./sobreagendar.server";
import { datosDeSobreturno, sobreturnoSinPreguntar, textoSobreturnoAlLlegar, type DatosDeSobreturno } from "./sin-doctor";

export interface RechazoSobreturno {
  error: "appointment_overlap";
  sobreagendable: true;
  conflictingAppointment: ChoqueDeCita;
  comida: null;
  reason: string;
}

export interface SobreturnoAlAsignar {
  /** Campos a escribir en la cita (vacío si no choca). */
  datos: DatosDeSobreturno;
  /** La otra cita del doctor (para Movimientos); null si no choca. */
  conCita: string | null;
  /** ≠ null: contestar 409 con esto y no escribir nada. */
  rechazo: RechazoSobreturno | null;
}

export async function sobreturnoAlAsignar(args: {
  clinicId: string;
  appointmentId: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  /** El `overrideReason` que la cita va a tener sin esto (el de la base, o el del adelanto a hoy). */
  overrideActual: string | null;
  destino: string;
  confirmacion: { sobreagendar?: unknown; sobreagendarCita?: unknown; sobreagendarOtras?: unknown };
  viewer: VisibilityViewer;
  userId: string;
  ahora: Date;
}): Promise<SobreturnoAlAsignar> {
  const nada: SobreturnoAlAsignar = { datos: {}, conCita: null, rechazo: null };
  if (!args.clinicId || !args.doctorId) return nada;
  const choque = await buscarChoqueDeCita({
    clinicId: args.clinicId,
    doctorId: args.doctorId,
    resourceId: null,
    startsAt: args.startsAt,
    endsAt: args.endsAt,
    excluirId: args.appointmentId,
    viewer: args.viewer,
    porDoctor: true,
  });
  if (!choque) return nada;
  const confirmado = confirmacionValida({
    sobreagendar: args.confirmacion.sobreagendar,
    sobreagendarCita: args.confirmacion.sobreagendarCita,
    choqueId: choque.id,
    otrasEnsenadas: args.confirmacion.sobreagendarOtras,
    otrasServidor: choque.otras,
  });
  if (!sobreturnoSinPreguntar(args.destino) && !confirmado) {
    const u = await prisma.user.findFirst({
      where: { id: args.doctorId, clinicId: args.clinicId },
      select: { firstName: true, lastName: true },
    });
    const nombre = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || null : null;
    return {
      datos: {},
      conCita: null,
      rechazo: {
        error: "appointment_overlap",
        sobreagendable: true,
        conflictingAppointment: choque,
        comida: null,
        reason: textoSobreturnoAlLlegar(nombre, choque.patientName, choque.otras),
      },
    };
  }
  return { datos: datosDeSobreturno(args.overrideActual, args.userId, args.ahora), conCita: choque.id, rechazo: null };
}
