import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";

/**
 * Espejo, para la UI, de la regla de las rutas de cambio «de administrador»
 * (ws1-t11 v3 y v5): `requireAdmin` (rol ADMIN o SUPER_ADMIN) Y, para el ADMIN,
 * la llave con el override por persona; el SUPER_ADMIN (el dueño) no se bloquea.
 * Es lo que hacen POST /api/cfdi/[id]/cancelar, /api/auth/2fa/clinic-policy,
 * PATCH /api/ai-wallet/funciones y POST /api/whatsapp/send. No da ni quita
 * permisos: solo evita enseñar un control que el servidor va a rechazar con 403.
 * Puro (sin Next ni Prisma): lo usan páginas server, rutas y pruebas.
 */
export function adminConPermiso(
  user: { role?: string | null; permissionsOverride?: string[] | null } | null | undefined,
  llave: PermissionKey,
): boolean {
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role !== "ADMIN") return false;
  return hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride ?? [] }, llave);
}
