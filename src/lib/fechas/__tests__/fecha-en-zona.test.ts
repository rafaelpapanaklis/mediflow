// C-64 (auditoría de uso, vuelta 2): a las 23:05 del 3-oct en CDMX (05:05Z del 4-oct) el plan decía «Inicio 4 oct»,
// el cuestionario «llenado el 4 de octubre» y el consentimiento «Creado el 04 oct» cuando el navegador estaba en otra
// zona. Con la zona de la clínica todas dicen el 3. Este módulo no existía con el código viejo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { diaEnZona, formatoEnZona } from "../fecha-en-zona";
import { fechaLarga } from "@/components/dashboard/pacientes-rediseno/fechas";

const NOCHE = "2026-10-04T05:05:00.000Z"; // 3-oct 23:05 en CDMX, 4-oct 01:05 en Nueva York
const CDMX = "America/Mexico_City";

test("un instante se pinta en el día de la clínica", () => {
  assert.equal(diaEnZona(NOCHE, CDMX), "2026-10-03");
  assert.equal(diaEnZona(NOCHE, "America/New_York"), "2026-10-04");
  assert.equal(formatoEnZona(NOCHE, { day: "2-digit", month: "short", year: "numeric" }, CDMX)?.startsWith("03"), true);
  assert.equal(fechaLarga(NOCHE, "es-MX", CDMX), "3 de octubre de 2026");
});

test("un día suelto sigue siendo ese día, con cualquier zona", () => {
  assert.match(formatoEnZona("2026-10-03", { day: "numeric", month: "short" }, "Asia/Tokyo")!, /^3 /);
  assert.equal(fechaLarga("2026-10-03", "es-MX", "Asia/Tokyo"), "3 de octubre de 2026");
});

test("zona inválida o vacía: no truena", () => {
  assert.ok(formatoEnZona(NOCHE, { day: "numeric" }, "No/Existe"));
  assert.equal(formatoEnZona(null, { day: "numeric" }, CDMX), null);
});
