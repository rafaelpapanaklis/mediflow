-- ============================================================================
-- recetas-folio-obligatorio-impacto.sql  ·  WS1-T1  ·  15-sep-2026
--
-- SOLO LECTURA. No crea, no altera y no borra NADA. Son SELECT.
--
-- Para qué: medir a cuánta gente afectaría exigir el folio del recetario
-- oficial en los grupos COFEPRIS I y II (interruptor RECETAS_FOLIO_OBLIGATORIO
-- en @/lib/clinical/cofepris).
--
-- Cómo leerlo: cada receta que aparezca aquí es una que, con el interruptor
-- encendido, HOY se habría rechazado con 422 «cofeprisFolio_required».
-- Si el número es grande, enciende el interruptor apagado
-- (RECETAS_FOLIO_OBLIGATORIO=off) y dales aviso a los doctores antes.
--
-- El grupo de una receta es el MÁS RESTRICTIVO de sus medicamentos según el
-- catálogo (cums_items), que es exactamente lo que hace el servidor. Por eso
-- basta con «existe un item de grupo I o II».
-- ============================================================================

-- 1) El número que pidió Rafael: recetas de los últimos 90 días que se habrían
--    rechazado por falta de folio.
SELECT count(*) AS recetas_rechazadas_90d
FROM prescriptions p
WHERE p."issuedAt" >= now() - interval '90 days'
  AND nullif(btrim(coalesce(p."cofeprisFolio", '')), '') IS NULL
  AND EXISTS (
        SELECT 1
        FROM prescription_items pi
        JOIN cums_items c ON c.clave = pi."cumsKey"
        WHERE pi."prescriptionId" = p.id
          AND upper(btrim(coalesce(c."cofeprisGroup", ''))) IN ('I', 'II')
      );

-- 2) El mismo número, con contexto: cuántas recetas de controlados I/II hubo en
--    total y qué porcentaje iban sin folio.
SELECT
  count(*)                                                        AS controladas_i_ii_90d,
  count(*) FILTER (
    WHERE nullif(btrim(coalesce(p."cofeprisFolio", '')), '') IS NULL
  )                                                               AS sin_folio,
  count(*) FILTER (
    WHERE nullif(btrim(coalesce(p."cofeprisFolio", '')), '') IS NOT NULL
  )                                                               AS con_folio
FROM prescriptions p
WHERE p."issuedAt" >= now() - interval '90 days'
  AND EXISTS (
        SELECT 1
        FROM prescription_items pi
        JOIN cums_items c ON c.clave = pi."cumsKey"
        WHERE pi."prescriptionId" = p.id
          AND upper(btrim(coalesce(c."cofeprisGroup", ''))) IN ('I', 'II')
      );

-- 3) Repartido por clínica, para saber a quién hay que avisar.
SELECT
  cl.name                                                         AS clinica,
  count(*)                                                        AS se_habrian_rechazado
FROM prescriptions p
JOIN clinics cl ON cl.id = p."clinicId"
WHERE p."issuedAt" >= now() - interval '90 days'
  AND nullif(btrim(coalesce(p."cofeprisFolio", '')), '') IS NULL
  AND EXISTS (
        SELECT 1
        FROM prescription_items pi
        JOIN cums_items c ON c.clave = pi."cumsKey"
        WHERE pi."prescriptionId" = p.id
          AND upper(btrim(coalesce(c."cofeprisGroup", ''))) IN ('I', 'II')
      )
GROUP BY cl.name
ORDER BY se_habrian_rechazado DESC;

-- ============================================================================
-- DE PROPINA — el otro rojo, el de la vigencia. No hace falta para decidir el
-- folio, pero dice cuántas recetas de controlados hay HOY en la base con una
-- vigencia por encima del tope legal (I = 24 h, II = 30 días, III = 90 días).
-- Esas ya están emitidas: el arreglo evita las nuevas, no corrige las viejas.
-- ============================================================================
SELECT
  grupo_real                                                      AS grupo_cofepris,
  count(*)                                                        AS recetas_con_vigencia_ilegal
FROM (
  SELECT
    p.id,
    p."expiresAt",
    p."issuedAt",
    min(
      CASE upper(btrim(coalesce(c."cofeprisGroup", '')))
        WHEN 'I' THEN 1 WHEN 'II' THEN 2 WHEN 'III' THEN 3
        WHEN 'IV' THEN 4 WHEN 'V' THEN 5 WHEN 'VI' THEN 6
        ELSE 99
      END
    )                                                             AS rango,
    CASE min(
      CASE upper(btrim(coalesce(c."cofeprisGroup", '')))
        WHEN 'I' THEN 1 WHEN 'II' THEN 2 WHEN 'III' THEN 3
        WHEN 'IV' THEN 4 WHEN 'V' THEN 5 WHEN 'VI' THEN 6
        ELSE 99
      END
    ) WHEN 1 THEN 'I' WHEN 2 THEN 'II' WHEN 3 THEN 'III' ELSE 'otro' END AS grupo_real
  FROM prescriptions p
  JOIN prescription_items pi ON pi."prescriptionId" = p.id
  JOIN cums_items c ON c.clave = pi."cumsKey"
  GROUP BY p.id, p."expiresAt", p."issuedAt"
) t
WHERE t.rango <= 3
  AND t."expiresAt" IS NOT NULL
  AND t."expiresAt" > t."issuedAt" + (
        CASE t.rango
          WHEN 1 THEN interval '24 hours'
          WHEN 2 THEN interval '30 days'
          ELSE interval '90 days'
        END
      )
GROUP BY grupo_real
ORDER BY recetas_con_vigencia_ilegal DESC;
