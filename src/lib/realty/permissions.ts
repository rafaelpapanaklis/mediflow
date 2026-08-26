/**
 * DaleControl INMUEBLES — permisos por rol. Módulo PURO y client-safe (sin
 * prisma, sin "server-only"): lo usan el sidebar (visibilidad de items),
 * las páginas y las APIs (vía assertRealtyPermission en realty-auth).
 *
 * REGLA (misma semántica que User.permissionsOverride del dental y que
 * BarberUser.permissionsOverride): si permissionsOverride tiene keys, esas
 * REEMPLAZAN el default del rol — no se suman. Un permiso NUEVO agregado a
 * un rol NO le llega a un usuario con override; hay que agregarlo a su
 * override también.
 *
 * Las olas siguientes NO inventan su propio check: usan hasRealtyPermission
 * / assertRealtyPermission. Punto único.
 *
 * OJO: el permiso da la PUERTA, no el ALCANCE. Un AGENT con leads.view ve
 * la pantalla de prospectos; que vea SOLO los suyos lo decide la consulta
 * de cada ola (filtrando por assignedUserId), no esta tabla.
 */
import type { RealtyRole } from "@/lib/realty/types";

export const REALTY_PERMISSIONS = [
  { key: "properties.view", label: "Ver la cartera de inmuebles" },
  { key: "properties.edit", label: "Crear y editar inmuebles" },
  { key: "leads.view", label: "Ver prospectos" },
  { key: "leads.edit", label: "Crear y editar prospectos" },
  // Repartir prospectos entre asesores. Un asesor puede editar los suyos
  // sin poder quitárselos a otro: por eso assign va aparte de leads.edit.
  { key: "leads.assign", label: "Asignar prospectos a un asesor" },
  { key: "visits.manage", label: "Agendar y registrar visitas" },
  // Quién tiene las llaves del inmueble y cuándo las devolvió.
  { key: "keys.manage", label: "Controlar las llaves" },
  { key: "leases.manage", label: "Administrar contratos de arrendamiento" },
  // Cargos, pagos y RECIBOS (este vertical no factura).
  { key: "payments.manage", label: "Registrar cobros y pagos" },
  { key: "maintenance.manage", label: "Atender mantenimientos" },
  { key: "expenses.manage", label: "Registrar gastos del inmueble" },
  { key: "deals.manage", label: "Administrar operaciones cerradas" },
  { key: "commissions.view", label: "Ver comisiones" },
  { key: "commissions.manage", label: "Repartir y marcar comisiones pagadas" },
  { key: "web.edit", label: "Editar la web pública" },
  { key: "whatsapp.view", label: "Ver WhatsApp" },
  { key: "whatsapp.send", label: "Enviar WhatsApp" },
  { key: "portals.manage", label: "Administrar portales y el feed" },
  { key: "support.view", label: "Ver tickets de soporte" },
  { key: "support.manage", label: "Abrir y responder tickets de soporte" },
  { key: "billing.manage", label: "Suscripción y pagos DaleControl" },
  { key: "settings.edit", label: "Configuración de la cuenta" },
  { key: "team.manage", label: "Administrar el equipo" },
  // Crear/editar oficinas y otorgar accesos (RealtyUserOfficeAccess). El
  // CAMBIO de oficina no es permiso: lo resuelve getAccessibleOfficeIds().
  { key: "offices.manage", label: "Administrar oficinas" },
  { key: "calculators.use", label: "Usar las calculadoras" },
  // Cumplimiento antilavado (LFPIORPI). Es trabajo de oficial de
  // cumplimiento, no del asesor de piso: por eso NO entra en los defaults
  // de AGENT ni de ASSISTANT. OWNER y MANAGER lo absorben solos vía ALL.
  //
  // 🔴 Un permiso NUEVO no le llega a quien ya tiene permissionsOverride
  // (el override REEMPLAZA, no se suma). El backfill para las cuentas que
  // ya existen va en sql/realty-pld.sql, y sin él un dueño con excepciones
  // tampoco puede REPARTIR la clave (ver PERMISSION_OUT_OF_REACH en
  // src/lib/realty/team.ts).
  { key: "pld.view", label: "Ver el tablero de cumplimiento antilavado" },
  { key: "pld.manage", label: "Integrar expedientes y marcar avisos presentados" },
  // La libreta de DUEÑOS de los inmuebles en cartera + sus exclusivas.
  { key: "owners.manage", label: "Administrar propietarios y exclusivas" },
] as const;

export type RealtyPermissionKey = (typeof REALTY_PERMISSIONS)[number]["key"];

export const REALTY_PERMISSION_KEYS: RealtyPermissionKey[] = REALTY_PERMISSIONS.map(
  (p) => p.key,
);

const ALL: RealtyPermissionKey[] = [...REALTY_PERMISSION_KEYS];

/**
 * Defaults por rol. OWNER todo; MANAGER todo menos billing (suscripción) —
 * ambos absorben claves nuevas solos vía ALL. AGENT trabaja su cartera y su
 * embudo: ve y edita inmuebles y prospectos, agenda visitas, mueve llaves y
 * VE sus comisiones, pero no reparte prospectos ajenos ni toca dinero de
 * rentas. ASSISTANT es la mesa de control: mira, agenda y registra cobros,
 * sin poder cambiar precios ni el reparto de comisiones.
 */
export const REALTY_ROLE_DEFAULT_PERMISSIONS: Record<RealtyRole, RealtyPermissionKey[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((k) => k !== "billing.manage"),
  AGENT: [
    "properties.view",
    "properties.edit",
    "leads.view",
    "leads.edit",
    "visits.manage",
    "keys.manage",
    "commissions.view",
    "whatsapp.view",
    "whatsapp.send",
    "calculators.use",
    "owners.manage",
    "support.view",
  ],
  ASSISTANT: [
    "properties.view",
    "leads.view",
    "leads.edit",
    "visits.manage",
    "keys.manage",
    "leases.manage",
    "payments.manage",
    "maintenance.manage",
    "whatsapp.view",
    "whatsapp.send",
    "calculators.use",
    "support.view",
  ],
};

/**
 * Set efectivo de permisos: override REEMPLAZA al default del rol si trae
 * keys (mismo contrato que el dental y que barber). Keys desconocidas se
 * ignoran.
 */
export function resolveRealtyPermissions(
  role: RealtyRole,
  permissionsOverride?: string[] | null,
): Set<RealtyPermissionKey> {
  const override = (permissionsOverride ?? []).filter((k): k is RealtyPermissionKey =>
    (REALTY_PERMISSION_KEYS as string[]).includes(k),
  );
  if (override.length > 0) return new Set(override);
  return new Set(REALTY_ROLE_DEFAULT_PERMISSIONS[role] ?? []);
}

/** ¿El usuario (rol + override) tiene el permiso? */
export function hasRealtyPermission(
  user: { role: RealtyRole; permissionsOverride?: string[] | null },
  key: RealtyPermissionKey,
): boolean {
  return resolveRealtyPermissions(user.role, user.permissionsOverride).has(key);
}

/** Error tipado que lanzan los asserts; las APIs lo mapean a 403. */
export class RealtyForbiddenError extends Error {
  readonly permission: RealtyPermissionKey;
  constructor(permission: RealtyPermissionKey) {
    super(`Permiso requerido: ${permission}`);
    this.name = "RealtyForbiddenError";
    this.permission = permission;
  }
}
