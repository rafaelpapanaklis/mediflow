// ¿A quién se le enseña el botón «enviar recordatorio por WhatsApp»?
//
// `POST /api/whatsapp/send` no mira el permiso `whatsapp.send`: exige rol de
// administrador (`requireAdmin` → `ctx.isAdmin`, ver auth-context.ts). Mientras
// eso siga así, pintarle el botón a la recepción es regalarle un 403 («Solo
// administradores»). Esta función es el ESPEJO de esa regla para la UI: no da
// ni quita permisos, solo evita enseñar lo que el servidor va a rechazar.
//
// ⚠️ Si algún día la ruta pasa a `denyIfMissingPermission(ctx, "whatsapp.send")`
// (decisión de producto, no de este archivo), esto tiene que cambiar con ella;
// el test manual-reminder-access.test.ts se rompe a propósito si se separan.

export function canSendManualReminder(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
