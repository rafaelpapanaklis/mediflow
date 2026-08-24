// FIN-05 — editar un presupuesto regenera su factura BORRADOR con la MISMA
// aritmética con la que nació, y una factura confirmada o con pagos bloquea
// la edición con un mensaje que nombra la factura y dice qué hacer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideLinkedInvoiceLock,
  invoiceFieldsFromQuote,
  quoteInvoiceLockedMessage,
} from "../invoice-from-quote-core";

const item = (unitPrice: number, extra: Partial<{ quantity: number; discount: number; toothFdi: string | null; name: string }> = {}) => ({
  name: extra.name ?? "Ortodoncia",
  toothFdi: extra.toothFdi ?? null,
  quantity: extra.quantity ?? 1,
  unitPrice,
  discount: extra.discount ?? 0,
});

test("el presupuesto que sube de $10,000 a $18,000 regenera la factura en $18,000", () => {
  const before = invoiceFieldsFromQuote({ discountAmount: 0, items: [item(10000)] });
  const after  = invoiceFieldsFromQuote({ discountAmount: 0, items: [item(18000)] });
  assert.equal(before.total, 10000);
  assert.equal(after.total, 18000);
  assert.equal(after.subtotal, 18000);
  assert.equal(after.items[0].total, 18000);
  assert.equal(after.items[0].description, "Ortodoncia");
});

test("la aritmética es la misma que la del alta: total = Σ(qty × unitPrice − desc. línea) − descuento", () => {
  const f = invoiceFieldsFromQuote({
    discountAmount: 150,
    items: [item(1200, { quantity: 2, discount: 100, toothFdi: "11,12" }), item(499.99, { name: "Limpieza" })],
  });
  assert.equal(f.items[0].description, "Ortodoncia (11,12)");
  assert.equal(f.items[0].discount, 100);
  assert.equal(f.items[0].total, 2300);
  assert.equal(f.items[1].discount, undefined); // sin descuento no viaja la llave
  assert.equal(f.subtotal, 2799.99);
  assert.equal(f.discount, 150);
  assert.equal(f.total, 2649.99);
});

test("descuento de línea y global se acotan al importe (regla SAT), cantidad inválida cae a 1", () => {
  const f = invoiceFieldsFromQuote({
    discountAmount: 99999,
    items: [item(500, { quantity: -3, discount: 5000 })],
  });
  assert.equal(f.items[0].quantity, 1);
  assert.equal(f.items[0].discount, 500);
  assert.equal(f.items[0].total, 0);
  assert.equal(f.subtotal, 0);
  assert.equal(f.discount, 0);
  assert.equal(f.total, 0);
});

test("acepta Decimal-like (Prisma) en unitPrice/discount/discountAmount", () => {
  const dec = (v: number) => ({ toString: () => String(v), valueOf: () => v });
  const f = invoiceFieldsFromQuote({
    discountAmount: dec(50),
    items: [{ name: "Corona", toothFdi: null, quantity: 1, unitPrice: dec(3500), discount: dec(0) }],
  });
  assert.equal(f.total, 3450);
});

test("solo un BORRADOR sin pagos se regenera; lo demás bloquea con la causa correcta", () => {
  assert.equal(decideLinkedInvoiceLock({ invoiceNumber: "F-0012", status: "DRAFT", paid: 0, paymentsCount: 0 }), null);
  assert.deepEqual(
    decideLinkedInvoiceLock({ invoiceNumber: "F-0012", status: "PENDING", paid: 0, paymentsCount: 0 }),
    { invoiceNumber: "F-0012", status: "PENDING", reason: "not-draft" },
  );
  assert.deepEqual(
    decideLinkedInvoiceLock({ invoiceNumber: "F-0012", status: "PARTIAL", paid: 2000, paymentsCount: 1 }),
    { invoiceNumber: "F-0012", status: "PARTIAL", reason: "has-payments" },
  );
  // Un borrador con un pago colado (o con paid > 0) también bloquea.
  assert.equal(decideLinkedInvoiceLock({ invoiceNumber: "F-0012", status: "DRAFT", paid: 0, paymentsCount: 1 })?.reason, "has-payments");
  assert.equal(decideLinkedInvoiceLock({ invoiceNumber: "F-0012", status: "DRAFT", paid: 10, paymentsCount: 0 })?.reason, "has-payments");
});

test("el 409 nombra la factura, la causa y la salida", () => {
  const conPagos = quoteInvoiceLockedMessage({ invoiceNumber: "F-0012", status: "PARTIAL", reason: "has-payments" });
  assert.match(conPagos, /F-0012/);
  assert.match(conPagos, /pagos registrados/);
  assert.match(conPagos, /Facturación/);
  const confirmada = quoteInvoiceLockedMessage({ invoiceNumber: "F-0013", status: "PENDING", reason: "not-draft" });
  assert.match(confirmada, /F-0013/);
  assert.match(confirmada, /pendiente de pago/);
  assert.match(confirmada, /duplica el presupuesto/);
});
