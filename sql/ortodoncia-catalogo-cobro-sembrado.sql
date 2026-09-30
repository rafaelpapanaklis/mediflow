-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T4 · revisión final, fallo 2.
--
-- El catálogo de ortodoncia sembrado ANTES de que existiera
-- "procedure_catalog"."orthoIncludedInTreatment" (sql/ortodoncia-modo-cobro.sql)
-- quedó con esa columna en NULL: el cobro solo estaba escrito en la
-- descripción («Con costo aparte.»). El código ya lo resuelve solo
-- (`cobroDelProcedimiento`, src/lib/orthodontics/catalog-procedures.ts); este
-- script deja además la columna escrita, para que lo que se vea en la base sea
-- lo mismo que usa el panel.
--
-- Solo toca filas de ortodoncia con la columna en NULL y el nombre de la
-- precarga sugerida. No toca el «Control de ortodoncia» (su NULL es a
-- propósito) ni lo que la clínica ya marcó a mano. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

UPDATE "procedure_catalog"
   SET "orthoIncludedInTreatment" = false
 WHERE "category" = 'orthodontics'
   AND "orthoIncludedInTreatment" IS NULL
   AND "name" IN (
     'Valoración de ortodoncia',
     'Toma de registros de ortodoncia',
     'Colocación de aparatología',
     'Reposición de bracket',
     'Retenedor superior',
     'Retenedor inferior',
     'Retiro de aparatología',
     'Urgencia de ortodoncia',
     'Microimplante (TAD)',
     'Alineadores de refinamiento'
   );

UPDATE "procedure_catalog"
   SET "orthoIncludedInTreatment" = true
 WHERE "category" = 'orthodontics'
   AND "orthoIncludedInTreatment" IS NULL
   AND "name" = 'Colocación de elásticos';

-- Comprobación: lo que sigue en NULL (debe quedar solo el control y lo que la
-- clínica creó sin elegir cobro).
SELECT "clinicId", "name", "orthoIncludedInTreatment"
  FROM "procedure_catalog"
 WHERE "category" = 'orthodontics' AND "orthoIncludedInTreatment" IS NULL
 ORDER BY "clinicId", "name";
