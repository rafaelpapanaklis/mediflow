-- ═══════════════════════════════════════════════════════════════════════
-- Afiliados — PÁGINA PERSONAL /socio/<slug> CON MODERACIÓN — 2026-08-16
--
-- Cada afiliado puede personalizar TRES cosas de su página pública:
--   1) su foto de perfil          → photoUrl
--   2) una presentación escrita   → bio
--   3) qué secciones se ven y en qué orden → sectionsConfig
--
-- Nada más: el hero, los colores y la tipografía NO se tocan. La estética de
-- dalecontrol.com es la misma para todos los socios.
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: solo ADD COLUMN IF NOT EXISTS sobre `affiliates`.
-- No borra ni modifica datos, y es seguro de re-correr. Espeja
-- prisma/schema.prisma (model Affiliate).
--
-- ── POR QUÉ DOS JUEGOS DE CAMPOS ──────────────────────────────────────
-- La página vive en dalecontrol.com y lo que diga se lee como dicho por
-- DaleControl, no por el socio. Por eso nada se publica sin que Rafael lo
-- apruebe.
--
--   photoUrl / bio / sectionsConfig                → LO PUBLICADO. Es lo
--     único que lee /socio/<slug>. Solo lo escribe la aprobación del admin.
--   photoUrlPending / bioPending / sectionsConfigPending → EL BORRADOR.
--     Lo escribe el afiliado desde su panel. Nadie del público lo ve.
--
-- La consecuencia es la que importa: mientras algo está en revisión —o si se
-- rechaza— la página pública sigue mostrando lo último APROBADO. Un socio no
-- puede tumbar su propia página metiendo un borrador a medias, y un texto en
-- revisión jamás llega a un visitante.
--
-- ── LOS CUATRO ESTADOS ────────────────────────────────────────────────
--   'draft'    — nunca ha enviado nada, o ya se le aprobó y volvió a editar.
--   'pending'  — enviado, esperando a Rafael. Público = lo aprobado antes.
--   'approved' — lo pendiente se copió a lo publicado y el borrador se limpió.
--   'rejected' — Rafael lo devolvió con motivo en pageRejectReason.
-- Los valores válidos los define el CÓDIGO (src/lib/affiliates/page-config.ts),
-- no un enum de Postgres — mismo criterio que affiliate_support_tickets.status.
--
-- ⚠️ APLICAR ESTE SQL **ANTES** DE DESPLEGAR EL CÓDIGO. getAffiliateContext()
-- carga el afiliado con `include: { affiliate: true }`, es decir SIN select:
-- Prisma pide TODAS las columnas del modelo. Si el schema las declara y la BD
-- no las tiene, el panel del afiliado revienta entero, no solo esta pantalla.
-- La página pública NO corre ese riesgo (usa select explícito), pero el panel
-- sí. Este archivo primero, el deploy después.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1) Lo PUBLICADO — lo único que lee /socio/<slug> ───────────────────
-- Los tres NULLABLE a propósito: null = "este socio no ha personalizado
-- nada", y su página se ve EXACTAMENTE como hoy. Los afiliados que no toquen
-- nada no se enteran de que esto existe.
ALTER TABLE "affiliates"
  -- URL pública de la foto (bucket clinic-public, prefijo affiliates/<id>/).
  ADD COLUMN IF NOT EXISTS "photoUrl"       text,
  -- Presentación del socio con su voz. TEXTO PLANO: se guarda tal cual y se
  -- pinta tal cual. El tope de longitud lo pone el código, no la columna: es
  -- una regla de producto que va a moverse, y un varchar(N) obligaría a un
  -- ALTER para cambiarla.
  ADD COLUMN IF NOT EXISTS "bio"            text,
  -- [{ "id": "features", "visible": true, "orden": 1 }, …]
  -- Solo describe QUÉ secciones se muestran y en qué orden; el contenido de
  -- cada sección sigue siendo el del home. Las secciones que llevan el CTA de
  -- registro no son apagables — eso lo impone el código, porque son las que
  -- sostienen la atribución del socio.
  ADD COLUMN IF NOT EXISTS "sectionsConfig" jsonb;

-- ── 2) El estado de la moderación ──────────────────────────────────────
-- NOT NULL DEFAULT 'draft': las filas que ya existen quedan en 'draft', que es
-- justo lo que son — nadie ha enviado nada todavía.
ALTER TABLE "affiliates"
  ADD COLUMN IF NOT EXISTS "pageStatus"       text NOT NULL DEFAULT 'draft',
  -- Motivo del rechazo, tal cual lo escribe Rafael. El afiliado LO VE: es lo
  -- que le dice qué corregir antes de reenviar.
  ADD COLUMN IF NOT EXISTS "pageRejectReason" text,
  ADD COLUMN IF NOT EXISTS "pageSubmittedAt"  timestamptz(6),
  ADD COLUMN IF NOT EXISTS "pageReviewedAt"   timestamptz(6);

-- ── 3) El BORRADOR — lo que espera revisión ────────────────────────────
-- Se llena al enviar a revisión y se limpia al aprobar (cuando su contenido ya
-- pasó a las columnas publicadas). En 'rejected' se CONSERVA: el socio tiene
-- que poder corregir lo que escribió, no volver a escribirlo desde cero.
ALTER TABLE "affiliates"
  ADD COLUMN IF NOT EXISTS "photoUrlPending"       text,
  ADD COLUMN IF NOT EXISTS "bioPending"            text,
  ADD COLUMN IF NOT EXISTS "sectionsConfigPending" jsonb;

-- ── 4) Índice de la cola de moderación ─────────────────────────────────
-- La cola del admin es `WHERE pageStatus = 'pending' ORDER BY pageSubmittedAt`.
-- El índice compuesto la resuelve entera sin escanear la tabla de afiliados.
CREATE INDEX IF NOT EXISTS "affiliates_pageStatus_pageSubmittedAt_idx"
  ON "affiliates" ("pageStatus", "pageSubmittedAt");

-- ── RLS ────────────────────────────────────────────────────────────────
-- No se toca: son columnas nuevas en una tabla que ya existe, y heredan la
-- política que `affiliates` tenga hoy. Prisma entra con el service role de
-- todos modos. Nada aquí abre una superficie nueva.

-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación
-- ═══════════════════════════════════════════════════════════════════════
-- Deben salir las 10 columnas:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'affiliates'
--    AND column_name IN ('photoUrl','bio','sectionsConfig','pageStatus',
--                        'pageRejectReason','pageSubmittedAt','pageReviewedAt',
--                        'photoUrlPending','bioPending','sectionsConfigPending')
--  ORDER BY column_name;
--
-- Todos los afiliados existentes deben quedar en 'draft':
-- SELECT "pageStatus", count(*) FROM "affiliates" GROUP BY 1;
--
-- El índice:
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'affiliates' AND indexname LIKE '%pageStatus%';
