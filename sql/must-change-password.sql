-- ═══════════════════════════════════════════════════════════════════════════
-- users.mustChangePassword — forzar cambio de contraseña temporal
--
-- Marca que la contraseña actual la GENERÓ el sistema (alta de miembro desde
-- Equipo, reset desde Equipo, o reset desde el admin de plataforma) y que el
-- usuario todavía no ha definido la suya. El layout de /dashboard lo obliga a
-- crear una propia antes de dejarlo usar el panel.
--
-- DEFAULT false ⇒ ningún usuario existente queda bloqueado al desplegar.
-- Idempotente: se puede correr varias veces sin efecto.
--
-- ⚠️ APLICAR ANTES de desplegar el código: el schema de Prisma declara la
-- columna, y sin ella TODA consulta a `users` truena (ver lección de schema
-- drift de ortodoncia).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
