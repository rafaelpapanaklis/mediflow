-- Secciones del sidebar colapsadas por usuario.
-- Array de section ids ("clinico", "catalogo", "specialties", "admin") que el
-- usuario tiene colapsadas (oculta sus items, deja solo el título). Vacío =
-- todas expandidas. Persistente por cuenta → sobrevive logout/login y cualquier
-- dispositivo. Idempotente: si la columna ya existe, no falla.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "sidebarCollapsed" TEXT[] NOT NULL DEFAULT '{}';
