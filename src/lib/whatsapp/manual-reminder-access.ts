// ¿A quién se le enseña el botón «enviar recordatorio por WhatsApp»?
//
// `POST /api/whatsapp/send` exige rol de administrador (`requireAdmin` →
// `ctx.isAdmin`, ver auth-context.ts) Y, desde ws1-t11 v3, el permiso
// `whatsapp.send` con el override por persona (el SUPER_ADMIN no se bloquea).
// Pintarle el botón a quien no cumple las dos es regalarle un 403. Esta función
// es el ESPEJO de esa regla para la UI: no da ni quita permisos, solo evita
// enseñar lo que el servidor va a rechazar.
//
// ⚠️ Si la ruta cambia, esto tiene que cambiar con ella; el test
// manual-reminder-access.test.ts se rompe a propósito si se separan.
import { adminConPermiso } from "@/lib/auth/admin-con-permiso";

export function canSendManualReminder(
  role: string | null | undefined,
  permissionsOverride?: string[] | null,
): boolean {
  return adminConPermiso({ role, permissionsOverride }, "whatsapp.send");
}
