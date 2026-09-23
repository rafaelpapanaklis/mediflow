-- ws1-t1 · Interruptores de IA por clínica (clinics."aiSettings")
--
-- La clínica puede apagar, función por función, lo que gasta su Saldo IA o su
-- cupo de IA del plan (Sabina, la respuesta libre del bot, la redacción web,
-- el resumen semanal…). La lista y el saneador viven en
-- src/lib/ai-billing/interruptores.ts; se edita desde Saldo de IA.
--
-- Una sola columna Json, con el mismo patrón que clinics."reminderSettings".
-- Guarda lo APAGADO: { "apagadas": ["weekly_insights"] }. NULL = TODO
-- ENCENDIDO, que es lo que tienen hoy las clínicas: al aplicar esto ninguna
-- cambia de comportamiento.
--
-- 🔴 Pegar ANTES de integrar el código: Prisma lista las columnas del modelo
-- en cada consulta a clinics sin `select`, y sin la columna fallan.
--
-- Idempotente, sin DROP, sin backfill. Espejo en prisma/schema.prisma:
-- `aiSettings Json?` en Clinic. NO se aplica con prisma migrate: se pega a mano.

ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "aiSettings" JSONB;
