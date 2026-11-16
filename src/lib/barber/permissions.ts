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
  // Bloqueos sin horario (L3 ronda 2, decisión del gerente 15-nov): Recepción
  // bloquea al barbero que se enfermó; el Barbero pone y quita SOLO los suyos
  // (comida, permiso). Ninguno de los dos toca el horario recurrente.
  { key: "timeoff.manage", label: "Poner y quitar bloqueos de cualquiera" },
  { key: "timeoff.own", label: "Poner y quitar sus propios bloqueos" },
  { key: "walkin.manage", label: "Operar la fila virtual" },
  { key: "requests.manage", label: "Atender solicitudes de reserva" },
  { key: "cash.view", label: "Ver caja" },
  { key: "cash.manage", label: "Cobrar y hacer cortes" },
  { key: "commissions.view", label: "Ver comisiones" },
  { key: "commissions.manage", label: "Administrar comisiones" },
  // Vender ≠ administrar (decisión #13 de Rafael, 15-nov: «que la Recepción
  // sí pueda vender membresías, productos, etc.»). Vender = vender y renovar
  // en mostrador, con los planes que ya existen. Administrar = crear, editar,
  // precios, archivar, y pausar/cancelar lo vendido. Administrar INCLUYE
  // vender (BARBER_PERMISSION_IMPLIES): nadie que ya administraba pierde nada.
  { key: "memberships.sell", label: "Vender y renovar membresías" },
  { key: "memberships.manage", label: "Administrar planes de membresía" },
  // Ver el catálogo y sus existencias (sin costo ni margen). La venta en Caja
  // sigue colgando de cash.manage.
  { key: "products.view", label: "Ver productos y existencias" },
  { key: "products.manage", label: "Administrar productos (catálogo, precio y costo)" },
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
 * el mostrador (agenda, clientes + portal, fila, caja, WhatsApp) y VENDE
 * (membresías, anticipos, productos, lealtad), sin administrar. BARBER ve
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
    // Recepción vende (decisión #13, 15-nov): membresías (vender y renovar),
    // anticipos y productos en Caja (cash.manage), premios de lealtad al
    // cobrar (cash.manage), y ve las existencias. NO administra planes,
    // precios, catálogo, costos, comisiones, configuración, equipo ni
    // suscripción.
    "memberships.sell",
    "products.view",
    "whatsapp.view",
    "whatsapp.send",
    // Bloqueos sí, horarios no (L3 ronda 2).
    "timeoff.manage",
  ],
  BARBER: ["agenda.view", "clients.view", "walkin.manage", "commissions.view", "timeoff.own"],
};

/**
 * Permisos que vienen INCLUIDOS en otro: quien administra, también vende y
 * ve. Se aplica sobre el set final (rol u override), así que una persona a
 * la que hoy le dieron «Administrar membresías» a mano sigue pudiendo
 * vender sin tocar su ficha. No funciona al revés: vender no da administrar.
 */
export const BARBER_PERMISSION_IMPLIES: Partial<Record<BarberPermissionKey, BarberPermissionKey[]>> = {
  "memberships.manage": ["memberships.sell"],
  "products.manage": ["products.view"],
  "schedule.manage": ["timeoff.manage", "timeoff.own"],
  "timeoff.manage": ["timeoff.own"],
};

/**
 * Qué bloqueos puede poner y quitar esta persona (L3 ronda 2):
 * - "all": de cualquier barbero y de toda la barbería (día festivo);
 * - { barberId }: solo los de SU ficha (rol Barbero ligado);
 * - null: ninguno (solo mira).
 * Sin ficha ligada, timeoff.own no da nada: no hay «suyos».
 */
export type BarberTimeOffScope = "all" | { barberId: string } | null;

export function timeOffScope(user: {
  role: BarberRole;
  permissionsOverride?: string[] | null;
  ownBarberId: string | null;
}): BarberTimeOffScope {
  const set = resolveBarberPermissions(user.role, user.permissionsOverride);
  if (set.has("timeoff.manage")) return "all";
  if (set.has("timeoff.own") && user.ownBarberId) return { barberId: user.ownBarberId };
  return null;
}

/** ¿Este alcance permite tocar un bloqueo de este barbero (null = toda la barbería)? */
export function timeOffAllowed(scope: BarberTimeOffScope, barberId: string | null): boolean {
  if (scope === "all") return true;
  if (!scope) return false;
  return barberId !== null && barberId === scope.barberId;
}

/**
 * Set efectivo de permisos: override REEMPLAZA al default del rol si trae
 * keys (mismo contrato que el dental). Keys desconocidas se ignoran. Al
 * final se suman los permisos incluidos (BARBER_PERMISSION_IMPLIES).
 */
export function resolveBarberPermissions(
  role: BarberRole,
  permissionsOverride?: string[] | null,
): Set<BarberPermissionKey> {
  const override = (permissionsOverride ?? []).filter((k): k is BarberPermissionKey =>
    (BARBER_PERMISSION_KEYS as string[]).includes(k),
  );
  const set = new Set<BarberPermissionKey>(
    override.length > 0 ? override : BARBER_ROLE_DEFAULT_PERMISSIONS[role] ?? [],
  );
  for (const [key, implied] of Object.entries(BARBER_PERMISSION_IMPLIES)) {
    if (set.has(key as BarberPermissionKey)) for (const k of implied ?? []) set.add(k);
  }
  return set;
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
