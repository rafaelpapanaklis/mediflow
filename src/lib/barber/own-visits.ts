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
import type { BarberAppointmentStatus, BarberRole } from "@/lib/barber/types";
import { hasBarberPermission, type BarberPermissionKey } from "@/lib/barber/permissions";

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

// ═══════════════════════════════════════════════════════════════════════
// Lo que el rol Barbero VE: su agenda y sus clientes (G1, 14-nov-2026).
//
// Al darlo de alta, la pantalla de Equipo le promete al dueño «Ve lo suyo:
// su agenda, sus clientes y sus comisiones». Mismo criterio que avanzar sus
// visitas: «suyo» = lo del barbero LIGADO a su usuario (ownVisitsBarberId).
//
//  · Dueño, Encargado y Recepción → todo, como siempre.
//  · Barbero con su ficha ligada → solo lo suyo.
//  · Barbero SIN ficha ligada → nada (la pantalla le dice que pida al dueño
//    que lo ligue).
//  · Un permiso por persona más amplio se respeta, igual que en avanzar
//    visitas: con agenda.edit ve la agenda entera (quien puede crear y mover
//    citas de todos tiene que verlas) y con clients.edit, todos los clientes.
//
// Lo decide SIEMPRE el servidor con la sesión; nada de esto viene del
// navegador.
// ═══════════════════════════════════════════════════════════════════════

/** Lo que se le dice a un Barbero sin ficha ligada (agenda y clientes). */
export const BARBER_NOT_LINKED_MESSAGE =
  "Tu usuario no está ligado a tu ficha de barbero. Pídele al dueño que lo ligue desde Equipo para ver tu agenda y tus clientes.";

export type BarberViewScope =
  | { kind: "all" }
  | { kind: "own"; barberId: string }
  | { kind: "none" };

interface ScopeUser {
  role: BarberRole;
  permissionsOverride?: string[] | null;
  barberId: string | null | undefined;
}

function viewScope(user: ScopeUser, widerKey: BarberPermissionKey): BarberViewScope {
  if (user.role !== "BARBER") return { kind: "all" };
  if (hasBarberPermission(user, widerKey)) return { kind: "all" };
  const own = ownVisitsBarberId(user);
  return own ? { kind: "own", barberId: own } : { kind: "none" };
}

/** Qué parte de la agenda ve el usuario (columnas, visitas, totales). */
export function agendaViewScope(user: ScopeUser): BarberViewScope {
  return viewScope(user, "agenda.edit");
}

/** Qué clientes ve el usuario (lista, búsqueda, ficha, fotos, historial). */
export function clientsViewScope(user: ScopeUser): BarberViewScope {
  return viewScope(user, "clients.edit");
}

/** El alcance a partir del contexto de sesión (BarberContext o similar). */
export function scopeUserFromCtx(ctx: {
  role: BarberRole;
  user?: { permissionsOverride?: string[] | null } | null;
  barber?: { id: string } | null;
}): ScopeUser {
  return {
    role: ctx.role,
    permissionsOverride: ctx.user?.permissionsOverride ?? null,
    barberId: ctx.barber?.id ?? null,
  };
}

/** Recorte de visitas (`barber_appointments`) para un alcance. {} = sin recorte. */
export function scopeAppointmentsWhere(scope: BarberViewScope): { barberId?: string; id?: { in: string[] } } {
  if (scope.kind === "all") return {};
  if (scope.kind === "own") return { barberId: scope.barberId };
  return { id: { in: [] } };
}

/**
 * Recorte de clientes para un alcance; null = sin recorte. «Sus» clientes:
 * los que ATENDIÓ (un ticket suyo, también de la fila o del mostrador) o
 * tiene AGENDADOS con él (cualquier visita que no se canceló).
 */
export function scopeClientsWhere(scope: BarberViewScope): Record<string, unknown> | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "none") return { id: { in: [] } };
  return {
    OR: [
      { appointments: { some: { barberId: scope.barberId, status: { not: "CANCELLED" } } } },
      { sales: { some: { barberId: scope.barberId } } },
    ],
  };
}
