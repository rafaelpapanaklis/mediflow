-- Per-user collapsed sidebar sections.
-- Array de section ids que el usuario tiene colapsadas en el sidebar
-- ("clinico", "catalogo", "specialties", "admin"). Vacío = todas expandidas.
ALTER TABLE "users" ADD COLUMN "sidebarCollapsed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
