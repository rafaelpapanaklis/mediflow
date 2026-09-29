// WS1-T5 — integración de lots.server.ts / recipe.server.ts contra el doble
// en memoria (sin Postgres). Corre: npm run test:inventario-lotes-server
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DobleInventario } from "./doble-inventario";
import { consumeFefoTx, createLot, listLotsForItem, writeOffExpiredLot, InsufficientStockError } from "../lots.server";
import { consumeRecipeForSession, upsertRecipeLine } from "../recipe.server";
import { crearLoteDeLineaDeCompra } from "../compra-lote.server";

const CLINIC = "clinic-1";

function itemBase(overrides: Partial<any> = {}) {
  return {
    id: "item-1", clinicId: CLINIC, name: "Anestesia", category: "Materiales",
    emoji: "📦", quantity: 10, minQuantity: 2, unit: "pza", price: null,
    quantityPrecise: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

describe("reconciliación: drift fuera del sistema de lotes", () => {
  let db: DobleInventario;
  beforeEach(() => { db = new DobleInventario(); });

  it("sin lotes todavía: el primer consumo crea el sin-lote con el agregado real (no un id inventado)", async () => {
    db.tablas.inventoryItem.push(itemBase({ quantity: 10 }));

    const { allocations } = await consumeFefoTx(db as any, {
      clinicId: CLINIC, itemId: "item-1", itemName: "Anestesia", qty: 4, reason: "Sesión 1",
    });

    assert.equal(allocations.length, 1);
    // El lote asignado debe existir DE VERDAD (no "__nuevo_sin_lote__").
    const lote = db.tablas.inventoryLot.find(l => l.id === allocations[0].lotId);
    assert.ok(lote, "el lote del allocation debe existir en la tabla");
    assert.equal(Number(lote!.remaining), 6);

    const item = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
    assert.equal(item.quantity, 6);
  });

  it("Ajuste 1 del gerente: SIN backfill SQL, listar lotes no sale vacío — se crea el sin-lote al vuelo con la cantidad de HOY", async () => {
    // Simula: estructura SQL aplicada, backfill NO (todavía no se integró a
    // main). El artículo no tiene ni un lote.
    db.tablas.inventoryItem.push(itemBase({ quantity: 8 }));

    const lots = await listLotsForItem(CLINIC, "item-1", db as any);

    assert.equal(lots.length, 1);
    assert.equal(lots[0].lotNumber, null);
    assert.equal(lots[0].remaining, 8);
  });

  it("Ajuste 1 del gerente: producción sigue moviendo quantity SIN lotes hasta el push — el sin-lote nace con el valor de HOY, no uno viejo", async () => {
    // item nace con 20 (antes de integrar). "Producción" (código viejo, sin
    // lotes) lo sube a 35 con el endpoint manual de siempre, ANTES de que
    // nadie toque el sistema de lotes por primera vez.
    db.tablas.inventoryItem.push(itemBase({ quantity: 20 }));
    db.tablas.inventoryItem.find(i => i.id === "item-1")!.quantity = 35;

    // El primer touch (listar, aquí) ve 35 — no un backfill congelado en 20.
    const lots = await listLotsForItem(CLINIC, "item-1", db as any);
    assert.equal(lots[0].remaining, 35);
  });

  it("N1 (ws1-t10 ronda 4): quantityPrecise YA puesto y desincronizado no recorta lotes recién comprados", async () => {
    // Reproduce el bug tal cual la QA: un consumo previo deja quantityPrecise
    // puesto (8), luego una "compra" (fuera de mi alcance: solo sube
    // quantity y crea su propio lote, como hace compras.server.ts) sube
    // quantity a 11 SIN tocar quantityPrecise, que queda congelado en 8.
    db.tablas.inventoryItem.push(itemBase({ id: "item-9", quantity: 8, quantityPrecise: 8 }));
    db.tablas.inventoryLot.push({
      id: "sin-lote", clinicId: CLINIC, itemId: "item-9", lotNumber: null,
      expiresAt: null, quantity: 8, remaining: 8,
      unitCost: null, purchaseLineId: null, createdAt: new Date(), updatedAt: new Date(),
    });
    // "Compra" de 3 más: t4 sube quantity y crea SU lote (crearLoteDeLineaDeCompra),
    // sin tocar quantityPrecise — exactamente el desfase de N1.
    db.tablas.inventoryItem.find(i => i.id === "item-9")!.quantity = 11;
    db.tablas.inventoryLot.push({
      id: "lote-compra", clinicId: CLINIC, itemId: "item-9", lotNumber: "L-2026-09",
      expiresAt: new Date("2027-01-01"), quantity: 3, remaining: 3,
      unitCost: 10, purchaseLineId: "linea-x", createdAt: new Date(), updatedAt: new Date(),
    });

    // Antes del arreglo: reconcileAndLock usaba quantityPrecise (8, obsoleto)
    // como aggregate y recortaba 3 del lote recién comprado. Con el arreglo,
    // detecta que round(quantityPrecise) !== quantity y usa quantity (11).
    const lots = await listLotsForItem(CLINIC, "item-9", db as any);
    const suma = lots.reduce((s, l) => s + l.remaining, 0);
    assert.equal(suma, 11, "no debe recortar lo recién comprado");
    assert.equal(lots.find(l => l.id === "lote-compra")!.remaining, 3);
    assert.equal(lots.find(l => l.id === "sin-lote")!.remaining, 8);
  });

  it("una compra/ajuste externo (t4) sube quantity sin tocar lotes: el consumo lo absorbe en sin-lote antes de descontar", async () => {
    db.tablas.inventoryItem.push(itemBase({ quantity: 10 }));
    db.tablas.inventoryLot.push({
      id: "lote-a", clinicId: CLINIC, itemId: "item-1", lotNumber: "L1",
      expiresAt: new Date("2026-10-01"), quantity: 10, remaining: 10,
      unitCost: null, purchaseLineId: null, createdAt: new Date(), updatedAt: new Date(),
    });
    // t4 registra una compra: sube quantity a 25 SIN crear lote (fuera de mi alcance).
    const item = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
    item.quantity = 25;

    await consumeFefoTx(db as any, { clinicId: CLINIC, itemId: "item-1", itemName: "Anestesia", qty: 3, reason: "Sesión 1" });

    // 10 (lote-a) + 15 (reconciliación → sin-lote) - 3 (consumo del lote-a, que caduca antes) = 22
    const loteA   = db.tablas.inventoryLot.find(l => l.id === "lote-a")!;
    const sinLote = db.tablas.inventoryLot.find(l => l.lotNumber === null)!;
    assert.equal(Number(loteA.remaining), 7);   // 10 - 3 (FEFO consume primero el que tiene fecha)
    assert.equal(Number(sinLote.remaining), 15); // absorbió el drift, intacto
    const itemFinal = db.tablas.inventoryItem.find(i => i.id === "item-1")!;
    assert.equal(itemFinal.quantity, 22);
  });
});

describe("consumo FEFO transaccional: todo o nada", () => {
  let db: DobleInventario;
  beforeEach(() => { db = new DobleInventario(); });

  it("stock insuficiente lanza InsufficientStockError y NO descuenta nada", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "item-2", quantity: 5 }));

    await assert.rejects(
      () => consumeFefoTx(db as any, { clinicId: CLINIC, itemId: "item-2", itemName: "Anestesia", qty: 100, reason: "x" }),
      InsufficientStockError,
    );
    const item = db.tablas.inventoryItem.find(i => i.id === "item-2")!;
    assert.equal(item.quantity, 5); // sin cambios
  });

  it("receta con 2 insumos: si el segundo no alcanza, el primero también se revierte (misma transacción)", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "gasa", clinicId: CLINIC, name: "Gasas", quantity: 50 }));
    db.tablas.inventoryItem.push(itemBase({ id: "anestesia-cara", clinicId: CLINIC, name: "Anestesia rara", quantity: 1 }));
    db.tablas.procedureCatalog.push({ id: "proc-1", clinicId: CLINIC, name: "Extracción", isActive: true });
    await upsertRecipeLine(CLINIC, "proc-1", "gasa", 5, db as any);
    await upsertRecipeLine(CLINIC, "proc-1", "anestesia-cara", 10, db as any); // pide 10, solo hay 1

    // Igual que la ruta real: consumeRecipeForSession corre DENTRO de
    // $transaction, así que si el segundo insumo no alcanza, el throw
    // aborta la transacción entera y revierte también el primero.
    await assert.rejects(
      () => db.$transaction(tx => consumeRecipeForSession(tx as any, {
        clinicId: CLINIC, procedureId: "proc-1", treatmentSessionId: "sesion-1", sessionLabel: "Sesión 1",
      })),
      InsufficientStockError,
    );

    // Ni la gasa (que sí alcanzaba) debe haberse tocado: todo vive en una sola transacción.
    const gasa = db.tablas.inventoryItem.find(i => i.id === "gasa")!;
    assert.equal(gasa.quantity, 50);
  });

  it("receta completa: descuenta los dos insumos en la misma llamada", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "gasa", clinicId: CLINIC, name: "Gasas", quantity: 50 }));
    db.tablas.inventoryItem.push(itemBase({ id: "algodon", clinicId: CLINIC, name: "Algodón", quantity: 20 }));
    db.tablas.procedureCatalog.push({ id: "proc-2", clinicId: CLINIC, name: "Limpieza", isActive: true });
    await upsertRecipeLine(CLINIC, "proc-2", "gasa", 3, db as any);
    await upsertRecipeLine(CLINIC, "proc-2", "algodon", 2, db as any);

    const resultado = await db.$transaction(tx =>
      consumeRecipeForSession(tx as any, { clinicId: CLINIC, procedureId: "proc-2", treatmentSessionId: "sesion-2", sessionLabel: "Sesión 2" }),
    );

    assert.equal(resultado.length, 2);
    assert.equal(db.tablas.inventoryItem.find(i => i.id === "gasa")!.quantity, 47);
    assert.equal(db.tablas.inventoryItem.find(i => i.id === "algodon")!.quantity, 18);
  });

  it("procedimiento sin receta capturada: no hace nada, no es un error", async () => {
    db.tablas.procedureCatalog.push({ id: "proc-3", clinicId: CLINIC, name: "Sin receta", isActive: true });
    const resultado = await db.$transaction(tx =>
      consumeRecipeForSession(tx as any, { clinicId: CLINIC, procedureId: "proc-3", treatmentSessionId: "s3", sessionLabel: "S3" }),
    );
    assert.deepEqual(resultado, []);
  });
});

