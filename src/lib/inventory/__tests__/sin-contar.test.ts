/**
 * INVENTARIO «SIN CONTAR» ≠ «AGOTADO» (12f, ticket 3 de BEVADENT).
 *
 * Run: npm run test:inventario-sin-contar
 *
 * La página de Inventario siembra ~109 artículos dentales con `quantity: 0`.
 * Nadie los contó, pero la pantalla los pintaba «Agotado» y «Hoy» avisaba
 * «109 insumos agotados». Ahora, en cero y sin ninguna huella (bitácora o
 * lote) = «Sin contar»; en cuanto alguien ajusta, compra, da de alta con
 * cantidad o cuenta «0» a propósito, deja de serlo.
 *
 * Mezcla reglas puras (conteo y avisos) con los HANDLERS REALES de
 * /api/inventory sobre un doble de Prisma (`mock.module`, de ahí
 * `--experimental-test-module-mocks`).
 */
// Nada de esto puede llegar a una base real: ni el import de Prisma (se carga
// DESPUÉS de los mocks, con import dinámico) ni, si alguien rompe eso, la URL.
process.env.DATABASE_URL = "postgresql://nadie:nada@127.0.0.1:1/ninguna?connection_limit=1";
process.env.DIRECT_URL = process.env.DATABASE_URL;

import { test, mock, beforeEach, before } from "node:test";
import assert from "node:assert/strict";
import { avisosDeExistencias, contarExistenciasVigentes, filtroDeInventario } from "../avisos-existencias";

let esSinContar: typeof import("../sin-contar.server").esSinContar;
let idsSinContar: typeof import("../sin-contar.server").idsSinContar;

type Row = Record<string, any>;
const db = {
  items: [] as Row[],
  history: [] as Row[],
  lots: [] as Row[],
  /** Cada `where` con que se consultó la bitácora/lotes: prueba de tenant. */
  consultas: [] as Array<{ tabla: string; where: Row }>,
  historiaRota: false,
  seq: 0,
};

const fakePrisma = {
  inventoryItem: {
    findMany: async ({ where }: any) => db.items.filter((i) => i.clinicId === where.clinicId),
    findFirst: async ({ where }: any) => db.items.find((i) => i.id === where.id && i.clinicId === where.clinicId) ?? null,
    update: async ({ where, data }: any) => {
      const it = db.items.find((i) => i.id === where.id)!;
      Object.assign(it, data);
      return { ...it };
    },
    create: async ({ data }: any) => {
      const row = { id: `art${++db.seq}`, providerId: null, ...data };
      db.items.push(row);
      return { ...row };
    },
  },
  inventoryHistory: {
    create: async ({ data }: any) => { db.history.push({ ...data }); return data; },
    findMany: async ({ where }: any) => {
      db.consultas.push({ tabla: "history", where });
      if (db.historiaRota) throw new Error("conexión caída");
      const clinicId = where.item?.clinicId;
      return db.history
        .filter((h) => where.itemId.in.includes(h.itemId) && db.items.find((i) => i.id === h.itemId)?.clinicId === clinicId)
        .map((h) => ({ itemId: h.itemId }));
    },
  },
  inventoryLot: {
    findMany: async ({ where }: any) => {
      db.consultas.push({ tabla: "lots", where });
      return db.lots.filter((l) => l.clinicId === where.clinicId && where.itemId.in.includes(l.itemId)).map((l) => ({ itemId: l.itemId }));
    },
  },
};

const sesion = { clinicId: "c1", userId: "u1" };
mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
mock.module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesion } });
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/inventory/proveedores.server", { namedExports: { providerPerteneceAClinica: async () => true } });

before(async () => {
  // Con los mocks ya puestos: de aquí en adelante `@/lib/prisma` es el doble.
  ({ esSinContar, idsSinContar } = await import("../sin-contar.server"));
});

const item = (id: string, quantity: number, clinicId = "c1"): Row => ({
  id, clinicId, name: id, description: null, category: "Consumibles", emoji: "📦",
  quantity, minQuantity: 5, unit: "pza", price: null, unitCost: 0, providerId: null,
});

