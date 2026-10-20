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
-- ADD VALUE IF NOT EXISTS no puede ir dentro de un bloque DO ni de una
-- transacción que luego use el valor: va suelto, como primera sentencia.
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
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
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
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
-- Un evento = un bloqueo por clínica y calendario: lo que hace idempotente
-- que el aviso de Google, el cron y la agenda sincronicen a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS agenda_block_google_evento_unico
  ON agenda_block_google ("clinicId", "calendarId", "googleEventId");
CREATE INDEX IF NOT EXISTS agenda_block_google_cita_idx
  ON agenda_block_google ("clinicId", "appointmentId");
CREATE INDEX IF NOT EXISTS agenda_block_google_serie_idx
  ON agenda_block_google ("clinicId", "recurringEventId");
COMMENT ON TABLE agenda_block_google IS
  'WS1-T9: vínculo de un bloqueo de agenda tipo GOOGLE con su evento de Google Calendar. Nunca se borra: eliminado = bloqueo retirado; convertido = convertedAt + appointmentId.';

-- Comprobación (solo lectura): debe devolver 'GOOGLE' y las dos tablas.
SELECT unnest(enum_range(NULL::"AgendaBlockKind"))::text AS tipo_de_bloqueo;
SELECT to_regclass('public.google_agenda_imports') AS tabla_bandera,
       to_regclass('public.agenda_block_google')   AS tabla_vinculo;
