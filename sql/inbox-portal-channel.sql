-- WS2-T2 · Canal PORTAL para el chat in-app del portal del paciente.
-- El enum Prisma `InboxChannel` se mapea en Postgres al tipo "InboxChannel".
-- Idempotente: si el valor ya existe, no hace nada.
--
-- NOTA: `ALTER TYPE ... ADD VALUE` no puede correr dentro de una transacción en
-- algunas versiones de Postgres; ejecútalo SUELTO (el editor SQL de Supabase ya
-- lo hace así). Un valor nuevo del enum no puede usarse en la MISMA transacción
-- en que se agrega (aquí no aplica: solo lo agregamos).

ALTER TYPE "InboxChannel" ADD VALUE IF NOT EXISTS 'PORTAL';
