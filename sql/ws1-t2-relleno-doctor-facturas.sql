-- ============================================================================
-- WS1-T2 — Relleno del doctor en facturas viejas que tienen cita ligada
-- (falla F10 de la auditoría BEVADENT, «95 % de lo facturado aparece como
-- Sin doctor» en Finanzas › Por doctor). Genérico: sirve para CUALQUIER clínica.
--
-- ⚠️ Lo decide y lo aplica Rafael, pegándolo en el SQL editor de Supabase.
--    La terminal no toca la base. NO es obligatorio: el código nuevo (commit
--    510cc5bb) ya pone el doctor en las facturas NUEVAS; esto solo arregla las
--    que nacieron sin él.
--
-- QUÉ HACE: a las facturas de UNA clínica que no tienen doctor ("doctorId" NULL)
-- y SÍ tienen cita ligada ("appointmentId"), les pone el doctor de esa cita.
--   · Solo si la cita es de la MISMA clínica y del MISMO paciente que la factura.
--   · Solo si ese doctor es de la misma clínica y su rol atiende
--     (DOCTOR, ADMIN o SUPER_ADMIN). Un doctor dado de baja SÍ se pone: fue
--     quien atendió esa cita (es historia, no una asignación nueva).
--   · No toca canceladas, ni facturas que ya tienen doctor, ni las que no tienen
--     cita (esas siguen «Sin doctor»: no hay de dónde sacarlo con certeza).
--   · No cambia montos, folios, pagos ni CFDI. No deja rastro en Movimientos
--     (es un relleno de datos, no una acción de alguien en el panel).
--
-- CÓMO USARLO (tres pasos, en orden):
--   1. Cambia el clinicId en las TRES líneas marcadas «← clinicId» (el mismo).
--   2. Corre el PASO 1 (vista previa) y el PASO 2 (conteo). Solo leen.
--   3. Si te convence, corre el PASO 3 (el UPDATE, dentro de BEGIN/COMMIT).
--      Repetirlo no hace nada: solo toca facturas que siguen sin doctor.
-- ============================================================================


-- ── PASO 1 · Vista previa: qué factura recibiría qué doctor (solo lee) ───────
WITH params AS (SELECT 'PON_AQUI_EL_CLINIC_ID'::text AS clinic_id)   -- ← clinicId
SELECT i."invoiceNumber"                         AS folio,
       i."createdAt"::date                       AS creada,
       i."status"                                AS estado,
       i."total"                                 AS total,
       a."startsAt"                              AS cita,
       u."firstName" || ' ' || u."lastName"      AS doctor_de_la_cita,
       u."role"                                  AS rol,
       u."isActive"                              AS activo
  FROM "invoices" i
  JOIN params p           ON i."clinicId" = p.clinic_id
  JOIN "appointments" a   ON a."id" = i."appointmentId"
                         AND a."clinicId" = i."clinicId"
                         AND a."patientId" = i."patientId"
  JOIN "users" u          ON u."id" = a."doctorId"
                         AND u."clinicId" = i."clinicId"
                         AND u."role" IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN')
 WHERE i."doctorId" IS NULL
   AND i."status" <> 'CANCELLED'
 ORDER BY i."createdAt" DESC
 LIMIT 200;


-- ── PASO 2 · Conteo: cuántas y cuánto dinero por doctor (solo lee) ───────────
WITH params AS (SELECT 'PON_AQUI_EL_CLINIC_ID'::text AS clinic_id)   -- ← clinicId
SELECT u."firstName" || ' ' || u."lastName"      AS doctor,
       COUNT(*)                                  AS facturas,
       SUM(i."total")                            AS facturado
  FROM "invoices" i
  JOIN params p           ON i."clinicId" = p.clinic_id
  JOIN "appointments" a   ON a."id" = i."appointmentId"
                         AND a."clinicId" = i."clinicId"
                         AND a."patientId" = i."patientId"
  JOIN "users" u          ON u."id" = a."doctorId"
                         AND u."clinicId" = i."clinicId"
                         AND u."role" IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN')
 WHERE i."doctorId" IS NULL
   AND i."status" <> 'CANCELLED'
 GROUP BY 1
 ORDER BY facturado DESC;


-- ── PASO 3 · El relleno (escribe). Corre el bloque completo. ─────────────────
-- Devuelve las facturas que cambió (RETURNING). Si el número no es el del
-- PASO 2, cambia COMMIT por ROLLBACK antes de correrlo y avisa.
BEGIN;

WITH params AS (SELECT 'PON_AQUI_EL_CLINIC_ID'::text AS clinic_id)   -- ← clinicId
UPDATE "invoices" i
   SET "doctorId"  = a."doctorId",
       "updatedAt" = NOW()
  FROM params p, "appointments" a, "users" u
 WHERE i."clinicId" = p.clinic_id
   AND i."doctorId" IS NULL
   AND i."status" <> 'CANCELLED'
   AND a."id" = i."appointmentId"
   AND a."clinicId" = i."clinicId"
   AND a."patientId" = i."patientId"
   AND u."id" = a."doctorId"
   AND u."clinicId" = i."clinicId"
   AND u."role" IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN')
RETURNING i."invoiceNumber", i."doctorId";

COMMIT;
