-- Dedupe de clics de afiliado por NAVEGADOR en vez de por IP.
--
-- La cookie dc_vid (src/lib/affiliates/visitor-cookie.ts) trae un id aleatorio
-- opaco por navegador; esta columna lo guarda en la fila del clic para poder
-- deduplicar contra él. Sin ella, el dedupe iba por IP y con CGNAT móvil
-- (Telcel, AT&T) miles de teléfonos comparten IP pública: dos dentistas con
-- dos teléfonos contaban como UN clic.
--
-- Nullable a propósito: las filas históricas no lo tienen, y el código
-- reintenta el insert sin `vid` si esta columna aún no existe (degrada al
-- respaldo corto por IP, nunca a cero clics).
--
-- No necesita índice propio: las consultas del guard filtran por `ref` +
-- `createdAt` (índice affiliate_clicks_ref_createdAt_idx, ya existente) con
-- ventanas de 2 y 30 minutos, y `vid` solo afina un puñado de filas.
--
-- Idempotente: si la columna ya existe, no falla.

ALTER TABLE "affiliate_clicks"
  ADD COLUMN IF NOT EXISTS "vid" TEXT;