describe("alta y baja de lote", () => {
  let db: DobleInventario;
  beforeEach(() => { db = new DobleInventario(); });

  it("createLot suma al agregado del artículo y deja rastro", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "item-3", quantity: 0 }));

    const lot = await createLot({
      clinicId: CLINIC, itemId: "item-3", lotNumber: "L-100",
      expiresAt: new Date("2027-01-01"), quantity: 30, unitCost: 12.5, purchaseLineId: null,
    }, db as any);

    assert.equal(lot.remaining, 30);
    assert.equal(db.tablas.inventoryItem.find(i => i.id === "item-3")!.quantity, 30);
    assert.equal(db.tablas.inventoryLotMovement.filter(m => m.lotId === lot.id).length, 1);
    assert.equal(db.tablas.inventoryHistory.filter(h => h.itemId === "item-3").length, 1);
  });

  it("writeOffExpiredLot vacía el lote y baja el agregado", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "item-4", quantity: 20 }));
    db.tablas.inventoryLot.push({
      id: "lote-caduco", clinicId: CLINIC, itemId: "item-4", lotNumber: "VIEJO",
      expiresAt: new Date("2020-01-01"), quantity: 20, remaining: 20,
      unitCost: null, purchaseLineId: null, createdAt: new Date(), updatedAt: new Date(),
    });

    await writeOffExpiredLot({ clinicId: CLINIC, lotId: "lote-caduco" }, db as any);

    assert.equal(Number(db.tablas.inventoryLot.find(l => l.id === "lote-caduco")!.remaining), 0);
    assert.equal(db.tablas.inventoryItem.find(i => i.id === "item-4")!.quantity, 0);
  });
});

