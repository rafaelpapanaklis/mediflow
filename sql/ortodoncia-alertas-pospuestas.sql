-- ============================================================================
-- Ortodoncia — «Posponer 7 días» en Alertas (fila 22 de la revisión de uso,
-- ws1-t4 ronda 6).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- PARA QUÉ: una lista de alertas que solo crece se deja de mirar. Cada fila
-- de «Sin próximo control», «No asistió», «Próximo a terminar» y «Pasado de
-- su fecha» se puede posponer 7 días; aquí se guarda hasta cuándo.
--
-- TABLA NUEVA y SIN modelo en prisma/schema.prisma: el código usa SQL crudo y
-- tolera que la tabla no exista. Sin este SQL, Alertas se ve igual que hoy y
-- «Posponer 7 días» responde «todavía no está disponible»; nada se cae.
--
-- ORDEN: se puede pegar antes o después de integrar.
--
-- Plano e idempotente: se puede pegar dos veces. Sin DO $$, sin migraciones.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ortho_alert_snoozes" (
  "clinicId"  text        NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "patientId" text        NOT NULL REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- 'sin-proximo-control' | 'no-asistio' | 'proximo-a-terminar' | 'pasado-de-fecha'
  "tipo"      text        NOT NULL,
  -- La alerta vuelve a salir a partir de este momento.
  "hasta"     timestamptz NOT NULL,
  -- Quién la pospuso (users.id). Sin FK: si se borra el usuario, la fila sigue valiendo.
  "userId"    text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("clinicId", "patientId", "tipo")
);

ALTER TABLE "ortho_alert_snoozes" DROP CONSTRAINT IF EXISTS "ortho_alert_snoozes_tipo_check";
ALTER TABLE "ortho_alert_snoozes" ADD CONSTRAINT "ortho_alert_snoozes_tipo_check"
  CHECK ("tipo" IN ('sin-proximo-control', 'no-asistio', 'proximo-a-terminar', 'pasado-de-fecha'));

-- Alertas lee solo las vigentes de una clínica.
CREATE INDEX IF NOT EXISTS "ortho_alert_snoozes_clinic_hasta_idx"
  ON "ortho_alert_snoozes" ("clinicId", "hasta");

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
ALTER TABLE "ortho_alert_snoozes" ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT s."tipo", p."firstName", p."lastName", s."hasta", s."createdAt"
-- FROM "ortho_alert_snoozes" s JOIN "patients" p ON p."id" = s."patientId"
-- WHERE s."hasta" > now() ORDER BY s."hasta" LIMIT 50;
