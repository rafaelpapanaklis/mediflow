/**
 * DaleControl BARBER — permisos por rol. Módulo PURO y client-safe (sin
 * prisma, sin "server-only"): lo usan el sidebar (visibilidad de items),
 * las páginas y las APIs (vía assertBarberPermission en barber-auth).
 *
 * REGLA (misma semántica que User.permissionsOverride del dental): si
 * permissionsOverride tiene keys, esas REEMPLAZAN el default del rol — no se
 * suman. Un permiso NUEVO agregado a un rol NO le llega a un usuario con
 * override; hay que agregarlo a su override también.
 *
 * Las otras olas NO inventan su propio check: usan hasBarberPermission /
 * assertBarberPermission. Punto único.
 */
import type { BarberRole } from "@/lib/barber/types";

export const BARBER_PERMISSIONS = [
  { key: "agenda.view", label: "Ver agenda" },
  { key: "agenda.edit", label: "Crear y editar citas" },
  { key: "clients.view", label: "Ver clientes" },
  { key: "clients.edit", label: "Crear y editar clientes" },
  // Habilitar/deshabilitar el portal, reenviar códigos y marcar fotos
  // visibles al cliente. Las fotos de visita en sí van con clients.view/edit.
  { key: "portal.manage", label: "Administrar el portal del cliente" },
  { key: "services.manage", label: "Administrar servicios" },
  { key: "barbers.manage", label: "Administrar barberos" },
  // Horario recurrente (BarberSchedule) y bloqueos (BarberTimeOff).
  { key: "schedule.manage", label: "Administrar horarios y bloqueos" },
  { key: "walkin.manage", label: "Operar la fila virtual" },
  { key: "requests.manage", label: "Atender solicitudes de reserva" },
  { key: "cash.view", label: "Ver caja" },
  { key: "cash.manage", label: "Cobrar y hacer cortes" },
  { key: "commissions.view", label: "Ver comisiones" },
  { key: "commissions.manage", label: "Administrar comisiones" },
  { key: "memberships.manage", label: "Administrar membresías" },
  { key: "products.manage", label: "Administrar productos" },
  // Entradas/ajustes/devoluciones manuales (BarberStockMovement). La venta
  // descuenta stock sola bajo cash.manage — NO exige esta clave.
  { key: "inventory.manage", label: "Registrar movimientos de inventario" },
  { key: "web.edit", label: "Editar la mini-web" },
  { key: "whatsapp.view", label: "Ver WhatsApp" },
  { key: "whatsapp.send", label: "Enviar WhatsApp" },
  { key: "support.view", label: "Ver tickets de soporte" },
  { key: "support.manage", label: "Abrir y responder tickets de soporte" },
  { key: "billing.manage", label: "Suscripción y pagos DaleControl" },
  { key: "settings.edit", label: "Configuración de la barbería" },
  { key: "team.manage", label: "Administrar el equipo" },
  // Crear/editar sedes y otorgar accesos (BarberUserBranchAccess). El
  // CAMBIO de sede no es permiso: lo resuelve getAccessibleBranchIds().
  { key: "branches.manage", label: "Administrar sucursales" },
] as const;

export type BarberPermissionKey = (typeof BARBER_PERMISSIONS)[number]["key"];

export const BARBER_PERMISSION_KEYS: BarberPermissionKey[] = BARBER_PERMISSIONS.map(
  (p) => p.key,
);

const ALL: BarberPermissionKey[] = [...BARBER_PERMISSION_KEYS];

/**
 * Defaults por rol. OWNER todo; MANAGER todo menos billing (suscripción y
 * facturación) — ambos absorben claves nuevas solos vía ALL. RECEPTION opera
 * el mostrador (agenda, clientes + portal, fila, caja, WhatsApp). BARBER ve
 * SOLO lo suyo: la ola de cada área recorta ADEMÁS por su barberId (su
 * agenda, sus clientes, sus comisiones) — el permiso da la puerta, no el
 * alcance.
 */
export const BARBER_ROLE_DEFAULT_PERMISSIONS: Record<BarberRole, BarberPermissionKey[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((k) => k !== "billing.manage"),
  RECEPTION: [
    "agenda.view",
    "agenda.edit",
    "clients.view",
    "clients.edit",
    "portal.manage",
    "walkin.manage",
    "requests.manage",
    "cash.view",
    "cash.manage",
    "whatsapp.view",
    "whatsapp.send",
  ],
  BARBER: ["agenda.view", "clients.view", "walkin.manage", "commissions.view"],
};

/**
 * Set efectivo de permisos: override REEMPLAZA al default del rol si trae
 * keys (mismo contrato que el dental). Keys desconocidas se ignoran.
 */
export function resolveBarberPermissions(
  role: BarberRole,
  permissionsOverride?: string[] | null,
): Set<BarberPermissionKey> {
  const override = (permissionsOverride ?? []).filter((k): k is BarberPermissionKey =>
    (BARBER_PERMISSION_KEYS as string[]).includes(k),
  );
  if (override.length > 0) return new Set(override);
  return new Set(BARBER_ROLE_DEFAULT_PERMISSIONS[role] ?? []);
}

/** ¿El usuario (rol + override) tiene el permiso? */
export function hasBarberPermission(
  user: { role: BarberRole; permissionsOverride?: string[] | null },
  key: BarberPermissionKey,
): boolean {
  return resolveBarberPermissions(user.role, user.permissionsOverride).has(key);
}

/** Error tipado que lanzan los asserts; las APIs lo mapean a 403. */
export class BarberForbiddenError extends Error {
  readonly permission: BarberPermissionKey;
  constructor(permission: BarberPermissionKey) {
    super(`Permiso requerido: ${permission}`);
    this.name = "BarberForbiddenError";
    this.permission = permission;
  }
}
