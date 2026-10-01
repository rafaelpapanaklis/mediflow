-- ============================================================================
-- WS1-T11 — El bot de WhatsApp aprende de cada clínica (SUPERVISADO).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- PARA QUÉ: tres tablas nuevas para la pantalla «Bot → Aprende de tu equipo»
-- (/dashboard/whatsapp/bot/aprende):
--   · whatsapp_bot_sugerencias    — «¿quieres que el bot conteste esto así?»
--     (de una respuesta del equipo tras un «no supe» del bot, o de una
--     corrección 👎). Nada se vuelve respuesta del bot hasta que la clínica la
--     aprueba: aprobar crea una fila en whatsapp_bot_faqs.
--   · whatsapp_bot_valoraciones   — 👍 / 👎 sobre cada respuesta del bot.
--   · whatsapp_bot_ejemplos_tono  — respuestas del equipo marcadas «así
--     hablamos» (máx. 8 activas, cortas) que se le pasan al bot como estilo.
--
-- PRIVACIDAD: los textos se guardan YA anonimizados (sin nombres, teléfonos,
-- correos, fechas, montos personales ni documentos). Lo que habla de la salud
-- de un paciente se guarda como 'no_apto' SIN texto: solo cuenta.
-- Todo lleva "clinicId" y la app filtra siempre por la clínica de la sesión.
--
-- ANTES DE PEGARLO el código ya funciona: la pantalla muestra el reporte (que
-- sale del Inbox) y oculta sugerencias, 👍/👎 y ejemplos de tono hasta que
-- estas tablas existan. Son tablas NUEVAS (no columnas en tablas que ya
-- existen), así que nada de lo que hay hoy cambia.
--
-- Plano e idempotente: se puede pegar dos veces. Sin DO $$, sin migraciones.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "whatsapp_bot_sugerencias" (
  "id"            text         PRIMARY KEY,
  "clinicId"      text         NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- 'equipo' = una persona contestó lo que el bot no supo; 'correccion' = 👎 con «así debió ser».
  "origen"        text         NOT NULL CHECK ("origen" IN ('equipo', 'correccion')),
  "estado"        text         NOT NULL DEFAULT 'pendiente'
                               CHECK ("estado" IN ('pendiente', 'aprobada', 'descartada', 'no_apto')),
  -- clinico | personal | corta | larga (solo con estado 'no_apto').
  "motivoNoApto"  text,
  -- Anonimizados. NULL cuando es 'no_apto' (no se guarda el texto).
  "pregunta"      text,
  "respuesta"     text,
  "tema"          text,
  "threadId"      text         REFERENCES "inbox_threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- Mensaje del Inbox que la originó (nota de handoff, respuesta del bot…):
  -- llave de idempotencia, el escaneo nunca crea dos sugerencias del mismo.
  "fuenteId"      text         NOT NULL,
  -- La respuesta frecuente que se creó al aprobarla.
  "faqId"         text         REFERENCES "whatsapp_bot_faqs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "decididoPorId" text         REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "decididoAt"    timestamp(3),
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_bot_sugerencias_clinicId_fuenteId_key"
  ON "whatsapp_bot_sugerencias" ("clinicId", "fuenteId");
CREATE INDEX IF NOT EXISTS "whatsapp_bot_sugerencias_clinicId_estado_createdAt_idx"
  ON "whatsapp_bot_sugerencias" ("clinicId", "estado", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "whatsapp_bot_valoraciones" (
  "id"          text         PRIMARY KEY,
  "clinicId"    text         NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- La respuesta del bot que se valoró.
  "messageId"   text         NOT NULL REFERENCES "inbox_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "threadId"    text         NOT NULL REFERENCES "inbox_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "valor"       text         NOT NULL CHECK ("valor" IN ('bien', 'mal')),
  -- «Cómo debió contestar» (solo con 'mal'), anonimizado.
  "correccion"  text,
  -- Lo que preguntó el paciente, anonimizado (NULL si era clínico).
  "pregunta"    text,
  "usuarioId"   text         REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_bot_valoraciones_clinicId_messageId_key"
  ON "whatsapp_bot_valoraciones" ("clinicId", "messageId");
CREATE INDEX IF NOT EXISTS "whatsapp_bot_valoraciones_clinicId_createdAt_idx"
  ON "whatsapp_bot_valoraciones" ("clinicId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "whatsapp_bot_ejemplos_tono" (
  "id"          text         PRIMARY KEY,
  "clinicId"    text         NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Anonimizado, máx. 280 caracteres (lo valida la app; aquí, de respaldo).
  "texto"       text         NOT NULL CHECK (char_length("texto") BETWEEN 1 AND 400),
  -- Mensaje del Inbox del que salió (sin FK: si el hilo se borra, el ejemplo
  -- anonimizado puede quedarse; la clínica lo quita desde la pantalla).
  "fuenteId"    text         NOT NULL,
  "activo"      boolean      NOT NULL DEFAULT true,
  "creadoPorId" text         REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_bot_ejemplos_tono_clinicId_fuenteId_key"
  ON "whatsapp_bot_ejemplos_tono" ("clinicId", "fuenteId");
CREATE INDEX IF NOT EXISTS "whatsapp_bot_ejemplos_tono_clinicId_activo_idx"
  ON "whatsapp_bot_ejemplos_tono" ("clinicId", "activo");

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
-- Con RLS activo y SIN políticas nadie más lee ni escribe estas tablas.
ALTER TABLE "whatsapp_bot_sugerencias"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_bot_valoraciones"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_bot_ejemplos_tono" ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('whatsapp_bot_sugerencias', 'whatsapp_bot_valoraciones', 'whatsapp_bot_ejemplos_tono');
-- SELECT "clinicId", "estado", count(*) FROM "whatsapp_bot_sugerencias" GROUP BY 1, 2 ORDER BY 1, 2;
