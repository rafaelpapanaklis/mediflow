/**
 * Seguridad ola 2b · lead 8 — el cierre del excedente de CFDI y los timbres
 * tienen que contar el mes en la MISMA zona.
 *
 * El cron /api/cron/cfdi-overage (07:00 UTC del día 1) cierra los periodos
 * anteriores al mes en curso de CDMX. Los timbres sumaban al periodo calculado
 * en la zona de la CLÍNICA (que edita quien tiene settings.edit). En
 * America/Tijuana (UTC-8 en invierno) o Etc/GMT+12, el mes anterior seguía
 * abierto horas después del cierre: lo timbrado entonces sumaba a una fila ya
 * cobrada (billedAt) y nunca se cobraba.
 *
 * Arreglo: el periodo del cupo es UNO, en la zona del cron (CDMX), para todas
 * las clínicas; `cfdiPeriodFor` ya no recibe zona.
 *
 * Run: npm run test:seg-ola2b
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cfdiPeriodFor } from "../cfdi-quota";

const RAIZ = process.cwd();
const leer = (r: string) => readFileSync(path.join(RAIZ, r), "utf8");

// Media hora después del cierre del cron de diciembre.
const TRAS_EL_CIERRE = new Date("2026-12-01T07:30:00Z");

/**
 * Simulación mínima del contador: el cron cierra todo periodo < el suyo y un
 * timbre suma al periodo que calcula la ruta de timbrado.
 */
function excedentePerdido(periodoDelTimbre: (d: Date) => string): number {
  const filas = new Map<string, { stamped: number; billedAt: Date | null }>();
  filas.set("2026-11", { stamped: 30, billedAt: null });
  const delCron = cfdiPeriodFor(TRAS_EL_CIERRE);
  for (const [period, f] of Array.from(filas)) if (period < delCron && !f.billedAt) f.billedAt = TRAS_EL_CIERRE;
  // Un timbre más, media hora después del cierre.
  const p = periodoDelTimbre(TRAS_EL_CIERRE);
  const f = filas.get(p) ?? { stamped: 0, billedAt: null };
  f.stamped += 1;
  filas.set(p, f);
  // Lo que ya no se cobrará nunca: timbres que cayeron en una fila cerrada.
  return p < delCron && filas.get(p)!.billedAt ? 1 : 0;
}

test("el cron cierra noviembre a las 07:00 UTC del 1 de diciembre (01:00 en CDMX)", () => {
  assert.equal(cfdiPeriodFor(TRAS_EL_CIERRE), "2026-12");
  assert.equal(cfdiPeriodFor(new Date("2026-12-01T05:59:00Z")), "2026-11");
});

test("🔴 ningún timbre cae en un periodo ya cerrado, sea cual sea la zona de la clínica", () => {
  // Lo que hacen HOY las rutas de timbrado: el periodo con la zona de la clínica.
  const { cfdiPeriodFor: f } = { cfdiPeriodFor } as { cfdiPeriodFor: (d: Date, tz?: string) => string };
  for (const tz of ["America/Tijuana", "Etc/GMT+12", "America/Mexico_City", "America/Cancun"]) {
    assert.equal(excedentePerdido((d) => f(d, tz)), 0, `zona ${tz}`);
  }
});

test("🔴 las rutas que cuentan timbres no pasan la zona de la clínica", () => {
  for (const r of [
    "src/app/api/cfdi/route.ts",
    "src/app/api/payments/[id]/cfdi/route.ts",
    "src/lib/invoices/cfdi-cancelacion.server.ts",
    "src/app/api/cfdi/usage/route.ts",
    "src/lib/admin/uso-clinica.ts",
    "src/app/api/cron/cfdi-overage/route.ts",
  ]) {
    const src = leer(r);
    const llamadas = src.match(/cfdiPeriodFor\([^)]*\)/g) ?? [];
    assert.ok(llamadas.length > 0, `${r} usa cfdiPeriodFor`);
    for (const ll of llamadas) assert.doesNotMatch(ll, /,/, `${r}: ${ll} — el periodo del cupo no lleva zona`);
  }
});
