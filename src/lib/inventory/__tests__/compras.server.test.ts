import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DobleCompras } from "./doble-compras";
import { registrarCompra, ComprasTablaFaltanteError, LineaInvalidaError, ArticuloNoEncontradoError } from "../compras.server";

const CLINIC = "clinic-1";

let db: DobleCompras;
beforeEach(() => {
  db = new DobleCompras();
  db.tablas.inventoryItem.push({ id: "item-1", clinicId: CLINIC, name: "Ligas", quantity: 10, unitCost: 5 });
});

test("registrarCompra: suma existencias, actualiza al ÚLTIMO costo, y crea el gasto ligado", async () => {
  const r = await registrarCompra({
    clinicId: CLINIC, providerId: null, date: new Date(), receiptRef: null,
    createdById: "user-1", idempotencyKey: "key-1",
    lines: [{ itemId: "item-1", quantity: 20, unitCost: 8 }],
  }, db as any);

  assert.equal(r.yaExistia, false);
  assert.equal(r.total, 160);
  assert.ok(r.expenseId);
  assert.deepEqual(r.items, [{ itemId: "item-1", quantity: 30, unitCost: 8 }]);

  const item = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
  assert.equal(item.quantity, 30);
  assert.equal(item.unitCost, 8, "el costo debe quedar en el ÚLTIMO valor comprado, no en un promedio");

  const gasto = db.tablas.expense.find(e => e.id === r.expenseId)!;
  assert.equal(gasto.category, "Insumos");
  assert.equal(gasto.amount, 160);
  assert.equal(gasto.purchaseId, r.purchaseId, "el gasto queda LIGADO a la compra");

  const historial = db.tablas.inventoryHistory.find(h => h.itemId === "item-1");
  assert.equal(historial?.change, 20);
  assert.equal(historial?.type, "purchase");
});

test("registrarCompra: dos líneas del mismo artículo se aplican ambas (última gana el costo)", async () => {
  const r = await registrarCompra({
    clinicId: CLINIC, providerId: null, date: new Date(), receiptRef: null,
    createdById: "user-1", idempotencyKey: null,
    lines: [
      { itemId: "item-1", quantity: 5, unitCost: 6 },
      { itemId: "item-1", quantity: 3, unitCost: 9 },
    ],
  }, db as any);

  const item = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
  assert.equal(item.quantity, 18); // 10 + 5 + 3
  assert.equal(item.unitCost, 9);
  assert.equal(r.total, 5 * 6 + 3 * 9);
});

test("registrarCompra: idempotencia — reenviar la MISMA llave no duplica ni el gasto ni las existencias", async () => {
  const datos = {
    clinicId: CLINIC, providerId: null, date: new Date(), receiptRef: null,
    createdById: "user-1", idempotencyKey: "misma-llave",
    lines: [{ itemId: "item-1", quantity: 4, unitCost: 7 }],
  };

  const r1 = await registrarCompra(datos, db as any);
  const r2 = await registrarCompra(datos, db as any);

  assert.equal(r1.purchaseId, r2.purchaseId);
  assert.equal(r2.yaExistia, true);
  assert.equal(db.tablas.inventoryPurchase.length, 1, "una sola compra, no dos");
  assert.equal(db.tablas.expense.length, 1, "un solo gasto, no dos");

  const item = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
  assert.equal(item.quantity, 14, "10 + 4, NO 10 + 4 + 4 — el reintento no vuelve a sumar");
});

test("registrarCompra: cantidad inválida rechaza ANTES de tocar la base", async () => {
  await assert.rejects(
    () => registrarCompra({
      clinicId: CLINIC, providerId: null, date: new Date(), receiptRef: null,
      createdById: "user-1", idempotencyKey: null,
      lines: [{ itemId: "item-1", quantity: -5, unitCost: 8 }],
    }, db as any),
    LineaInvalidaError,
  );
  const item = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
  assert.equal(item.quantity, 10, "sin cambios: la validación corta antes de la transacción");
});

test("registrarCompra: artículo de otra clínica (o inexistente) revierte TODA la compra", async () => {
  await assert.rejects(
    () => registrarCompra({
      clinicId: CLINIC, providerId: null, date: new Date(), receiptRef: null,
      createdById: "user-1", idempotencyKey: null,
      lines: [{ itemId: "item-1", quantity: 1, unitCost: 1 }, { itemId: "item-ajeno", quantity: 1, unitCost: 1 }],
    }, db as any),
    ArticuloNoEncontradoError,
  );
  const item = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
  assert.equal(item.quantity, 10, "todo o nada: la primera línea tampoco se aplicó");
  assert.equal(db.tablas.inventoryPurchase.length, 0);
});

test("registrarCompra: SQL de compras aún no aplicado (P2021) da un error claro, no un 500 ciego", async () => {
  db.tablasNuevasFaltantes = true;
  await assert.rejects(
    () => registrarCompra({
      clinicId: CLINIC, providerId: null, date: new Date(), receiptRef: null,
      createdById: "user-1", idempotencyKey: null,
      lines: [{ itemId: "item-1", quantity: 1, unitCost: 1 }],
    }, db as any),
    ComprasTablaFaltanteError,
  );
});