beforeEach(() => {
  db.items = []; db.history = []; db.lots = []; db.consultas = []; db.historiaRota = false; db.seq = 0;
});

const req = (url: string, method: string, body?: unknown) =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }) as any;

// ── La definición ───────────────────────────────────────────────────────────

test("sin contar = en cero y sin huella; con existencias o con historia, no", () => {
  assert.equal(esSinContar(0, false), true);
  assert.equal(esSinContar(0, true), false, "se movió alguna vez: si está en cero, está agotado");
  assert.equal(esSinContar(7, false), false, "con existencias ya está contado");
});

test("idsSinContar: el sembrado sin tocar sí; el que tiene historia o lote, no; los que tienen existencias ni se consultan", async () => {
  db.items = [item("sembrado", 0), item("ajustado", 0), item("conLote", 0), item("conStock", 12)];
  db.history = [{ itemId: "ajustado", change: -3, type: "adjust" }];
  db.lots = [{ clinicId: "c1", itemId: "conLote" }];
  const ids = await idsSinContar("c1", db.items as any, fakePrisma as any);
  assert.deepEqual([...ids], ["sembrado"]);
  for (const c of db.consultas) assert.ok(!c.where.itemId.in.includes("conStock"), "un artículo con existencias no necesita la consulta");
});

test("idsSinContar: la bitácora de OTRA clínica no cuenta (tenant en las dos consultas)", async () => {
  db.items = [item("mio", 0, "c1"), item("ajeno", 0, "c2")];
  db.history = [{ itemId: "ajeno", change: 5, type: "adjust" }];
  const ids = await idsSinContar("c1", db.items.filter((i) => i.clinicId === "c1") as any, fakePrisma as any);
  assert.deepEqual([...ids], ["mio"]);
  assert.deepEqual(db.consultas.find((c) => c.tabla === "history")!.where.item, { clinicId: "c1" });
  assert.equal(db.consultas.find((c) => c.tabla === "lots")!.where.clinicId, "c1");
});

test("idsSinContar: si la bitácora no se puede leer NO declara nada sin contar (se vería «Agotado», como antes)", async () => {
  db.items = [item("a", 0)];
  db.historiaRota = true;
  const prev = console.error; console.error = () => {};
  try { assert.equal((await idsSinContar("c1", db.items as any, fakePrisma as any)).size, 0); } finally { console.error = prev; }
});

// ── Conteos y avisos de «Hoy» ───────────────────────────────────────────────

test("BEVADENT: 109 sembrados en cero ya NO son «109 insumos agotados»", () => {
  const items = Array.from({ length: 109 }, (_, i) => ({ id: `a${i}`, quantity: 0, minQuantity: 5 }));
  const sin = new Set(items.map((i) => i.id));
  const conteo = contarExistenciasVigentes(items, [], sin);
  assert.deepEqual(conteo, { agotados: 0, bajos: 0, sinContar: 109 });
  const avisos = avisosDeExistencias(conteo);
  assert.equal(avisos.some((a) => a.id === "inv-out"), false, "nada en rojo: no se sabe que falte nada");
  assert.deepEqual(avisos, [
    { id: "inv-uncounted", tone: "info", title: "Inventario: 109 insumos sin contar", href: "/dashboard/inventory?filter=sin-contar" },
  ]);
});

test("un agotado de verdad (con historia) sigue en rojo, aparte de los sin contar", () => {
  const items = [
    { id: "gastado", quantity: 0, minQuantity: 5 },
    { id: "virgen", quantity: 0, minQuantity: 5 },
    { id: "poco", quantity: 2, minQuantity: 5 },
  ];
  const conteo = contarExistenciasVigentes(items, [], new Set(["virgen"]));
  assert.deepEqual(conteo, { agotados: 1, bajos: 1, sinContar: 1 });
  assert.deepEqual(avisosDeExistencias(conteo).map((a) => a.id), ["inv-out", "inv-low", "inv-uncounted"]);
});

