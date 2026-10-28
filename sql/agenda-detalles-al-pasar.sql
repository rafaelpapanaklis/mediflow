-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T2 · AGENDA: «MOSTRAR DETALLES AL PASAR EL MOUSE».
--
-- Al pasar el mouse sobre una cita de la Agenda nueva sale una tarjeta con
-- detalles (decisión de Rafael, 28-oct-2026). Viene ENCENDIDA; cada persona
-- la puede apagar en el botón de filtro de la agenda, y se guarda en su
-- cuenta (persiste entre computadoras). Esta es esa columna:
--
--   users."agendaDetallesAlPasar" — true = sale la tarjeta (por defecto).
--
-- Una persona tiene una fila "users" por clínica (mismo "supabaseId"): la
-- pantalla guarda el valor en todas sus filas.
--
-- IDEMPOTENTE: IF NOT EXISTS; correrlo dos veces no falla ni duplica.
-- ADITIVO: sin DROP, sin DELETE, sin UPDATE de datos. El DEFAULT true deja a
-- todos como ya están (con la tarjeta encendida).
-- NO toca prisma/schema.prisma ni usa Prisma Migrate: el código pregunta si
-- la columna existe (information_schema, recordado en globalThis). Mientras no
-- exista, la tarjeta sale para todos y el interruptor avisa que aún no guarda.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agendaDetallesAlPasar" BOOLEAN NOT NULL DEFAULT true;

-- Comprobación (solo lectura): debe salir una fila, boolean, default true.
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'agendaDetallesAlPasar';
