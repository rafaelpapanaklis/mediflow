-- ───────────────────────────────────────────────────────────────────────────
-- WS1-T2 · hallazgo 3 — limpieza de los enlaces de portal que ya quedaron
-- vivos ANTES del arreglo.
--
-- OPCIONAL: no hace falta para cerrar el hueco. El arreglo de código ya lo
-- cierra por los dos lados —GET /api/portal/[token] rechaza a todo paciente
-- con `deletedAt`, y POST /api/arco-request anula el token al anonimizar—, así
-- que ninguno de estos enlaces abre nada desde el deploy.
--
-- Esto es HIGIENE: deja la base coherente con lo que el código ya garantiza y
-- retira un bearer que sigue escrito en filas de pacientes dados de baja (y en
-- el WhatsApp/correo por el que se les mandó en su día).
--
-- NO borra ninguna fila, ningún dato clínico y ningún PII: sólo pone a NULL
-- dos columnas del enlace público. La historia clínica se conserva intacta
-- (NOM-024, 5 años).
--
-- ⚠️ Lo aplica Rafael. La terminal no toca la base.
-- ───────────────────────────────────────────────────────────────────────────

-- 1) ANTES: cuántos pacientes dados de baja conservan un enlace de portal.
--    Si sale 0, no hay nada que hacer y el paso 2 se puede saltar.
SELECT
  "clinicId",
  COUNT(*) AS pacientes_con_enlace_vivo,
  COUNT(*) FILTER (WHERE "portalTokenExpiry" IS NULL OR "portalTokenExpiry" > NOW())
    AS enlaces_aun_no_expirados
FROM patients
WHERE "deletedAt" IS NOT NULL
  AND "portalToken" IS NOT NULL
GROUP BY "clinicId"
ORDER BY pacientes_con_enlace_vivo DESC;

-- 2) LIMPIEZA. Sólo pacientes con baja (deletedAt) que aún tienen token.
--    Idempotente: correrlo dos veces afecta 0 filas la segunda.
UPDATE patients
SET "portalToken"       = NULL,
    "portalTokenExpiry" = NULL
WHERE "deletedAt" IS NOT NULL
  AND "portalToken" IS NOT NULL;

-- 3) DESPUÉS: tiene que devolver 0 filas.
SELECT COUNT(*) AS deberia_ser_cero
FROM patients
WHERE "deletedAt" IS NOT NULL
  AND "portalToken" IS NOT NULL;