test("sin el conjunto (llamadores de siempre) todo cero es agotado, como antes", () => {
  assert.deepEqual(contarExistenciasVigentes([{ id: "a", quantity: 0, minQuantity: 5 }], []).agotados, 1);
});

test("el aviso «sin contar» abre el filtro «Sin contar»", () => {
  const a = avisosDeExistencias({ agotados: 0, bajos: 0, sinContar: 3 })[0];
  assert.equal(filtroDeInventario(new URL(a.href!, "https://x.test").searchParams.get("filter")), "sin_contar");
});

// ── Las rutas reales ────────────────────────────────────────────────────────

test("GET /api/inventory marca `sinContar` solo en los sembrados sin huella", async () => {
  db.items = [item("sembrado", 0), item("gastado", 0), item("conStock", 9)];
  db.history = [{ itemId: "gastado", change: -2, type: "session" }];
  const { GET } = await import("@/app/api/inventory/route");
  const res = await GET(req("https://x.test/api/inventory", "GET"));
  const filas: Row[] = await res.json();
  const por = Object.fromEntries(filas.map((f) => [f.id, f.sinContar]));
  assert.deepEqual(por, { sembrado: true, gastado: false, conStock: false });
});

test("contar «0» a propósito (PATCH quantity=0 sobre un artículo en cero) lo saca de «Sin contar»", async () => {
  db.items = [item("a", 0)];
  const { PATCH } = await import("@/app/api/inventory/[id]/route");
  assert.equal((await idsSinContar("c1", db.items as any, fakePrisma as any)).has("a"), true);
  const res = await PATCH(req("https://x.test/api/inventory/a", "PATCH", { quantity: 0 }), { params: { id: "a" } });
  assert.equal(res.status, 200);
  assert.equal((await idsSinContar("c1", db.items as any, fakePrisma as any)).has("a"), false, "ahora está contado: en cero = agotado");
  assert.equal(db.history.length, 1);
  assert.equal(db.history[0].change, 0);
});

test("ajustar a una cantidad real también lo saca; el PATCH de otro campo (mínimo) NO", async () => {
  db.items = [item("a", 0), item("b", 0)];
  const { PATCH } = await import("@/app/api/inventory/[id]/route");
  await PATCH(req("https://x.test/api/inventory/a", "PATCH", { quantity: 8 }), { params: { id: "a" } });
  await PATCH(req("https://x.test/api/inventory/b", "PATCH", { minQuantity: 2 }), { params: { id: "b" } });
  const sin = await idsSinContar("c1", db.items as any, fakePrisma as any);
  assert.deepEqual([...sin], ["b"], "cambiar el mínimo no es contar");
});

test("dar de alta un artículo en cero lo deja contado (quien lo captura dice cuánto hay)", async () => {
  const { POST } = await import("@/app/api/inventory/route");
  const res = await POST(req("https://x.test/api/inventory", "POST", { name: "Gasas", category: "Consumibles", quantity: 0 }));
  assert.equal(res.status, 201);
  const creado = await res.json();
  assert.equal((await idsSinContar("c1", db.items as any, fakePrisma as any)).has(creado.id), false);
});

test("sin las columnas nuevas de la bitácora (SQL de ws1-t4 sin pegar) contar «0» igual deja huella", async () => {
  db.items = [item("a", 0)];
  const original = fakePrisma.inventoryHistory.create;
  fakePrisma.inventoryHistory.create = async ({ data }: any) => {
    if ("clinicId" in data) throw Object.assign(new Error("column does not exist"), { code: "P2022" });
    db.history.push({ ...data });
    return data;
  };
  try {
    const { PATCH } = await import("@/app/api/inventory/[id]/route");
    await PATCH(req("https://x.test/api/inventory/a", "PATCH", { quantity: 0 }), { params: { id: "a" } });
  } finally {
    fakePrisma.inventoryHistory.create = original;
  }
  assert.equal(db.history.length, 1, "se reintentó con las columnas de siempre");
  assert.equal((await idsSinContar("c1", db.items as any, fakePrisma as any)).has("a"), false);
});
