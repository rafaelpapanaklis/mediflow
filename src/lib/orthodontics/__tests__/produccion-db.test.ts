// Cargador de la producción de ortodoncia (ws1-t5, ronda 6 — filas 88 y 89).
// Con `@/lib/prisma` sustituido: lo que se prueba es QUÉ se le pregunta a la
// base (siempre con el clinicId de quien pregunta, sin facturas canceladas) y
// qué se hace con lo que contesta.
//
//   npx tsx --test --experimental-test-module-mocks src/lib/orthodontics/__tests__/produccion-db.test.ts

import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

interface Llamada { modelo: string; where: any }
const llamadas: Llamada[] = [];
const sql: Array<{ texto: string; valores: unknown[] }> = [];

const base = {
  planes: [] as Array<{ id: string; clinicId: string; invoiceId: string | null; treatingDoctorId: string | null }>,
  ligadas: [] as Array<{ planId: string; invoiceId: string; status: string; clinicId: string }>,
  pagos: [] as Array<{ invoiceId: string; amount: number; method: string; paidAt: Date; invoice: { appointmentId: string | null; clinicId: string; status: string } }>,
  bitacora: [] as Array<{ clinicId: string; entityId: string; createdAt: Date; changes: unknown }>,
  sqlFalla: false,
  bitacoraFalla: false,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: {
        findMany: async ({ where }: any) => {
          llamadas.push({ modelo: "plan", where });
          return base.planes.filter((p) => p.clinicId === where.clinicId);
        },
      },
      payment: {
        findMany: async ({ where }: any) => {
          llamadas.push({ modelo: "payment", where });
          return base.pagos.filter(
            (p) =>
              where.invoiceId.in.includes(p.invoiceId) &&
              p.invoice.clinicId === where.invoice.clinicId &&
              !where.invoice.status.notIn.includes(p.invoice.status) &&
              p.paidAt >= where.paidAt.gte &&
              p.paidAt < where.paidAt.lt,
          );
        },
      },
      auditLog: {
        findMany: async ({ where }: any) => {
          llamadas.push({ modelo: "auditLog", where });
          if (base.bitacoraFalla) throw new Error("sin bitácora");
          return base.bitacora.filter((b) => b.clinicId === where.clinicId && where.entityId.in.includes(b.entityId));
        },
      },
      user: { findMany: async ({ where }: any) => { llamadas.push({ modelo: "user", where }); return []; } },
      $queryRaw: async (cadenas: TemplateStringsArray, ...valores: unknown[]) => {
        sql.push({ texto: cadenas.join("?"), valores });
        if (base.sqlFalla) throw Object.assign(new Error("no existe la columna"), { code: "P2010" });
        return base.ligadas.filter((l) => l.clinicId === valores[0]);
      },
    },
  },
});

const TZ = "America/Mexico_City";
const SEPTIEMBRE = { desde: new Date("2026-09-01T06:00:00Z"), hasta: new Date("2026-10-01T06:00:00Z") };
const factura = (clinicId: string, status = "PARTIAL", appointmentId: string | null = null) => ({ appointmentId, clinicId, status });

beforeEach(() => {
  llamadas.length = 0;
  sql.length = 0;
  base.planes = [
    { id: "plan-ana", clinicId: "norte", invoiceId: "f-ana", treatingDoctorId: "d-luis" },
    { id: "plan-beto", clinicId: "norte", invoiceId: null, treatingDoctorId: "d-ana" },
    { id: "plan-sur", clinicId: "sur", invoiceId: "f-sur", treatingDoctorId: "d-sur" },
  ];
  base.ligadas = [
    { planId: "plan-beto", invoiceId: "f-control", status: "PAID", clinicId: "norte" },
    { planId: "plan-beto", invoiceId: "f-extra", status: "PAID", clinicId: "norte" },
    { planId: "plan-beto", invoiceId: "f-anulada", status: "CANCELLED", clinicId: "norte" },
    { planId: "plan-sur", invoiceId: "f-sur-extra", status: "PAID", clinicId: "sur" },
  ];
  base.pagos = [
    { invoiceId: "f-ana", amount: 3000, method: "cash", paidAt: new Date("2026-09-05T18:00:00Z"), invoice: factura("norte") },
    { invoiceId: "f-ana", amount: 1000, method: "transfer", paidAt: new Date("2026-09-20T18:00:00Z"), invoice: factura("norte") },
    { invoiceId: "f-ana", amount: 400, method: "refund", paidAt: new Date("2026-09-21T18:00:00Z"), invoice: factura("norte") },
    { invoiceId: "f-ana", amount: 9999, method: "cash", paidAt: new Date("2026-08-31T18:00:00Z"), invoice: factura("norte") }, // agosto
    { invoiceId: "f-control", amount: 800, method: "cash", paidAt: new Date("2026-09-10T18:00:00Z"), invoice: factura("norte", "PAID", "cita-1") },
    { invoiceId: "f-extra", amount: 500, method: "cash", paidAt: new Date("2026-09-11T18:00:00Z"), invoice: factura("norte", "PAID") },
    { invoiceId: "f-anulada", amount: 700, method: "cash", paidAt: new Date("2026-09-12T18:00:00Z"), invoice: factura("norte", "CANCELLED") },
    { invoiceId: "f-sur", amount: 50_000, method: "cash", paidAt: new Date("2026-09-12T18:00:00Z"), invoice: factura("sur") },
    { invoiceId: "f-sur-extra", amount: 60_000, method: "cash", paidAt: new Date("2026-09-12T18:00:00Z"), invoice: factura("sur", "PAID") },
  ];
  base.bitacora = [
    { clinicId: "norte", entityId: "plan-ana", createdAt: new Date("2026-09-15T12:00:00Z"), changes: { treatingDoctorId: { before: "d-ana", after: "d-luis" } } },
  ];
  base.sqlFalla = false;
  base.bitacoraFalla = false;
});

