-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — la cita «B» (ws6-t5, 15-nov-2026).
--
-- Dos columnas NUEVAS en barber_appointments, las dos opcionales:
--   · "cancelReason" — por qué se canceló la visita (máx. 200 caracteres;
--     el código recorta y valida). Se ve en el detalle de la cita y en el
--     historial del cliente.
--   · "arrivedAt"    — cuándo marcó la barbería «Ya llegó» (solo en citas
--     pendientes o confirmadas del día). Null = no ha llegado o se desmarcó.
--
-- ADITIVO: no toca ninguna fila ni ninguna columna existente.
-- El código funciona ANTES de pegarlo: cancelar sigue cancelando (sin guardar
-- el motivo) y «Ya llegó» responde que falta este archivo.
--
-- ⚠️ No se declaran todavía en prisma/schema.prisma a propósito: el cliente
-- Prisma las pediría en CADA lectura de citas y, en una base sin este SQL, la
-- agenda entera fallaría. El código las lee y escribe con SQL crudo. Cuando
-- este archivo esté pegado en todas las bases, se pueden declarar.
--
-- Plano e idempotente: se puede pegar dos veces. Supabase → SQL Editor.
-- Para deshacerlo:
--   ALTER TABLE "barber_appointments" DROP COLUMN IF EXISTS "cancelReason";
--   ALTER TABLE "barber_appointments" DROP COLUMN IF EXISTS "arrivedAt";
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "barber_appointments" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "barber_appointments" ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMP(3);
