-- ═══════════════════════════════════════════════════════════════════════
-- Soporte Técnico — editar / retirar / adjuntar a una respuesta ya enviada.
-- IDEMPOTENTE: seguro re-correr en el SQL editor de Supabase.
--
-- Solo agrega una tabla NUEVA (equivalente idempotente del modelo Prisma
-- SupportMessageRevision, al final de la sección de soporte en
-- prisma/schema.prisma). NO toca `support_messages`: si este SQL aún no se
-- corrió, el hilo del ticket y el envío de mensajes siguen funcionando igual
-- (solo «Editar / Retirar / Adjuntar» contesta que falta aplicarlo).
--
-- Una fila por CAMBIO hecho por soporte a un mensaje suyo, con lo que decía
-- ANTES: es la auditoría (nada de borrado silencioso — el aviso a la clínica
-- ya salió con el texto original).
--   kind = 'edit'    → cambió el texto (y quizá agregó archivos)
--   kind = 'attach'  → solo agregó archivos
--   kind = 'retract' → soporte retiró la respuesta; en `support_messages` el
--                      cuerpo queda como «Respuesta retirada por soporte» y
--                      sin adjuntos; el texto y los archivos originales
--                      viven aquí en previousBody / previousAttachments.
-- El estado visible «(editado)» / «retirada» se deduce de estas filas.
--
-- Nota sobre $$: un único delimitador `$sr$` y NUNCA bloques DO anidados.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "support_message_revisions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "previousBody" TEXT NOT NULL,
    "previousAttachments" JSONB,
    "editedById" TEXT,
    "editedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_message_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_message_revisions_ticketId_createdAt_idx"
    ON "support_message_revisions"("ticketId", "createdAt");

CREATE INDEX IF NOT EXISTS "support_message_revisions_messageId_createdAt_idx"
    ON "support_message_revisions"("messageId", "createdAt");

-- Si el mensaje (o su ticket, en cascada) se borra, su historial se va con él.
DO $sr$
BEGIN
  ALTER TABLE "support_message_revisions"
    ADD CONSTRAINT "support_message_revisions_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "support_messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$sr$;

-- ── RLS deny-all (defense-in-depth) ──────────────────────────────────────
-- Prisma usa el service role y bypassa RLS; el cliente nunca consulta esta
-- tabla por PostgREST. Guarda el texto original de respuestas retiradas.
-- Sigue sql/rls-deny-all-policies.sql.
ALTER TABLE "support_message_revisions" ENABLE ROW LEVEL SECURITY;

DO $sr$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'support_message_revisions'
      AND policyname = 'support_message_revisions_deny_anon'
  ) THEN
    CREATE POLICY "support_message_revisions_deny_anon" ON "support_message_revisions"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END
$sr$;

-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'support_message_revisions' ORDER BY ordinal_position;
-- SELECT policyname FROM pg_policies WHERE tablename = 'support_message_revisions';
