/**
 * Reportes sin textos viejos y la «Hora más problemática» en la hora de la
 * clínica (ws1-t2, auditoría de uso N-18 y N-20; t6 F14, t12 F-17 y F-18).
 *
 * Run: npm run test:reportes-y-no-shows
 *
 * Con el código viejo falla: el «Qué cuenta» de Reportes decía «sin facturas
 * canceladas» (desde C-01 el cobro cuenta aunque su factura se cancele),
 * «PROXIMAS CITAS» iba sin acento, la API de No-shows usaba `getHours()` del
 * servidor y la pantalla pintaba «1:00» (`horaYDiaEnZona` y `horaLegible` no
 * existían).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { horaLegible, horaYDiaEnZona } from "@/lib/analytics/mes-legible";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

test("N-18: Reportes ya no dice «sin facturas canceladas» y «Próximas citas» lleva acento", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  assert.doesNotMatch(es.queCuenta.reportesIngresos, /sin facturas canceladas/);
  assert.match(es.queCuenta.reportesIngresos, /aunque después se cancele su factura/);
  assert.doesNotMatch(en.queCuenta.reportesIngresos, /no cancelled invoices/);
  assert.equal(es.analytics.reports.kpiUpcomingAppts, "Próximas citas");
});

test("N-20: la hora y el día salen en la zona de la clínica, no en la del servidor", () => {
  // Martes 6-oct-2026, 13:20 en la Ciudad de México = 19:20 UTC.
  assert.deepEqual(horaYDiaEnZona(new Date("2026-10-06T19:20:00Z"), "America/Mexico_City"), { hora: 13, dia: 1 });
  // Domingo 4-oct 00:30 en CDMX (06:30 UTC): hora 0, día 6.
  assert.deepEqual(horaYDiaEnZona(new Date("2026-10-04T06:30:00Z"), "America/Mexico_City"), { hora: 0, dia: 6 });
  assert.equal(horaLegible(13), "13:00");
  assert.equal(horaLegible(1), "01:00");
  const api = leer("src/app/api/analytics/no-shows/route.ts");
  assert.doesNotMatch(api, /\.getHours\(\)|\.getDay\(\)/);
  assert.match(api, /citasDelPeriodoWhere\(clinicId, from,/, "el total son las citas sin canceladas, como el Resumen");
  for (const f of ["src/app/dashboard/analytics/no-shows/no-shows-client.tsx", "src/app/dashboard/analytics/no-shows/no-shows-rediseno.tsx"]) {
    const s = leer(f);
    assert.match(s, /horaLegible\(/, f);
    assert.doesNotMatch(s, /hour\}:00`/, f);
  }
});
