/**
 * Presupuestos: el abono de «Se cobrará hoy» es un PAGO, no un descuento
 * escondido (decisión de Rafael, 4-oct-2026; F1 de la auditoría final de
 * cobros, ws1-t6) — ws1-t5.
 *
 * Run: npm run test:presupuesto-abono-pago
 *
 * El caso de la auditoría: P-0027 con M12a Limpieza $500 y M12b Resina $700.
 *   Antes: «M12a + abono $200» → MF-1188 $700 (Limpieza + «Abono al presupuesto»);
 *          «Cargar más» M12b → MF-1189 con el renglón 1 × $700 = $500: el
 *          comprobante lo imprimía así y cfdiCuadre daba ok:false (700 vs 500).
 *   Ahora: M12a → factura de $500; el abono → PAGO de $200 a la factura de M12b,
 *          creada a su precio completo ($700): «Pagado $200 · Saldo $500».
 *          Las dos cuadran para timbrar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { armarAceptacion, conceptosParaFactura, planearCargo, type CargoVivo } from "@/lib/quotes/aceptacion";
import { invoiceFieldsFromQuote } from "@/lib/quotes/invoice-from-quote-core";
import { cfdiCuadre } from "@/lib/invoices/cfdi-cuadre";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const P0027 = {
  discountAmount: 0,
  items: [
    { id: "m12a", name: "M12a Limpieza", toothFdi: null, quantity: 1, unitPrice: 500 },
    { id: "m12b", name: "M12b Resina", toothFdi: "16", quantity: 1, unitPrice: 700 },
  ],
};

const cuadra = (lineas: Parameters<typeof conceptosParaFactura>[0]["lineas"]) => {
  const f = invoiceFieldsFromQuote(conceptosParaFactura({ lineas, total: 0, descontadoDeAbonos: 0, abono: null, abonoViejo: 0, quedaPorCargar: 0 }));
  return { f, c: cfdiCuadre({ items: f.items as any[], discount: f.discount, total: f.total, taxMode: "exento", taxIncluded: true }) };
};

test("F1 · M12a hoy + abono $200: factura de $500 y la de M12b a precio completo ($700) con el pago de $200; las dos cuadran", () => {
  const r = armarAceptacion(P0027, ["m12a", "m12b"]);
  const plan = planearCargo(r, [], { itemIds: ["m12a"], abono: 200 });
  assert.ok(plan.ok, plan.error);
  // La factura de hoy: solo la limpieza, $500.
  const hoy = cuadra(plan.plan.lineas);
  assert.equal(hoy.f.total, 500);
  assert.ok(hoy.c.ok, "MF-1188 nueva cuadra");
  // El abono: a M12b (el único pendiente), creada a $700, con $200 de PAGO.
  assert.equal(plan.plan.abono?.quoteItemId, "m12b");
  assert.equal(plan.plan.abono?.monto, 200);
  const b = cuadra([plan.plan.abono!.linea!]);
  assert.equal(b.f.total, 700, "precio completo");
  assert.equal(b.f.discount, 0, "sin descuento escondido");
  assert.ok(b.c.ok, `la factura de M12b cuadra (cfdiTotal ${b.c.cfdiTotal} = total ${b.c.invoiceTotal})`);
  const item = b.f.items[0] as any;
  assert.equal(item.quantity * item.unitPrice, 700, "cantidad × precio = importe");
  assert.equal(plan.plan.quedaPorCargar, 0, "las dos quedan cargadas: $500 + $700 = lo aceptado");
  // Saldo de M12b tras el pago: $500 («le faltan $500 ya en la segunda cita»).
  assert.equal(b.f.total - plan.plan.abono!.monto, 500);
});

test("F1 · el caso viejo de la auditoría: con un abono de ANTES, «Cargar más» M12b sale a $700 completo (no 1 × $700 = $500) y el abono va como pago", () => {
  const r = armarAceptacion(P0027, ["m12a", "m12b"]);
  const vivos: CargoVivo[] = [
    { quoteItemId: "m12a", invoiceId: "mf1188", monto: 500 },
    { quoteItemId: null, invoiceId: "mf1188", monto: 200 },
  ];
  const plan = planearCargo(r, vivos, { itemIds: ["m12b"] });
  assert.ok(plan.ok);
  const b = cuadra(plan.plan.lineas);
  assert.equal(b.f.total, 700);
  assert.ok(b.c.ok, "MF-1189 nueva cuadra: antes ok:false, cfdiTotal 700 contra total 500");
  assert.equal(plan.plan.abonoViejo, 200, "los $200 de antes se aplican como pago (saldo a favor), no como descuento");
});

test("servidor · el abono registra un Payment con método real en la factura del concepto y pide método; el viejo, por saldo a favor y solo si ya se cobró", () => {
  const srv = leer("src/lib/quotes/cargos.server.ts");
  assert.match(srv, /if \(plan\.plan\.abono && !args\.pago\) throw new PresupuestoError\("Di con qué pagó el abono/);
  assert.match(srv, /await tx\.payment\.create\(\{\s*data: \{\s*invoiceId: destino\.id,\s*amount: ab\.monto,\s*method: args\.pago\.method/);
  assert.match(srv, /source: FUENTE_ABONO_PRESUPUESTO/);
  assert.match(srv, /todavía no está cobrado: cóbralo o cancélalo/);
  assert.doesNotMatch(leer("src/lib/quotes/aceptacion.ts"), /anticipoAplicado: pesos\(extras\[i\]\)/, "ya no se resta el abono del siguiente concepto");
  const ruta = leer("src/app/api/quotes/[id]/cargos/route.ts");
  assert.match(ruta, /denyIfMissingPermission\(ctx, "billing\.charge"\)/, "abonar es cobrar");
  assert.match(ruta, /method === "transfer" && !referencia/);
});

test("el abono de antes NO cuenta como ingreso otra vez (su fuente no es de las que son ingreso)", async () => {
  const { FUENTES_CREDITO_QUE_SON_INGRESO } = await import("@/lib/dinero/reembolsos");
  assert.ok(!(FUENTES_CREDITO_QUE_SON_INGRESO as readonly string[]).includes("abono_presupuesto"));
  assert.ok(!(FUENTES_CREDITO_QUE_SON_INGRESO as readonly string[]).includes("excedente_de_cobro"));
});