describe("Ajuste 2: cliente de Prisma viejo — campo nuevo en modelo viejo", () => {
  let db: DobleInventario;
  beforeEach(() => { db = new DobleInventario(); });

  it("syncItemAggregate degrada: si quantityPrecise no se reconoce, actualiza quantity igual (no revienta la transacción)", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "item-5", quantity: 10 }));
    db.camposDesconocidosParaClienteViejo.add("quantityPrecise");

    // No debe lanzar, aunque el update con quantityPrecise sí fallaría solo.
    await consumeFefoTx(db as any, { clinicId: CLINIC, itemId: "item-5", itemName: "Anestesia", qty: 4, reason: "Sesión 1" });

    assert.equal(db.tablas.inventoryItem.find(i => i.id === "item-5")!.quantity, 6);
  });
});

describe("Ajuste 2: enlace automático compra → lote", () => {
  let db: DobleInventario;
  beforeEach(() => { db = new DobleInventario(); });

  it("línea de compra CON lote/caducidad crea su propio InventoryLot, sin tocar InventoryItem.quantity", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "item-6", quantity: 15 })); // t4 ya sumó la compra aquí antes de llamar
    await db.$transaction(tx => crearLoteDeLineaDeCompra(tx as any, {
      clinicId: CLINIC, purchaseLineId: "linea-1", itemId: "item-6",
      quantity: 5, unitCost: 12.5, lotNumber: "L-2026-09", expiresAt: new Date("2027-01-01"),
    }));

    const lote = db.tablas.inventoryLot.find(l => l.purchaseLineId === "linea-1");
    assert.ok(lote, "debe crear el lote de esta línea");
    assert.equal(Number(lote!.remaining), 5);
    assert.equal(lote!.lotNumber, "L-2026-09");
    // NO tocó el agregado: t4 ya lo había subido a 15 con aplicarEntradaDeCompra.
    assert.equal(db.tablas.inventoryItem.find(i => i.id === "item-6")!.quantity, 15);
  });

  it("es idempotente por purchaseLineId: llamarla dos veces no duplica el lote", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "item-7", quantity: 5 }));
    const datos = { clinicId: CLINIC, purchaseLineId: "linea-2", itemId: "item-7", quantity: 5, unitCost: 10, lotNumber: "L-A", expiresAt: null };
    await db.$transaction(tx => crearLoteDeLineaDeCompra(tx as any, datos));
    await db.$transaction(tx => crearLoteDeLineaDeCompra(tx as any, datos));

    assert.equal(db.tablas.inventoryLot.filter(l => l.purchaseLineId === "linea-2").length, 1);
  });

  it("línea SIN lote ni caducidad no crea nada — sigue absorbiéndola el colchón sin-lote", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "item-8", quantity: 5 }));
    await db.$transaction(tx => crearLoteDeLineaDeCompra(tx as any, {
      clinicId: CLINIC, purchaseLineId: "linea-3", itemId: "item-8", quantity: 5, unitCost: 10, lotNumber: null, expiresAt: null,
    }));

    assert.equal(db.tablas.inventoryLot.length, 0);
  });
});

