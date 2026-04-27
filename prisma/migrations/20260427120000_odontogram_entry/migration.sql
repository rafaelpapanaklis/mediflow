-- Odontogram entries: estado por superficie (M/D/V/L/O) o por diente completo.
-- 32 dientes adultos en notación FDI; surface null cuando el estado aplica al
-- diente entero (corona, ausente, implante, etc).

CREATE TABLE "odontogram_entries" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "toothNumber" INTEGER NOT NULL,
  "surface" TEXT,
  "state" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "odontogram_entries_pkey" PRIMARY KEY ("id")
);

-- Una sola entry por (paciente, diente, superficie). Para superficies, las 5
-- superficies viven como filas separadas; para full-tooth surface=NULL y la
-- composite unique permite una sola fila full-tooth por diente. NOTE:
-- Postgres trata NULL como distinto en UNIQUE — para full-tooth eso significa
-- que técnicamente podrían existir 2 filas con surface=NULL para el mismo
-- diente. Lo evitamos a nivel aplicación (PUT hace upsert por la combinación
-- exacta y el endpoint dedup).
CREATE UNIQUE INDEX "odontogram_entries_patientId_toothNumber_surface_key"
  ON "odontogram_entries"("patientId", "toothNumber", "surface");

CREATE INDEX "odontogram_entries_patientId_idx"
  ON "odontogram_entries"("patientId");

ALTER TABLE "odontogram_entries"
  ADD CONSTRAINT "odontogram_entries_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
