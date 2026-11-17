-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — USO DEL PANEL (ws6-t4, 16-nov-2026).
--
-- Rafael: «no puedo ver si el usuario dio clicks y cuántos en el mes».
--
-- Una fila por cosa que hace un usuario de la barbería en /barber:
--   · SESSION  — entró (una pestaña nueva o volvió tras 30 min sin tocar nada)
--   · VIEW     — abrió una pantalla
--   · CLICK    — tocó un botón, enlace, pestaña o acción
--
-- QUÉ SE GUARDA y QUÉ NO (privacidad):
--   · "screen"  la RUTA de la pantalla con los ids cambiados por [id]
--               (/barber/clientes/[id]), nunca la consulta (?q=…).
--   · "action"  la clave data-accion del botón, o el texto del botón SOLO si
--               es un texto del propio panel (diccionario de barber). Si el
--               texto lleva un dato («Cobrar $720»), se guarda la PLANTILLA
--               («Cobrar {amount}»), nunca el dato. Un texto que no es del
--               panel (el nombre de un cliente en una lista) NO se guarda.
--   · "target"  a dónde lleva un enlace, también como ruta sin ids; un enlace
--               de fuera (WhatsApp, teléfono, otra web) queda como «externo».
--   · NADA de lo que se escribe en campos, ni teléfonos, ni nombres.
--   · No se registra nada mientras un admin de DaleControl tiene sesión abierta
--     en el mismo navegador («Ver como barbería» incluido).
--
-- Aditivo e idempotente: se puede pegar dos veces. No toca ninguna tabla que
-- ya exista. Sin esta tabla el registrador se apaga solo y nada truena.
-- Supabase → SQL Editor.
--
-- Para deshacerlo:
--   DROP TABLE IF EXISTS "barber_usage_events";
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "barber_usage_events" (
    "id"            TEXT NOT NULL,
    -- La SEDE en la que estaba trabajando (la del selector), no la del usuario.
    "barbershopId"  TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    -- Id de la pestaña/sesión que genera el navegador (no es la sesión de login).
    "sessionId"     TEXT NOT NULL,
    "type"          TEXT NOT NULL,
    "screen"        TEXT NOT NULL,
    "action"        TEXT,
    "target"        TEXT,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "barber_usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "barber_usage_events_shop_fkey"
        FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE,
    CONSTRAINT "barber_usage_events_user_fkey"
        FOREIGN KEY ("userId") REFERENCES "barber_users"("id") ON DELETE CASCADE,
    CONSTRAINT "barber_usage_events_type_chk"
        CHECK ("type" IN ('SESSION', 'VIEW', 'CLICK')),
    CONSTRAINT "barber_usage_events_sizes_chk"
        CHECK (char_length("screen") <= 120
           AND char_length("sessionId") <= 64
           AND ("action" IS NULL OR char_length("action") <= 80)
           AND ("target" IS NULL OR char_length("target") <= 120))
);

-- La ficha y la lista del admin: por barbería y fecha.
CREATE INDEX IF NOT EXISTS "barber_usage_events_shop_created_idx"
    ON "barber_usage_events" ("barbershopId", "createdAt");

-- El tope por usuario y minuto, y el «último acceso» por persona.
CREATE INDEX IF NOT EXISTS "barber_usage_events_user_created_idx"
    ON "barber_usage_events" ("userId", "createdAt");

-- Solo el servidor (Prisma, rol de servicio) lee y escribe: nadie desde el
-- navegador con la llave anónima. Igual que las demás tablas de barber.
ALTER TABLE "barber_usage_events" ENABLE ROW LEVEL SECURITY;
