/**
 * La historia migrada ya no se corre un día (ws1-t2, auditoría de uso del
 * 3/4-oct-2026, C-20; t2 M4).
 *
 * Run: npm run test:dinero-fecha-historia
 *
 * Los pagos importados se guardaron a la medianoche del servidor (04:00 UTC
 * en este, 00:00 UTC en Vercel): en la Ciudad de México caen el día anterior.
 * El «Abono limpieza» del 1-ago contaba en julio, y Finanzas de agosto decía
 * «$3,750 cobrados en tu sistema anterior» cuando en agosto había $4,250. Con
 * el código viejo falla: `fecha-de-historia.ts` no existía y
 * `historiaMigradaDelPeriodo` filtraba por el instante.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { fechaDeHistoria, ventanaDeHistoria } from "@/lib/dinero/fecha-de-historia";
import { historiaMigradaDelPeriodo } from "@/lib/dinero/ingresos.server";
import { startOfMonthMx } from "@/lib/finanzas-periodo";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const TZ = "America/Mexico_City";

// Agosto de Finanzas: del 1-ago 00:00 de México al 31-ago 23:59:59.999 (inclusive).
const AGO = { gte: startOfMonthMx(new Date("2026-08-15T12:00:00Z")), lte: new Date(startOfMonthMx(new Date("2026-08-15T12:00:00Z"), 1).getTime() - 1) };

// La siembra del reporte: migrated_payments $2,850 en agosto + una fila de payments «migrated» de $1,400.
const MIGRADOS = [
  { clinicId: "cl", amount: 500, paidAt: new Date("2026-08-01T04:00:00Z") }, // «Abono limpieza» 1-ago (medianoche de NY)
  { clinicId: "cl", amount: 2000, paidAt: new Date("2026-08-15T04:00:00Z") },
  { clinicId: "cl", amount: 350, paidAt: new Date("2026-08-31T00:00:00Z") }, // medianoche UTC (Vercel)
  { clinicId: "cl", amount: 999, paidAt: new Date("2026-07-31T04:00:00Z") }, // julio
  { clinicId: "cl", amount: 777, paidAt: new Date("2026-09-01T12:00:00Z") }, // septiembre (ya a mediodía)
  { clinicId: "otra", amount: 50_000, paidAt: new Date("2026-08-10T04:00:00Z") },
];
const PAGOS_MIGRATED = [{ amount: 1400, paidAt: new Date("2026-08-01T04:00:00Z"), clinicId: "cl" }];

const dentro = (d: Date, w: { gte?: Date; lte?: Date; lt?: Date }) =>
  (!w.gte || d >= w.gte) && (!w.lte || d <= w.lte) && (!w.lt || d < w.lt);

function dbDoble() {
  const vistas: any[] = [];
  return {
    vistas,
    $queryRaw: async () => [{ existe: true }],
    payment: {
      aggregate: async ({ where }: any) => {
        vistas.push(where.paidAt);
        const s = PAGOS_MIGRATED.filter((p) => p.clinicId === where.invoice.clinicId && dentro(p.paidAt, where.paidAt)).reduce((a, p) => a + p.amount, 0);
        return { _sum: { amount: s } };
      },
    },
    migratedPayment: {
      aggregate: async ({ where }: any) => {
        vistas.push(where.paidAt);
        const s = MIGRADOS.filter((p) => p.clinicId === where.clinicId && dentro(p.paidAt, where.paidAt)).reduce((a, p) => a + p.amount, 0);
        return { _sum: { amount: s } };
      },
    },
  };
}

test("C-20: agosto suma lo migrado de agosto ($4,250), no lo corre a julio", async () => {
  // Lo que hacía antes: filtrar por el instante (el abono del 1-ago y la fila «migrated» se iban a julio).
  const viejo = MIGRADOS.filter((p) => p.clinicId === "cl" && dentro(p.paidAt, AGO)).reduce((a, p) => a + p.amount, 0)
    + PAGOS_MIGRATED.filter((p) => dentro(p.paidAt, AGO)).reduce((a, p) => a + p.amount, 0);
  assert.equal(viejo, 2350);
  const db = dbDoble();
  assert.equal(await historiaMigradaDelPeriodo("cl", AGO, db), 4250);
  // Las dos lecturas usan la ventana por día de calendario.
  for (const w of db.vistas) assert.deepEqual(w, { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date("2026-09-01T00:00:00Z") });
});

test("C-20: la ventana de días sale del calendario de la clínica (fin inclusivo o exclusivo)", () => {
  assert.deepEqual(ventanaDeHistoria(AGO, TZ), { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date("2026-09-01T00:00:00Z") });
  const exclusivo = { gte: new Date("2026-08-01T06:00:00Z"), lt: new Date("2026-09-01T06:00:00Z") };
  assert.deepEqual(ventanaDeHistoria(exclusivo, TZ), { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date("2026-09-01T00:00:00Z") });
  // «Este mes» hasta ahora (3-oct 23:10 en México): entra el 3 entero.
  assert.deepEqual(
    ventanaDeHistoria({ gte: new Date("2026-10-01T06:00:00Z"), lte: new Date("2026-10-04T05:10:00Z") }, TZ),
    { gte: new Date("2026-10-01T00:00:00Z"), lt: new Date("2026-10-04T00:00:00Z") },
  );
  // Sin inicio no se toca.
  const sinInicio = { lte: new Date("2026-08-31T00:00:00Z") };
  assert.equal(ventanaDeHistoria(sinInicio, TZ), sinInicio);
});

test("C-20: la ficha pinta el pago migrado en su día; el importador guarda el mediodía UTC", () => {
  const d = fechaDeHistoria(new Date("2026-08-01T04:00:00Z"));
  assert.equal(d.toISOString(), "2026-08-01T12:00:00.000Z");
  assert.equal(d.toLocaleDateString("es-MX", { timeZone: TZ, day: "numeric", month: "long" }), "1 de agosto");
  assert.match(leer("src/lib/import/pagos-historial/handler.ts"), /paidAt: calendarNoonUtc\(fecha!\)/);
  const lector = leer("src/lib/import/pagos-historial/leer.ts");
  assert.match(lector, /paidAt: fechaDeHistoria\(r\.paidAt\)\.toISOString\(\)/);
  assert.match(lector, /where: \{ id: \{ in: doctorIds \}, clinicId \}/, "los nombres de doctor, solo de esta clínica");
});
