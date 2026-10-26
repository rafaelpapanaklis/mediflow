/**
 * «Cerrar plan» al centavo (revisión t5, A6): con descuento global y por línea, con IVA incluido o
 * aparte, 3,000 notas al azar. Pruebas de t5 (`a-cerrar-fuzz`, `a-cerrar-pagado-justo`), ahora
 * como candado: antes 177 y 190 notas quedaban a ±1¢ de lo «Hecho» prometido.
 *
 * Run: npm run test:plan-por-cobrar
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deudaDeNotaDelPlan } from "@/lib/treatments/por-cobrar";
import { ajustarNotaAlCerrar } from "@/lib/treatments/cerrar-plan";
import { computeInvoiceTotal } from "@/lib/invoice-totals";

function notasAlAzar(semilla: number, cuantas: number) {
  let seed = semilla;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const salida: Array<{ nota: any; filas: Map<string, any> }> = [];
  for (let k = 0; k < cuantas; k++) {
    const n = 1 + Math.floor(rnd() * 6);
    const filas = new Map<string, any>();
    const items = Array.from({ length: n }, (_, i) => {
      const id = "f" + i;
      const hecho = rnd() < 0.5;
      filas.set(id, { id, estado: hecho ? "hecho" : "pendiente", hechoEn: hecho ? new Date("2026-09-01") : null });
      const it: any = { name: "P" + i, quantity: 1 + Math.floor(rnd() * 3), unitPrice: Math.round(rnd() * 300000) / 100, planItemId: id };
      if (rnd() < 0.4) it.discount = Math.round(rnd() * it.unitPrice * 50) / 100;
      return it;
    });
    const sub = items.reduce((s, it) => s + it.quantity * it.unitPrice - (it.discount || 0), 0);
    const discount = rnd() < 0.5 ? Math.round(rnd() * sub * 30) / 100 : 0;
    const taxIncluded = rnd() < 0.5;
    const total = computeInvoiceTotal(items, discount, 16, taxIncluded).total;
    const nota = { id: "n", total, paid: Math.round(rnd() * total * 100) / 100, createdAt: new Date("2026-08-01"), items, discount, taxRate: 16, taxIncluded };
    salida.push({ nota, filas });
  }
  return salida;
}

test("cerrar (fuzz t5): el total nuevo es el «Hecho» prometido, al centavo", () => {
  const malos: unknown[] = [];
  for (const { nota, filas } of notasAlAzar(7, 3000)) {
    const d = deudaDeNotaDelPlan(nota, filas, null);
    const a = ajustarNotaAlCerrar(nota, filas);
    if (!a) continue;
    const esperado = a.items.length ? d.hecho : 0;
    if (Math.abs(a.total - esperado) > 0.005) malos.push({ hecho: d.hecho, nuevo: a.total });
  }
  assert.deepEqual(malos.slice(0, 3), []);
});

test("cerrar (fuzz t5): quien pagó EXACTAMENTE lo hecho queda PAGADA, sin centavo a favor", () => {
  const malos: unknown[] = [];
  for (const { nota, filas } of notasAlAzar(7, 3000)) {
    nota.paid = deudaDeNotaDelPlan(nota, filas, null).hecho;
    const a = ajustarNotaAlCerrar(nota, filas);
    if (!a || !a.items.length) continue;
    if (a.status !== "PAID" || a.aFavor > 0 || a.balance > 0) malos.push({ status: a.status, aFavor: a.aFavor, balance: a.balance });
  }
  assert.deepEqual(malos.slice(0, 3), []);
});

test("cerrar (fuzz): el descuento que se queda es la parte de las líneas que se quedan, y la nota se puede recalcular", () => {
  let lejos = 0;
  for (const { nota, filas } of notasAlAzar(11, 3000)) {
    const a = ajustarNotaAlCerrar(nota, filas);
    if (!a || !a.items.length) continue;
    assert.ok(a.discount >= 0 && a.discount <= a.subtotal + 0.005);
    // El editor de facturas recalcula con su propio reparto: a lo más unos centavos de IVA por línea.
    const recalculado = computeInvoiceTotal(a.items, a.discount, nota.taxRate, nota.taxIncluded).total;
    if (Math.abs(recalculado - a.total) > 0.005 * (a.items.length + 1)) lejos++;
  }
  assert.equal(lejos, 0);
});
