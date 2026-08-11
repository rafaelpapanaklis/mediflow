-- ═══════════════════════════════════════════════════════════════════════
-- Landing v2 — editor por manifiesto + solicitudes de cita SIN cuenta
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- Este archivo habilita DOS cosas:
--
-- (A) Las columnas que consume el editor de Configuración que "se dibuja
--     solo" desde el manifiesto de cada plantilla: qué secciones se ven y en
--     qué orden, qué foto va en qué ranura, el bloque de urgencias y los
--     plazos de meses sin intereses.
--
-- (B) La tabla `booking_requests`: el paciente que reserva SIN cuenta no
--     genera una cita, genera una SOLICITUD. Razón: `appointments.patientId`
--     es OBLIGATORIO — sin expediente no puede existir una cita. La clínica
--     acepta la solicitud desde el panel y AHÍ se crea el Patient + el
--     Appointment. Una solicitud NO bloquea el hueco en la agenda.
--
-- ⚠️ ORDEN DE APLICACIÓN: este SQL va ANTES de que el código nuevo llegue a
-- producción. `prisma/schema.prisma` ya declara estas columnas, y un
-- findMany sobre `clinics` sin `select` pide TODAS las columnas del modelo:
-- si el código sube antes que el SQL, las lecturas de clínica revientan.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS,
-- FK y CHECK con guarda sobre pg_constraint, policy con guarda sobre
-- pg_policies. Re-ejecutable sin efectos colaterales.
-- ═══════════════════════════════════════════════════════════════════════

-- ── (A) Columnas del editor de landing ────────────────────────────────
--
-- landingSections: array JSON con el estado de cada sección de la plantilla
--   activa. Forma: [{ "id":"equipo", "visible":true, "orden":3,
--                     "titulo":"Nuestro equipo", "subtitulo":"..." }, …]
--   Las secciones obligatorias (contacto, reservar) se guardan igual pero el
--   editor no deja apagarlas ni moverlas.
--
-- landingPhotos: objeto JSON con la URL por RANURA declarada en el manifiesto
--   de la plantilla. Forma: { "portada":"https://…", "equipo":"https://…",
--                             "caso1_antes":"https://…" }
--   NO reemplaza a landingCoverUrl ni a landingGallery (siguen vivas para
--   `classic` y para el directorio): esto es el mapa por ranura con nombre.
--
-- landingUrgentText: texto libre del bloque de urgencias. NULL o '' = el
--   bloque no se pinta.
--
-- landingMsiPlazos: plazos de meses sin intereses ofrecidos, p.ej. {3,6,12}.
--   Array VACÍO = no se muestra nada de MSI. Nunca NULL.
--
-- La duración de cada servicio NO es columna: vive dentro del JSON de
-- `landingServices` como `durationMin` en cada elemento
-- ({ icon, name, desc, price, durationMin }), que ya es jsonb.

ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "landingSections"   JSONB;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "landingPhotos"     JSONB;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "landingUrgentText" TEXT;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "landingMsiPlazos"  INTEGER[] NOT NULL DEFAULT '{}';

-- ── (B) Solicitudes de cita sin cuenta ────────────────────────────────
--
-- doctorId NULL = "cualquier disponible": el paciente no eligió doctor y la
-- clínica resuelve uno al aceptar.
--
-- createdPatientId / createdAppointmentId se llenan al ACEPTAR la solicitud.
-- Son referencias SUELTAS a propósito (sin FK ni relación Prisma): el borrado
-- de un paciente se calcula desde el DMMF y una relación nueva lo bloquearía;
-- además una solicitud aceptada debe seguir siendo auditable aunque después
-- se borre la cita. El código tolera que apunten a algo que ya no existe.
--
-- status: 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'EXPIRADA'.
-- Las solicitudes cuya fecha ya pasó se marcan EXPIRADA — NUNCA se borran.

CREATE TABLE IF NOT EXISTS "booking_requests" (
    "id"                   TEXT NOT NULL,
    "clinicId"             TEXT NOT NULL,
    "doctorId"             TEXT,
    "requestedAt"          TIMESTAMPTZ(6) NOT NULL,
    "serviceName"          TEXT,
    "serviceDurationMin"   INTEGER,
    "patientName"          TEXT NOT NULL,
    "patientDob"           DATE,
    "patientWhatsapp"      TEXT NOT NULL,
    "notes"                TEXT,
    "status"               TEXT NOT NULL DEFAULT 'PENDIENTE',
    "rejectedReason"       TEXT,
    "createdPatientId"     TEXT,
    "createdAppointmentId" TEXT,
    "createdAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_requests_pkey" PRIMARY KEY ("id")
);

-- Bandeja del panel: pendientes de una clínica ordenadas por fecha pedida.
CREATE INDEX IF NOT EXISTS "booking_requests_clinicId_status_requestedAt_idx"
    ON "booking_requests"("clinicId", "status", "requestedAt");

-- Barrido de expiración (todas las clínicas, PENDIENTE con fecha ya pasada).
CREATE INDEX IF NOT EXISTS "booking_requests_status_requestedAt_idx"
    ON "booking_requests"("status", "requestedAt");

CREATE INDEX IF NOT EXISTS "booking_requests_doctorId_idx"
    ON "booking_requests"("doctorId");

-- ── FK a clinics (ADD CONSTRAINT no soporta IF NOT EXISTS → guarda) ────
DO $br$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_clinicId_fkey') THEN
    ALTER TABLE "booking_requests"
      ADD CONSTRAINT "booking_requests_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$br$;

-- ── CHECK del status (evita que un bug meta un valor fuera del set) ────
DO $br$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_status_check') THEN
    ALTER TABLE "booking_requests"
      ADD CONSTRAINT "booking_requests_status_check"
      CHECK ("status" IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'EXPIRADA'));
  END IF;
END
$br$;

-- ── RLS deny-all (defense-in-depth, igual que el resto de las tablas) ──
-- Todo el acceso es server-side vía Prisma + service role, que bypassa RLS.
-- Esta policy RESTRICTIVE cierra la puerta por PostgREST a anon/authenticated:
-- `booking_requests` guarda nombre, fecha de nacimiento y WhatsApp de personas
-- que NI SIQUIERA tienen cuenta — no puede quedar expuesta.
DO $br$
BEGIN
  EXECUTE 'ALTER TABLE "booking_requests" ENABLE ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'booking_requests'
      AND policyname = 'booking_requests_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "booking_requests_deny_anon" ON "booking_requests" '
         || 'AS RESTRICTIVE FOR ALL TO anon, authenticated '
         || 'USING (false) WITH CHECK (false)';
  END IF;
END
$br$;

-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'clinics'
--    AND column_name IN ('landingSections','landingPhotos','landingUrgentText','landingMsiPlazos');
--  → deben salir 4 filas (jsonb, jsonb, text, ARRAY)
--
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'booking_requests' ORDER BY ordinal_position;
--  → 16 columnas
--
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'booking_requests';
--  → booking_requests_deny_anon
