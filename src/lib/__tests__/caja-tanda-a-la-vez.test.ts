/**
 * Login rápido (28-oct) — `computeReceivables` lee a la vez, por tanda, las condiciones de pago, las
 * notas de plan y los casos de ortodoncia «Precio total» (antes, una tras otra: 2–4 idas más en el
 * camino de «Hoy», Caja y Finanzas). Las cifras no cambian: las fijan caja-dinero, plan-por-cobrar y
 * las demás suites de por cobrar; aquí, el orden y que un lector que falla no tumba a los otros.
 *
 * Run: npm run test:caja-dinero
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReceivables } from "../caja";

const FACTURAS = [
  { id: "f1", balance: 1_000, total: 1_000, dueDate: new Date("2026-01-01T06:00:00Z"), createdAt: new Date("2025-12-01T06:00:00Z") },
  { id: "f2", balance: 2_000, total: 2_000, dueDate: new Date("2026-03-01T06:00:00Z"), createdAt: new Date("2025-12-01T06:00:00Z") },
  { id: "f3", balance: 300, total: 300, dueDate: new Date("2026-01-15T06:00:00Z"), createdAt: new Date("2025-12-01T06:00:00Z") },
];

const pausa = () => new Promise((ok) => setTimeout(ok, 5));

function escenario(opts: { ortoFalla?: boolean } = {}) {
  const eventos: string[] = [];
  const db = {
    invoice: {
      findMany: async ({ where, take }: any) => {
        const despues = (where.AND ?? []).find((c: any) => c.id?.gt)?.id.gt;
        return FACTURAS.filter((f) => !despues || f.id > despues).slice(0, take);
      },
    },
    clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
    $queryRaw: async (cadenas: TemplateStringsArray) => {
      if (/to_regclass|information_schema/.test(cadenas.join("?"))) return [{ existe: true, reg: "invoice_payment_terms" }];
      eventos.push("empieza:condiciones");
      await pausa();
      eventos.push("termina:condiciones");
      return [];
    },
  };
  const opciones = {
    pagina: 2,
    leerNotasDePlan: async () => {
      eventos.push("empieza:plan");
      await pausa();
      eventos.push("termina:plan");
      return new Map();
    },
    leerPrincipalesPrecioTotal: async () => {
      eventos.push("empieza:orto");
      await pausa();
      eventos.push("termina:orto");
      if (opts.ortoFalla) throw new Error("sin columna billingMode");
      return new Set<string>();
    },
  };
  return { db: db as any, opciones, eventos };
}

test("🔴 por tanda, condiciones, notas de plan y ortodoncia empiezan las tres antes de que termine ninguna", async () => {
  const { db, opciones, eventos } = escenario();
  const s = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map(), opciones);
  // Dos tandas (página de 2 con 3 facturas): en cada una, primero los tres arranques.
  const tandas = [eventos.slice(0, 6), eventos.slice(6, 12)];
  assert.equal(eventos.length, 12, eventos.join(" "));
  for (const t of tandas) {
    assert.deepEqual(t.slice(0, 3).sort(), ["empieza:condiciones", "empieza:orto", "empieza:plan"], t.join(" "));
  }
  assert.equal(s.porCobrar, 3_300);
  assert.equal(s.vencido, 1_300);
  assert.deepEqual(s.vencidoPorFactura, { f1: 1_000, f3: 300 });
});

test("si la ortodoncia no se puede leer, las facturas cuentan completas, como antes", async () => {
  const { db, opciones } = escenario({ ortoFalla: true });
  const s = await computeReceivables("cl-1", new Date("2026-02-10T18:00:00Z"), db, async () => new Map(), opciones);
  assert.equal(s.porCobrar, 3_300);
  assert.equal(s.vencido, 1_300);
});
