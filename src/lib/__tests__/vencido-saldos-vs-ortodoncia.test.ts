/**
 * «Vencido» de Finanzas › Saldos contra Finanzas › Ortodoncia (ws1-t2, F9 de la auditoría
 * BEVADENT: «Saldos: Vencido $0» y «Ortodoncia: Vencido $5,000» el mismo día).
 *
 * Run: npm run test:vencido-saldos-orto
 *
 * La causa: la COLOCACIÓN de un caso en «Pago por control» nace sin `dueDate`. Ortodoncia la
 * da por vencida desde el día en que se creó (`vencimientoDeFacturaPrincipal`); Caja y Finanzas
 * (`computeReceivables`), sin `dueDate`, nunca la contaban. Con el código viejo la prueba de
 * `computeReceivables` da 0.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const HOY = new Date("2026-10-02T18:00:00.000Z"); // 12:00 en Ciudad de México
const db = {
  columnaModoCobro: true,
  columnaCargos: false,
  colocaciones: [] as Array<{ invoiceId: string; dueDate: Date | null; createdAt: Date; zona: string | null }>,
  facturas: [] as Array<{ id: string; clinicId: string; balance: number; dueDate: Date | null; total: number }>,
};

const prismaStub: any = {
  $queryRaw: async (sql: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = sql.join("?");
    if (/information_schema/.test(texto) && /billingMode/.test(texto)) return [{ existe: db.columnaModoCobro }];
    if (/information_schema/.test(texto) && /orthodonticTreatmentPlanId/.test(texto)) return [{ existe: db.columnaCargos }];
    if (/information_schema|to_regclass/.test(texto)) return [{ existe: false, t: null }];
    if (/FROM "orthodontic_treatment_plans" p/.test(texto)) {
      assert.ok(valores.includes("c1"), "las colocaciones se leen SIEMPRE con el clinicId");
      assert.match(texto, /"billingMode" = 'PAGO_POR_CONTROL'/);
      assert.match(texto, /"deletedAt" IS NULL/);
      return db.colocaciones;
    }
    return [];
  },
  invoice: {
    findMany: async ({ where }: any) => db.facturas.filter((f) => f.clinicId === where.clinicId && f.balance > 0)
      .map(({ id, balance, dueDate, total }) => ({ id, balance, dueDate, total })),
    aggregate: async () => ({ _sum: {} }),
  },
  clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
};
(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });

function reiniciar() {
  db.columnaModoCobro = true;
  db.columnaCargos = false;
  db.colocaciones = [];
  db.facturas = [];
}

test("la colocación de «Pago por control» sin fecha vence en Caja desde el día en que se creó", async () => {
  reiniciar();
  db.colocaciones.push({ invoiceId: "col1", dueDate: null, createdAt: new Date("2026-09-20T17:00:00.000Z"), zona: "America/Mexico_City" });
  const { cargarVencimientosDeCargosDeControl } = await import("@/lib/orthodontics/cobranza-controles-db");
  const mapa = await cargarVencimientosDeCargosDeControl("c1");
  assert.equal(mapa.get("col1"), "2026-09-20");
});

test("computeReceivables: Saldos › Vencido incluye la colocación vencida (antes daba 0)", async () => {
  reiniciar();
  db.colocaciones.push({ invoiceId: "col1", dueDate: null, createdAt: new Date("2026-09-20T17:00:00.000Z"), zona: "America/Mexico_City" });
  db.facturas.push(
    { id: "col1", clinicId: "c1", balance: 5000, dueDate: null, total: 5000 },
    { id: "otra", clinicId: "c1", balance: 700, dueDate: null, total: 700 }, // sin fecha: no vence
  );
  const { computeReceivables } = await import("@/lib/caja");
  const saldos = await computeReceivables("c1", HOY);
  assert.equal(saldos.porCobrar, 5700);
  assert.equal(saldos.vencido, 5000);
  assert.deepEqual(saldos.vencidoPorFactura, { col1: 5000 });
});

test("una colocación creada HOY todavía no vence (mismo «<» que Ortodoncia)", async () => {
  reiniciar();
  db.colocaciones.push({ invoiceId: "col2", dueDate: null, createdAt: new Date("2026-10-02T15:00:00.000Z"), zona: "America/Mexico_City" });
  db.facturas.push({ id: "col2", clinicId: "c1", balance: 3000, dueDate: null, total: 3000 });
  const { computeReceivables } = await import("@/lib/caja");
  const saldos = await computeReceivables("c1", HOY);
  assert.equal(saldos.vencido, 0);
});

test("sin sql/ortodoncia-modo-cobro.sql no se consulta la tabla de casos y Caja queda como antes", async () => {
  reiniciar();
  db.columnaModoCobro = false;
  db.colocaciones.push({ invoiceId: "col1", dueDate: null, createdAt: new Date("2026-09-20T17:00:00.000Z"), zona: null });
  const { _olvidarColumnaModoCobro } = await import("@/lib/orthodontics/billing-mode-db");
  _olvidarColumnaModoCobro();
  const { cargarVencimientosDeCargosDeControl } = await import("@/lib/orthodontics/cobranza-controles-db");
  const mapa = await cargarVencimientosDeCargosDeControl("c1");
  assert.equal(mapa.size, 0);
  _olvidarColumnaModoCobro();
});
