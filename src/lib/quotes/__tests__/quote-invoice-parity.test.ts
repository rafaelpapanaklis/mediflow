/**
 * Hallazgo 15 — el presupuesto que firma el paciente y la factura que se cobra
 * y se timbra tienen que salir por el MISMO importe.
 *
 * Run: npm run test:quote-parity
 *
 * El presupuesto acota el importe de línea con `Math.max(0, …)` y la factura
 * derivada NO tiene ese piso (itemLineTotal), así que un precio unitario
 * NEGATIVO —la forma natural de meter "Descuento cortesía −$300" a mano— valía
 * 0 en el presupuesto y −$300 en la factura: se cobraba y se timbraba menos de
 * lo firmado. La ruta de presupuesto era una puerta trasera al
 * `z.number().min(0)` que POST /api/invoices sí exige.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotals } from "../compute";
import { invoiceFieldsFromQuote } from "../invoice-from-quote-core";
import type { QuoteItemInput } from "../types";

/**
 * Lo que de verdad se guarda en QuoteItem: `buildItemsData` (service.ts) escribe
 * la SALIDA de computeTotals, y es esa fila la que después lee
 * invoiceFieldsFromQuote. Encadenar los dos aquí es el camino real de los datos.
 */
function facturaDelPresupuesto(items: QuoteItemInput[], discountAmount: number | null = null) {
  const quote = computeTotals(items, { discountPct: null, discountAmount });
  const invoice = invoiceFieldsFromQuote({
    discountAmount: quote.discountAmount,
    items: quote.items.map((it) => ({
      name: it.name,
      toothFdi: it.toothFdi ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: it.discount,
    })),
  });
  return { quote, invoice };
}

test("«Descuento cortesía −$300» no puede dejar la factura por debajo de lo firmado", () => {
  const { quote, invoice } = facturaDelPresupuesto([
    { name: "Corona", quantity: 1, unitPrice: 1000 },
    { name: "Descuento cortesía", quantity: 1, unitPrice: -300 },
  ]);
  assert.equal(quote.total, 1000);      // lo que firma el paciente
  assert.equal(invoice.total, 1000);    // antes: 700 → se timbraban $300 de menos
  assert.equal(invoice.subtotal, quote.subtotal);
});

test("ningún precio unitario negativo llega a la línea (mismo piso que POST /api/invoices)", () => {
  const { quote } = facturaDelPresupuesto([{ name: "Ajuste", quantity: 2, unitPrice: -50 }]);
  assert.equal(quote.items[0].unitPrice, 0);
  assert.equal(quote.items[0].lineTotal, 0);
  assert.equal(quote.total, 0);
});

test("el descuento de VERDAD sigue funcionando, por línea y global", () => {
  const porLinea = facturaDelPresupuesto([{ name: "Corona", quantity: 1, unitPrice: 1000, discount: 300 }]);
  assert.equal(porLinea.quote.total, 700);
  assert.equal(porLinea.invoice.total, 700);
  assert.equal(porLinea.invoice.items[0].discount, 300);

  const global = facturaDelPresupuesto([{ name: "Corona", quantity: 1, unitPrice: 1000 }], 300);
  assert.equal(global.quote.total, 700);
  assert.equal(global.invoice.total, 700);
  assert.equal(global.invoice.discount, 300);
});

test("presupuesto normal de varias líneas: presupuesto y factura coinciden al centavo", () => {
  const { quote, invoice } = facturaDelPresupuesto([
    { name: "Endodoncia", quantity: 1, unitPrice: 3500.5 },
    { name: "Resina", quantity: 3, unitPrice: 899.99, discount: 100 },
    { name: "Limpieza", quantity: 1, unitPrice: 650 },
  ], 250);
  assert.equal(quote.total, invoice.total);
  assert.equal(quote.subtotal, invoice.subtotal);
  assert.equal(quote.discountAmount, invoice.discount);
});