describe("cargarPagosDeCasos", () => {
  it("trae los pagos de la factura del tratamiento, de los controles y de los extras; nunca de una cancelada ni de otro mes", async () => {
    const { cargarPagosDeCasos, cargarCasosParaProduccion } = await import("../produccion-db");
    const casos = await cargarCasosParaProduccion("norte");
    const pagos = await cargarPagosDeCasos("norte", casos, SEPTIEMBRE);
    assert.deepEqual(
      pagos.map((p) => `${p.planId}:${p.invoiceId}:${p.amount}:${p.method}`).sort(),
      [
        "plan-ana:f-ana:1000:transfer",
        "plan-ana:f-ana:3000:cash",
        "plan-ana:f-ana:400:refund",
        "plan-beto:f-control:800:cash",
        "plan-beto:f-extra:500:cash",
      ],
    );
    assert.equal(pagos.find((p) => p.invoiceId === "f-control")?.appointmentId, "cita-1");
  });

  it("toda consulta lleva el clinicId de quien pregunta, también el SQL crudo", async () => {
    const { cargarPagosDeCasos, cargarCasosParaProduccion } = await import("../produccion-db");
    const casos = await cargarCasosParaProduccion("norte");
    await cargarPagosDeCasos("norte", casos, SEPTIEMBRE);
    assert.ok(sql.length > 0);
    for (const c of sql) assert.equal(c.valores[0], "norte");
    for (const l of llamadas) {
      if (l.modelo === "plan") assert.equal(l.where.clinicId, "norte");
      if (l.modelo === "payment") {
        assert.equal(l.where.invoice.clinicId, "norte");
        assert.deepEqual(l.where.invoice.status, { notIn: ["CANCELLED"] });
      }
    }
  });

  it("sin clinicId no consulta nada", async () => {
    const { cargarPagosDeCasos, cargarCasosParaProduccion, cargarCambiosDeDoctor } = await import("../produccion-db");
    assert.deepEqual(await cargarCasosParaProduccion(""), []);
    assert.deepEqual(await cargarPagosDeCasos("", [{ planId: "plan-ana", invoiceId: "f-ana", treatingDoctorId: null }], SEPTIEMBRE), []);
    assert.deepEqual(await cargarCambiosDeDoctor("", ["plan-ana"], SEPTIEMBRE.desde), []);
    assert.equal(llamadas.length, 0);
    assert.equal(sql.length, 0);
  });

  it("sin la columna que liga extras y controles, sigue con la factura del tratamiento", async () => {
    base.sqlFalla = true;
    const { cargarPagosDeCasos, cargarCasosParaProduccion } = await import("../produccion-db");
    const pagos = await cargarPagosDeCasos("norte", await cargarCasosParaProduccion("norte"), SEPTIEMBRE);
    assert.deepEqual(pagos.map((p) => p.invoiceId).sort(), ["f-ana", "f-ana", "f-ana"]);
  });
});

describe("ingresosDeCasosSinCitaPorDoctor (fila 89)", () => {
  it("el ortodoncista ya no sale con $0: cuenta lo cobrado de sus casos, por pago y menos reembolsos", async () => {
    const { ingresosDeCasosSinCitaPorDoctor } = await import("../produccion-db");
    const r = await ingresosDeCasosSinCitaPorDoctor("norte", SEPTIEMBRE, TZ);
    // plan-ana: 3000 antes de la reasignación → d-ana; 1000 − 400 después → d-luis.
    // plan-beto (d-ana): el extra de 500 sí; el control de 800 NO (nació de una cita, ya se cuenta por ella).
    assert.deepEqual(Object.fromEntries(r), { "d-ana": 3500, "d-luis": 600 });
  });

  it("no ve nada de otra clínica", async () => {
    const { ingresosDeCasosSinCitaPorDoctor } = await import("../produccion-db");
    const norte = await ingresosDeCasosSinCitaPorDoctor("norte", SEPTIEMBRE, TZ);
    assert.equal(norte.has("d-sur"), false);
    const sur = await ingresosDeCasosSinCitaPorDoctor("sur", SEPTIEMBRE, TZ);
    assert.deepEqual(Object.fromEntries(sur), { "d-sur": 110_000 });
  });

  it("si la bitácora no se puede leer, atribuye al doctor actual en vez de fallar", async () => {
    base.bitacoraFalla = true;
    const { ingresosDeCasosSinCitaPorDoctor } = await import("../produccion-db");
    const r = await ingresosDeCasosSinCitaPorDoctor("norte", SEPTIEMBRE, TZ);
    assert.deepEqual(Object.fromEntries(r), { "d-luis": 3600, "d-ana": 500 });
  });
});
