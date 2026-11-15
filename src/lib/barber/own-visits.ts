// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — lo que el rol Barbero puede hacer con SUS visitas.
//
// Decisión de Rafael (14-nov-2026): un usuario con rol Barbero puede marcar
// «En silla» y «Completada» SOLO en sus propias visitas. Antes no podía en
// ninguna (avanzar el estado pedía agenda.edit, que el rol Barbero no trae),
// así que el barbero tenía que pedirle a recepción que le moviera cada cita.
//
// Lo que NO cambia:
//  · Confirmar, cancelar, marcar «no llegó», mover o editar una visita sigue
//    pidiendo agenda.edit.
//  · Las visitas de otro barbero (o sin barbero) no las toca.
//  · Cobrar sigue pidiendo el permiso de caja (cash.manage): «Completada» no
//    cobra nada.
//  · El flujo de estados es el de siempre (types.ts): «En silla» solo desde
//    Confirmada y «Completada» solo desde En silla.
//
// Puro (sin prisma ni "server-only"): lo usan la ruta de estado, la ruta que
// alimenta la agenda y el detalle de la visita en el navegador.
// ═══════════════════════════════════════════════════════════════════════
import type { BarberAppointmentStatus } from "@/lib/barber/types";

/** Estados a los que un Barbero puede llevar una visita SUYA. */
export const BARBER_OWN_VISIT_STATUSES: BarberAppointmentStatus[] = ["IN_PROGRESS", "DONE"];

export function isOwnVisitStatus(to: BarberAppointmentStatus): boolean {
  return BARBER_OWN_VISIT_STATUSES.includes(to);
}

/**
 * Id del barbero cuyas visitas puede avanzar este usuario «por ser suyas», o
 * null. Solo aplica al rol Barbero con su ficha de barbero ligada; quien ya
 * tiene agenda.edit no necesita esta puerta.
 */
export function ownVisitsBarberId(user: {
  role: string;
  barberId: string | null | undefined;
}): string | null {
  if (user.role !== "BARBER") return null;
  return typeof user.barberId === "string" && user.barberId ? user.barberId : null;
}

/**
 * ¿Este usuario puede pasar ESTA visita a `to` por ser su barbero?
 * (No mira el flujo de estados: eso lo decide canTransition, aparte.)
 */
export function canAdvanceOwnVisit(
  user: { role: string; barberId: string | null | undefined },
  appointment: { barberId: string | null | undefined },
  to: BarberAppointmentStatus,
): boolean {
  const own = ownVisitsBarberId(user);
  if (!own) return false;
  if (!appointment.barberId || appointment.barberId !== own) return false;
  return isOwnVisitStatus(to);
}
