-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — ACUSE AUTOMÁTICO de WhatsApp (opcional, APAGADO por
-- defecto). Decisión de Rafael, 15-nov-2026 (#7).
--
-- Una fila por barbería con el interruptor y el texto que escribe la
-- barbería en /barber/whatsapp → Conexión → «Contestar en automático cuando
-- un cliente responde a un recordatorio». Sin fila = apagado.
--
-- Plano e idempotente: se puede pegar las veces que sea. El código funciona
-- ANTES de pegarlo (sin la tabla el acuse queda apagado y la pantalla avisa
-- que falta este SQL para poder guardarlo).
--
-- Se lee y escribe con SQL crudo desde src/lib/barber/wa-acuse.ts; NO está
-- en prisma/schema.prisma. ⚠️ Por eso un `prisma db push` en una base de
-- desarrollo la borraría: si pasa, vuelve a correr este archivo (en
-- producción el SQL del vertical se pega a mano).
--
-- Para deshacerlo:  DROP TABLE IF EXISTS "barber_wa_acuse";
-- (No se pierde ningún mensaje: los acuses enviados viven en barber_messages.)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "barber_wa_acuse" (
    "barbershopId" TEXT NOT NULL,
    "enabled"      BOOLEAN NOT NULL DEFAULT false,
    "message"      TEXT,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_wa_acuse_pkey" PRIMARY KEY ("barbershopId"),
    CONSTRAINT "barber_wa_acuse_barbershopId_fkey"
      FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_wa_acuse_message_len" CHECK ("message" IS NULL OR char_length("message") <= 300)
);

-- Igual que el resto de las tablas del vertical: solo el servidor (Prisma con
-- la conexión de servicio) la toca; nada de leerla desde el navegador.
ALTER TABLE "barber_wa_acuse" ENABLE ROW LEVEL SECURITY;
