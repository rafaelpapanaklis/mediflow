/**
 * CRM que dice cuándo se calculó y cuadra con Finanzas, y fechas legibles en
 * Analítica y Reportes (ws1-t2, auditoría de uso del 3/4-oct-2026, C-25 y C-37).
 *
 * Run: npm run test:crm-y-formatos
 *
 *   · C-25: el CRM se quedaba hasta 5 min atrás sin decirlo ($475,226 contra
 *     $471,896 de Finanzas en el mismo momento) y sumaba saldos negativos (una
 *     factura pagada de más restaba la deuda de otra).
 *   · C-37: la retención por cohorte decía «2026-09» y Reportes «may 26».
 *
 * Con el código viejo falla: `mes-legible.ts` no existía, la consulta del CRM
 * no filtraba `balance > 0` ni devolvía `generatedAt`, y Reportes formateaba
 * con `year: "2-digit"`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { mesLegible, minutosDesde } from "@/lib/analytics/mes-legible";
import { ventanasDeReportes } from "@/app/dashboard/reports/ventanas-de-reportes";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

test("C-37: «sep 2026», no «2026-09» ni «may 26»", () => {
  assert.equal(mesLegible("2026-09"), "sep 2026");
  assert.equal(mesLegible("2026-05"), "may 2026");
  assert.equal(mesLegible("2026-09", "en"), "Sep 2026");
  assert.equal(mesLegible("otra-cosa"), "otra-cosa");
  const v = ventanasDeReportes(new Date("2026-10-04T05:10:00Z"), "America/Mexico_City");
  assert.equal(v.meses[5].label, "oct 2026");
  assert.equal(v.meses[0].label, "may 2026");
  assert.match(leer("src/app/dashboard/analytics/crm/crm-client.tsx"), /month: mesLegible\(c\.month/);
});

test("C-25: el CRM dice hace cuánto se calcularon sus cifras", () => {
  const ahora = new Date("2026-10-04T05:10:00Z");
  assert.equal(minutosDesde("2026-10-04T05:06:30Z", ahora), 3);
  assert.equal(minutosDesde("2026-10-04T05:20:00Z", ahora), 0);
  assert.equal(minutosDesde(null, ahora), 0);
  const api = leer("src/app/api/analytics/patients-value/route.ts");
  assert.match(api, /return \{ totals, top, generatedAt: now\.toISOString\(\) \}/);
  assert.match(api, /"analytics-patients-value-v3"/, "la caché vieja (sin generatedAt) no se sirve");
  for (const f of ["src/app/dashboard/analytics/crm/crm-client.tsx", "src/app/dashboard/analytics/crm/crm-rediseno.tsx"]) {
    assert.match(leer(f), /<ActualizadoHace generatedAt=\{value\.generatedAt\} \/>/, f);
  }
});

test("C-25: el «Saldo por cobrar» del CRM suma solo saldos positivos, como Finanzas", () => {
  // Una factura pagada de más (saldo −$90) ya no resta la deuda de las demás.
  const saldos = [500, -90, 300];
  const viejo = saldos.reduce((a, b) => a + b, 0);
  const finanzas = saldos.filter((b) => b > 0).reduce((a, b) => a + b, 0);
  assert.notEqual(viejo, finanzas);
  const api = leer("src/app/api/analytics/patients-value/route.ts");
  assert.match(api, /SUM\("balance"\) FILTER \(WHERE "status" <> 'DRAFT' AND "balance" > 0\)/);
  assert.match(api, /WHERE "clinicId" = \$\{clinicId\} AND "status" <> 'CANCELLED'/);
});

test("textos del CRM en es y en", () => {
  for (const l of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${l}.json`));
    assert.equal(typeof d.analytics.crm.actualizadoAhora, "string", l);
    assert.equal(typeof d.analytics.crm.actualizadoHace.other, "string", l);
  }
});