describe("H17 (ws1-t6): consumo con lotes caducados", () => {
  let db: DobleInventario;
  beforeEach(() => { db = new DobleInventario(); });
  const ayer = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const manana = new Date(Date.now() + 90 * 24 * 3600 * 1000);
  const lote = (id: string, expiresAt: Date | null, remaining: number) => ({
    id, clinicId: CLINIC, itemId: "guantes", lotNumber: id, expiresAt, quantity: remaining, remaining,
    unitCost: null, purchaseLineId: null, createdAt: new Date(), updatedAt: new Date(),
  });

  it("el consumo salta el lote caducado y usa el vigente", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "guantes", name: "Guantes", quantity: 15 }));
    db.tablas.inventoryLot.push(lote("cad", ayer, 5), lote("vig", manana, 10));
    const r = await consumeFefoTx(db as any, { clinicId: CLINIC, itemId: "guantes", itemName: "Guantes", qty: 2, reason: "Sesión" });
    assert.deepEqual(r.allocations, [{ lotId: "vig", qty: 2 }]);
    assert.equal(r.sinVigentes, undefined);
    assert.equal(db.tablas.inventoryLot.find((l: any) => l.id === "cad")!.remaining, 5);
  });

  it("solo queda caducado: NO bloquea, avisa y no descuenta nada; el lote caducado queda intacto", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "guantes", name: "Guantes", quantity: 5 }));
    db.tablas.inventoryLot.push(lote("cad", ayer, 5));
    const r = await consumeFefoTx(db as any, { clinicId: CLINIC, itemId: "guantes", itemName: "Guantes", qty: 2, reason: "Sesión" });
    assert.deepEqual(r.allocations, []);
    assert.equal(r.sinVigentes?.consumed, 0);
    assert.equal(r.sinVigentes?.caducado, 5);
    assert.match(r.sinVigentes!.mensaje, /no hay existencias vigentes/);
    assert.equal(db.tablas.inventoryLot.find((l: any) => l.id === "cad")!.remaining, 5);
    assert.equal(db.tablas.inventoryItem.find((i: any) => i.id === "guantes")!.quantity, 5);
  });

  it("vigente insuficiente + caducado: descuenta lo vigente y avisa", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "guantes", name: "Guantes", quantity: 6 }));
    db.tablas.inventoryLot.push(lote("cad", ayer, 5), lote("vig", manana, 1));
    const r = await consumeFefoTx(db as any, { clinicId: CLINIC, itemId: "guantes", itemName: "Guantes", qty: 3, reason: "Sesión" });
    assert.deepEqual(r.allocations, [{ lotId: "vig", qty: 1 }]);
    assert.equal(r.sinVigentes?.consumed, 1);
  });

  it("falta sin nada caducado que lo explique: sigue siendo InsufficientStockError", async () => {
    db.tablas.inventoryItem.push(itemBase({ id: "guantes", name: "Guantes", quantity: 1 }));
    db.tablas.inventoryLot.push(lote("vig", manana, 1));
    await assert.rejects(
      () => consumeFefoTx(db as any, { clinicId: CLINIC, itemId: "guantes", itemName: "Guantes", qty: 5, reason: "x" }),
      InsufficientStockError,
    );
  });
});
