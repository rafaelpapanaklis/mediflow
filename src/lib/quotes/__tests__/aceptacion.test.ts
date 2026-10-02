/**
 * ACEPTACIÓN PARCIAL Y CARGOS DE UN PRESUPUESTO — reglas puras (ws1-t6).
 *
 * Run: npm run test:presupuesto-aceptacion
 *
 * El caso del cliente (ticket 3 de BEVADENT, precisión 2): «Cotización por
 * $10,000 con aceptación solo de una resina de $1,500 no debe producir deuda
 * por $10,000». Las rutas que lo usan se prueban en
 * src/app/api/quotes/__tests__/aceptacion-parcial.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aceptacionImplicita,
  armarAceptacion,
  cargosDeFacturaVieja,
  conceptosParaFactura,
  elegirConceptos,
  estadoDeCobro,
  netoDe,
  planearCargo,
  repartirProporcional,
  resumirAceptacion,
  type CargoVivo,
} from "@/lib/quotes/aceptacion";
import { invoiceFieldsFromQuote } from "@/lib/quotes/invoice-from-quote-core";

const DIEZ_MIL = {
  discountAmount: 0,
  items: [
    { id: "resina", name: "Resina", toothFdi: "16", quantity: 1, unitPrice: 1500, discount: 0, lineTotal: 1500 },
    { id: "orto", name: "Ortodoncia", toothFdi: null, quantity: 1, unitPrice: 8500, discount: 0, lineTotal: 8500 },
  ],
};
const ETIQ = { etiquetaAbono: "Abono al presupuesto P-0001" };

test("precisión 2: de $10,000 se acepta solo la resina → lo aceptado y lo cargable es $1,500", () => {
  const r = armarAceptacion(DIEZ_MIL, ["resina"]);
  const res = resumirAceptacion(r, 10000);
  assert.equal(res.alcance, "parcial");
  assert.equal(res.total, 1500);
  assert.equal(res.noAceptado, 8500);
  const e = estadoDeCobro(r, []);
  assert.equal(e.porCargar, 1500);
  assert.deepEqual(e.pendientes.map((x) => x.quoteItemId), ["resina"]);
  const plan = planearCargo(r, [], { itemIds: ["resina"], ...ETIQ });
  assert.ok(plan.ok);
  assert.equal(plan.plan.total, 1500);
  // La factura que se crea suma lo mismo que la vista previa.
  assert.equal(invoiceFieldsFromQuote(conceptosParaFactura(plan.plan)).total, 1500);
});

test("lo NO aceptado no se puede cargar", () => {
  const r = armarAceptacion(DIEZ_MIL, ["resina"]);
  const plan = planearCargo(r, [], { itemIds: ["orto"], ...ETIQ });
  assert.equal(plan.ok, false);
  assert.match(plan.error!, /no lo aceptó/);
  // Tampoco por abono: no cabe más que lo aceptado.
  const abono = planearCargo(r, [], { abono: 2000, ...ETIQ });
  assert.equal(abono.ok, false);
});

test("el descuento global se reparte en centavos exactos y en proporción a lo aceptado", () => {
  const p = {
    discountAmount: 100,
    items: [
      { id: "a", name: "A", toothFdi: null, quantity: 1, unitPrice: 333.33 },
      { id: "b", name: "B", toothFdi: null, quantity: 1, unitPrice: 333.33 },
      { id: "c", name: "C", toothFdi: null, quantity: 1, unitPrice: 333.34 },
    ],
  };
  const todo = armarAceptacion(p, ["a", "b", "c"]);
  const suma = todo.reduce((s, r) => s + Math.round(r.descuentoGlobal * 100), 0);
  assert.equal(suma, 10000, "aceptado todo, el descuento entero, ni un centavo más o menos");
  assert.equal(resumirAceptacion(todo, 900).total, 900);
  const uno = armarAceptacion(p, ["a"]);
  assert.equal(resumirAceptacion(uno, 900).descuento, 33.33);
  assert.equal(uno.find((r) => r.quoteItemId === "b")!.descuentoGlobal, 0);
  assert.deepEqual(repartirProporcional(1, [1, 1, 1]).reduce((s, x) => s + x, 0), 1);
});

test("un concepto se carga una sola vez; con su factura cancelada vuelve a «por cargar»", () => {
  const r = armarAceptacion(DIEZ_MIL, ["resina", "orto"]);
  const primero = planearCargo(r, [], { itemIds: ["resina"], ...ETIQ });
  assert.ok(primero.ok);
  const vivos: CargoVivo[] = [{ quoteItemId: "resina", invoiceId: "inv1", monto: 1500 }];
  const otra = planearCargo(r, vivos, { itemIds: ["resina"], ...ETIQ });
  assert.equal(otra.ok, false);
  assert.match(otra.error!, /ya está cargado/);
  // Cancelada = deja de venir en los cargos vivos.
  assert.ok(planearCargo(r, [], { itemIds: ["resina"], ...ETIQ }).ok);
});

test("abono primero y conceptos después: el total cargado nunca pasa de lo aceptado", () => {
  const r = armarAceptacion(DIEZ_MIL, ["resina", "orto"]);
  const abono = planearCargo(r, [], { abono: 3000, ...ETIQ });
  assert.ok(abono.ok);
  assert.equal(abono.plan.lineas[0].tipo, "abono");
  const vivos: CargoVivo[] = [{ quoteItemId: null, invoiceId: "inv1", monto: 3000 }];
  // La resina cabe entera.
  const resina = planearCargo(r, vivos, { itemIds: ["resina"], ...ETIQ });
  assert.ok(resina.ok);
  assert.equal(resina.plan.total, 1500);
  vivos.push({ quoteItemId: "resina", invoiceId: "inv2", monto: 1500 });
  // La ortodoncia ya no: se descuenta lo abonado.
  const orto = planearCargo(r, vivos, { itemIds: ["orto"], ...ETIQ });
  assert.ok(orto.ok);
  assert.equal(orto.plan.total, 5500);
  assert.equal(orto.plan.descontadoDeAbonos, 3000);
  assert.equal(orto.plan.quedaPorCargar, 0);
  assert.equal(invoiceFieldsFromQuote(conceptosParaFactura(orto.plan)).total, 5500);
  vivos.push({ quoteItemId: "orto", invoiceId: "inv3", monto: 5500 });
  const e = estadoDeCobro(r, vivos);
  assert.equal(e.cargado, 10000);
  assert.equal(e.porCargar, 0);
  const otro = planearCargo(r, vivos, { abono: 1, ...ETIQ });
  assert.equal(otro.ok, false);
});

test("un abono mayor a lo que falta se rechaza y dice el máximo", () => {
  const r = armarAceptacion(DIEZ_MIL, ["resina", "orto"]);
  const plan = planearCargo(r, [], { itemIds: ["resina"], abono: 9000, ...ETIQ });
  assert.equal(plan.ok, false);
  assert.match(plan.error!, /8500\.00/);
});

test("sin nada elegido no hay cargo, y un $0 tampoco", () => {
  const r = armarAceptacion(DIEZ_MIL, ["resina"]);
  assert.equal(planearCargo(r, [], { itemIds: [], abono: 0, ...ETIQ }).ok, false);
  const gratis = armarAceptacion(
    { discountAmount: 0, items: [{ id: "x", name: "Revisión", toothFdi: null, quantity: 1, unitPrice: 0 }] },
    ["x"],
  );
  assert.equal(planearCargo(gratis, [], { itemIds: ["x"], ...ETIQ }).ok, false);
});

test("elegirConceptos: sin selección = todos; ids ajenos o vacío = error", () => {
  const items = DIEZ_MIL.items;
  assert.deepEqual(elegirConceptos(items, undefined), { ok: true, ids: ["resina", "orto"] });
  assert.deepEqual(elegirConceptos(items, ["orto", "resina", "orto"]).ids, ["resina", "orto"]);
  assert.equal(elegirConceptos(items, ["otro"]).ok, false);
  assert.equal(elegirConceptos(items, []).ok, false);
  assert.equal(elegirConceptos(items, "resina").ok, false);
});

test("presupuesto viejo: sin renglones se acepta todo; factura vieja = todo cargado", () => {
  const r = aceptacionImplicita({ ...DIEZ_MIL, discountAmount: 500 });
  assert.equal(resumirAceptacion(r, 9500).total, 9500);
  const vivos = cargosDeFacturaVieja(r, "inv-vieja");
  const e = estadoDeCobro(r, vivos);
  assert.equal(e.porCargar, 0);
  assert.equal(e.pendientes.length, 0);
  assert.equal(r.reduce((s, x) => s + netoDe(x), 0), 9500);
});

test("descuento de línea y global juntos: la factura del cargo cuadra con la vista previa", () => {
  const p = {
    discountAmount: 777.77,
    items: [
      { id: "a", name: "Corona", toothFdi: "16", quantity: 1, unitPrice: 4500, discount: 250 },
      { id: "b", name: "Resina", toothFdi: null, quantity: 3, unitPrice: 1250.5, discount: 0 },
      { id: "c", name: "Limpieza", toothFdi: null, quantity: 1, unitPrice: 700, discount: 0 },
    ],
  };
  const r = armarAceptacion(p, ["a", "b"]);
  const plan = planearCargo(r, [], { itemIds: ["a", "b"], ...ETIQ });
  assert.ok(plan.ok);
  assert.equal(invoiceFieldsFromQuote(conceptosParaFactura(plan.plan)).total, plan.plan.total);
  assert.equal(plan.plan.total, resumirAceptacion(r, 0).total);
});
