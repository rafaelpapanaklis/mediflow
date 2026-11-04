/**
 * Quién firma la bitácora de los cobros que no hace un usuario del equipo (seguridad admin-auth, revisión ws1-t8:
 * hermano 2 y m4). `audit_logs."userId"` tiene FK a `users`, así que estas filas van por `logAuditExterno` como
 * actor externo ("public") con uno de estos nombres en `changes._mov.after.actor`.
 */
export const ORIGEN_STRIPE_WEBHOOK = "Stripe (webhook)";
/** El cron diario que reintenta las reglas de cobro de tarjeta que quedaron a medias. */
export const ORIGEN_REINTENTO_CRON = "Reintento automático (cron)";
/** El botón «Reintentar» de /admin › Pagos (lo que hizo el admin queda además en su propia bitácora). */
export const ORIGEN_REINTENTO_ADMIN = "Reintento desde /admin › Pagos";
