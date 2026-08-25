-- ═══════════════════════════════════════════════════════════════════════
-- INMUEBLES · PORTAL DEL CLIENTE (/i/portal) — índices de RENDIMIENTO.
--
-- NO CREA NI CAMBIA NINGUNA TABLA. El portal funciona sin esto; solo va
-- más lento. Es seguro correrlo dos veces (IF NOT EXISTS) y seguro no
-- correrlo nunca.
--
-- ── QUÉ RESUELVE ──────────────────────────────────────────────────────
-- El portal identifica a la persona por su TELÉFONO, y los teléfonos no
-- están guardados de una sola forma: RealtyContact.phone sí está
-- normalizado a 10 dígitos, pero RealtyPropertyOwner.phone se captura a
-- mano y llega como "33 1234 5678", "+52 33…" o con guiones. Por eso la
-- consulta normaliza EN EL MOTOR con la misma regla que mxTenDigits
-- (src/lib/phone-mx.ts).
--
-- El precio de eso es que un índice normal —(accountId, phone)— no sirve:
-- la comparación es contra una EXPRESIÓN, así que Postgres recorre las dos
-- tablas completas en cada resolución de sesión. Estos dos índices de
-- expresión lo convierten en una búsqueda directa.
--
-- 🔴 LA EXPRESIÓN TIENE QUE SER IDÉNTICA, CARÁCTER POR CARÁCTER, a la de
-- matchPhoneRows() en src/lib/realty/portal-auth.ts. Si una de las dos
-- cambia, el índice deja de usarse EN SILENCIO: nada falla, todo se vuelve
-- lento y nadie se entera.
--
-- Las tres funciones que usa (regexp_replace, length, left/right) son
-- IMMUTABLE, que es lo que Postgres exige para indexar una expresión.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "realty_contacts_phone_mx10_idx"
  ON "realty_contacts" ((
    CASE
      WHEN length(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')) = 13
       AND left(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 3) = '521'
        THEN right(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 10)
      WHEN length(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')) = 12
       AND left(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 2) = '52'
        THEN right(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 10)
      WHEN length(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')) = 10
        THEN regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')
      ELSE NULL
    END
  ));

CREATE INDEX IF NOT EXISTS "realty_property_owners_phone_mx10_idx"
  ON "realty_property_owners" ((
    CASE
      WHEN length(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')) = 13
       AND left(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 3) = '521'
        THEN right(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 10)
      WHEN length(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')) = 12
       AND left(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 2) = '52'
        THEN right(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'), 10)
      WHEN length(regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')) = 10
        THEN regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')
      ELSE NULL
    END
  ));

-- Los códigos de acceso se buscan por TELÉFONO en el momento de canjear el
-- código, cuando todavía no se sabe de qué cuenta se trata — así que el
-- índice del schema, (accountId, phone, expiresAt), no aplica. Sin esto,
-- cada intento de login recorre la tabla entera.
CREATE INDEX IF NOT EXISTS "realty_client_auth_tokens_phone_usedAt_idx"
  ON "realty_client_auth_tokens" ("phone", "usedAt");

-- ── Verificación ──────────────────────────────────────────────────────
-- Deben salir las tres filas:
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN (
--      'realty_contacts_phone_mx10_idx',
--      'realty_property_owners_phone_mx10_idx',
--      'realty_client_auth_tokens_phone_usedAt_idx'
--    );
--
-- Y que el plan de verdad lo use (con datos dentro; en una tabla vacía
-- Postgres prefiere el seq scan y eso NO es un error):
--   EXPLAIN SELECT id FROM "realty_property_owners"
--    WHERE CASE
--            WHEN length(regexp_replace(coalesce("phone",''),'[^0-9]','','g')) = 13
--             AND left(regexp_replace(coalesce("phone",''),'[^0-9]','','g'),3) = '521'
--              THEN right(regexp_replace(coalesce("phone",''),'[^0-9]','','g'),10)
--            WHEN length(regexp_replace(coalesce("phone",''),'[^0-9]','','g')) = 12
--             AND left(regexp_replace(coalesce("phone",''),'[^0-9]','','g'),2) = '52'
--              THEN right(regexp_replace(coalesce("phone",''),'[^0-9]','','g'),10)
--            WHEN length(regexp_replace(coalesce("phone",''),'[^0-9]','','g')) = 10
--              THEN regexp_replace(coalesce("phone",''),'[^0-9]','','g')
--            ELSE NULL
--          END = '5512345678';
