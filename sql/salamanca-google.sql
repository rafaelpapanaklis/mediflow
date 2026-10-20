-- ═══════════════════════════════════════════════════════════════════════
-- WS1-T9 · Google Calendar → agenda de DaleControl (grupo Salamanca)
--
-- QUÉ HACE (solo ADITIVO: nada se borra, nada se renombra, ningún tipo cambia):
--   1. Añade el valor 'GOOGLE' al enum "AgendaBlockKind": un evento del
--      calendario de la clínica en Google se guarda como un bloqueo de agenda
--      de ese tipo, y así lo respetan la rejilla, el bot, la web, Sabina y
--      «Buscar espacio» sin tocar sus motores.
--   2. Crea google_agenda_imports: UNA fila por clínica con LA BANDERA
--      ("enabled", apagada de fábrica) y el estado de la sincronización
--      (syncToken, canal de avisos de Google, turno, último error).
--   3. Crea agenda_block_google: el vínculo de cada bloqueo GOOGLE con su
--      evento (id del evento y del calendario, título, hora vista en Google,
--      «convertido en cita» y el aviso de la cita si el evento cambió).
--
-- Sin filas en google_agenda_imports NINGUNA clínica cambia de comportamiento.
-- Para encender a Salamanca: sql/salamanca-encender-google.sql (aparte).
--
-- Idempotente: se puede pegar dos veces. Se aplica A MANO en Supabase.
-- ⛔ NUNCA prisma migrate / db push.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. El tipo nuevo de bloqueo ────────────────────────────────────────
-- El SQL Editor de Supabase corre el archivo ENTERO en una sola transacción,
-- y Postgres no deja USAR un valor de enum en la misma transacción que lo
-- añade («unsafe use of new value»). Por eso NADA de este archivo usa 'GOOGLE'
-- después de añadirlo (ni un cast, ni un enum_range): la comprobación del
-- final lee pg_enum. (Revisión t8, G2: la versión anterior fallaba entera.)
ALTER TYPE "AgendaBlockKind" ADD VALUE IF NOT EXISTS 'GOOGLE';


