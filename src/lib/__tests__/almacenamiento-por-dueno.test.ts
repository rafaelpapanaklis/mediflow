// Encargo 11 (decisión de Rafael, 7-oct-2026): el almacenamiento del plan es POR DUEÑO, compartido
// entre todas sus sedes. Run: npx tsx --test src/lib/__tests__/almacenamiento-por-dueno.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { desgloseVacio, resumirAlmacenamiento, sumarDesgloses, totalDesglose } from "../storage-usage-core";
import { sedesDeLosDuenos } from "../storage-owner";

const GB = 1024 ** 3;
const fuente = (r: string) => readFileSync(join(__dirname, "..", "..", "..", r), "utf8");
const con = (fotos: number) => ({ ...desgloseVacio(), fotos });

test("sedes del dueño: las clínicas donde el mismo supabaseId es SUPER_ADMIN; sin dueño, la clínica sola", () => {
  const filas = [
    { supabaseId: "d1", clinicId: "A" }, { supabaseId: "d1", clinicId: "B" }, { supabaseId: "d1", clinicId: "C" },
    { supabaseId: "d2", clinicId: "X" },
  ];
  assert.deepEqual(sedesDeLosDuenos("B", filas).sort(), ["A", "B", "C"]);
  assert.deepEqual(sedesDeLosDuenos("X", filas), ["X"]);
  assert.deepEqual(sedesDeLosDuenos("Z", filas), ["Z"]);
});

test("tres sedes de 30 GB suman 90 GB contra los 75 GB del plan Clínica: lleno; una sola sede de 30 GB, no", () => {
  const sedes = [con(30 * GB), con(30 * GB), con(30 * GB)];
  const total = totalDesglose(sumarDesgloses(sedes));
  assert.equal(total, 90 * GB);
  assert.equal(resumirAlmacenamiento(sumarDesgloses(sedes), 75 * GB).nivel, "lleno");
  assert.equal(resumirAlmacenamiento(sumarDesgloses([con(30 * GB)]), 75 * GB).nivel, "ok");
  // por sede (el código viejo) ninguna pasaba de 75 GB: cada una se veía al 40 %
  for (const s of sedes) assert.equal(resumirAlmacenamiento(s, 75 * GB).porcentaje, 40);
  assert.equal(resumirAlmacenamiento(sumarDesgloses(sedes), 75 * GB).porcentaje, 100);
});

test("el bloqueo de subida, la tarjeta de uso y /admin miden la suma de las sedes", () => {
  const q = fuente("src/lib/storage-quota.ts");
  assert.match(q, /medirAlmacenamientoDelDueno\(clinicId\)/);
  assert.doesNotMatch(q, /medirAlmacenamientoDeClinica/);
  const u = fuente("src/app/api/storage/usage/route.ts");
  assert.match(u, /medirAlmacenamientoDelDueno\(clinicId\)/);
  assert.match(u, /sedes/);
  const a = fuente("src/lib/admin/uso-clinica.ts");
  assert.match(a, /sumarDesgloses\(sedesDe\(c\.id\)/);
  assert.match(a, /storageSedes/);
  // textos «todas tus sedes» en es/en
  for (const f of ["es", "en"]) {
    const d = JSON.parse(fuente(`src/i18n/dictionaries/${f}.json`)).shell.storageCard;
    assert.match(d.usedOfAllBranches, /\{used\}.*\{limit\}/);
  }
  assert.match(fuente("src/components/dashboard/storage-usage-card.tsx"), /usedOfAllBranches/);
  assert.match(fuente("src/components/dashboard/bloques-rediseno/almacenamiento.tsx"), /usedOfAllBranches/);
});