-- ── 2. La bandera y el estado por clínica ──────────────────────────────
CREATE TABLE IF NOT EXISTS google_agenda_imports (
  "clinicId"          TEXT PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  -- LA BANDERA. false = la clínica funciona como siempre.
  "enabled"           BOOLEAN NOT NULL DEFAULT false,
  "calendarId"        TEXT,
  "syncToken"         TEXT,
  "lastSyncAt"        TIMESTAMPTZ(3),
  "lastFullSyncAt"    TIMESTAMPTZ(3),
  "leaseUntil"        TIMESTAMPTZ(3),
  "dirtyAt"           TIMESTAMPTZ(3),
  "channelId"         TEXT,
  "channelResourceId" TEXT,
  "channelToken"      TEXT,
  "channelExpiresAt"  TIMESTAMPTZ(3),
  "channelCalendarId" TEXT,
  "lastError"         VARCHAR(200),
  "lastErrorAt"       TIMESTAMPTZ(3),
  -- El último fallo al crear/renovar el canal de avisos (no lo pisa la sincronización).
  "channelError"      VARCHAR(200),
  "channelErrorAt"    TIMESTAMPTZ(3),
  -- Huella del equipo en la última pasada: si cambia, la siguiente es completa (N-G5).
  "equipoFirma"       VARCHAR(40),
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
-- Por si una versión anterior de este archivo ya creó la tabla sin ellas.
ALTER TABLE google_agenda_imports ADD COLUMN IF NOT EXISTS "channelError"   VARCHAR(200);
ALTER TABLE google_agenda_imports ADD COLUMN IF NOT EXISTS "channelErrorAt" TIMESTAMPTZ(3);
ALTER TABLE google_agenda_imports ADD COLUMN IF NOT EXISTS "equipoFirma"    VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS "google_agenda_imports_channelId_key"
  ON google_agenda_imports ("channelId");
COMMENT ON TABLE google_agenda_imports IS
  'WS1-T9: bandera por clínica (enabled, apagada de fábrica) y estado de la sincronización Google Calendar → agenda. Sin fila = como siempre.';


-- ── 3. El vínculo bloqueo ↔ evento de Google ───────────────────────────
CREATE TABLE IF NOT EXISTS agenda_block_google (
  "blockId"           TEXT PRIMARY KEY REFERENCES agenda_blocks(id) ON DELETE CASCADE,
  "clinicId"          TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "calendarId"        TEXT NOT NULL,
  "googleEventId"     VARCHAR(1024) NOT NULL,
  "recurringEventId"  VARCHAR(1024),
  "title"             VARCHAR(300) NOT NULL,
  "allDay"            BOOLEAN NOT NULL DEFAULT false,
  -- Por qué el bloqueo es de toda la clínica (null = es de un doctor):
  -- 'sin_invitados' | 'no_reconocido' (ningún correo es de alguien de la clínica) | 'varios'.
  "alcance"           VARCHAR(20),
  "googleUpdated"     TIMESTAMPTZ(3),
  "eventStartsAt"     TIMESTAMPTZ(3) NOT NULL,
  "eventEndsAt"       TIMESTAMPTZ(3) NOT NULL,
  "eventDeletedAt"    TIMESTAMPTZ(3),
  "convertedAt"       TIMESTAMPTZ(3),
  "convertedById"     TEXT,
  "appointmentId"     TEXT,
  "avisoTipo"         VARCHAR(20),
  "avisoStartsAt"     TIMESTAMPTZ(3),
  "avisoEndsAt"       TIMESTAMPTZ(3),
  "avisoDesde"        TIMESTAMPTZ(3),
  "avisoDescartadoAt" TIMESTAMPTZ(3),
  -- Cita convertida: lo último que quedó bien en Google («estado|inicio|fin»);
  -- si no coincide con la cita, el cron lo repite (N-G12).
  "salidaFirma"       VARCHAR(120),
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
-- Un evento = un bloqueo por clínica y calendario: lo que hace idempotente
-- que el aviso de Google, el cron y la agenda sincronicen a la vez.
ALTER TABLE agenda_block_google ADD COLUMN IF NOT EXISTS "alcance"     VARCHAR(20);
ALTER TABLE agenda_block_google ADD COLUMN IF NOT EXISTS "salidaFirma" VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_block_google_evento_unico
  ON agenda_block_google ("clinicId", "calendarId", "googleEventId");
CREATE INDEX IF NOT EXISTS agenda_block_google_cita_idx
  ON agenda_block_google ("clinicId", "appointmentId");
CREATE INDEX IF NOT EXISTS agenda_block_google_serie_idx
  ON agenda_block_google ("clinicId", "recurringEventId");
COMMENT ON TABLE agenda_block_google IS
  'WS1-T9: vínculo de un bloqueo de agenda tipo GOOGLE con su evento de Google Calendar. Nunca se borra: eliminado = bloqueo retirado; convertido = convertedAt + appointmentId.';

-- ── 4. Defensa en profundidad: RLS que lo niega todo ────────────────────
-- Mismo patrón que sql/doctor-horarios.sql y sql/ws1-t12-google-calendar-estado.sql.
-- DaleControl entra solo por Prisma con el rol de servicio (que se salta RLS);
-- esto cierra PostgREST si alguien usa la llave anon: los títulos de los
-- eventos y el token del canal no se leen desde fuera (revisión t8).
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE "google_agenda_imports" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'google_agenda_imports' AND policyname = 'google_agenda_imports_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "google_agenda_imports_deny_anon" ON "google_agenda_imports" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
END
$rls$;
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE "agenda_block_google" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agenda_block_google' AND policyname = 'agenda_block_google_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "agenda_block_google_deny_anon" ON "agenda_block_google" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
END
$rls$;

-- Comprobación (solo lectura). El editor enseña solo el ÚLTIMO resultado:
-- una fila con tipo_google = GOOGLE, las dos tablas con nombre (no NULL) y
-- columnas_nuevas = true (las mismas que mira la app antes de usar las tablas).
SELECT (SELECT enumlabel FROM pg_enum
         WHERE enumtypid = '"AgendaBlockKind"'::regtype AND enumlabel = 'GOOGLE') AS tipo_google,
       to_regclass('public.google_agenda_imports')::text AS tabla_bandera,
       to_regclass('public.agenda_block_google')::text   AS tabla_vinculo,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND ((table_name = 'google_agenda_imports' AND column_name IN ('channelError', 'channelErrorAt', 'equipoFirma'))
             OR (table_name = 'agenda_block_google' AND column_name IN ('alcance', 'salidaFirma')))) = 5 AS columnas_nuevas;
