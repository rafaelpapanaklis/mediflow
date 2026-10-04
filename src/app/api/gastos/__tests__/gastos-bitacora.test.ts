/**
 * GASTOS con rastro (ws1-t2, auditoría de dinero F11): «quien tiene
 * expenses.edit borra un gasto de $8,000 y la utilidad del mes sube $8,000; no
 * queda bitácora ni copia».
 *
 * Run: npm run test:gastos-bitacora
 *
 * Se corre la RUTA REAL (/api/gastos) con Prisma, la sesión y la bitácora
 * sustituidos (mock.module). Con el código viejo fallan: no había logMutation,
 * el borrado era siempre físico y no existía PATCH.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const db = {
  columna: false,
  gastos: [] as any[],
  executeRaw: [] as string[],
};
const bitacora: any[] = [];
let rol = "ADMIN";

const expense = {
  findFirst: async ({ where }: any) => {
    const notIn: string[] = where?.AND?.[0]?.id?.notIn ?? [];
    const g = db.gastos.find((x) => x.id === where.id && x.clinicId === where.clinicId && !notIn.includes(x.id));
    return g ? { id: g.id, date: g.date, category: g.category, amount: g.amount, note: g.note } : null;
  },
  create: async ({ data }: any) => {
    const g = { id: `e${db.gastos.length + 1}`, deletedAt: null, ...data };
    db.gastos.push(g);
    return { id: g.id, date: g.date, category: g.category, amount: g.amount, note: g.note };
  },
  deleteMany: async ({ where }: any) => {
    const antes = db.gastos.length;
    db.gastos = db.gastos.filter((x) => !(x.id === where.id && x.clinicId === where.clinicId));
    return { count: antes - db.gastos.length };
  },
  updateMany: async ({ where, data }: any) => {
    const g = db.gastos.find((x) => x.id === where.id && x.clinicId === where.clinicId);
    if (!g) return { count: 0 };
    Object.assign(g, data);
    return { count: 1 };
  },
};
const sqlDe = (q: any) => (Array.isArray(q) ? q.join("?") : String(q?.strings?.join?.("?") ?? q));
const prismaStub: any = {
  expense,
  $queryRaw: async (q: TemplateStringsArray, ...v: unknown[]) => {
    const sql = sqlDe(q);
    if (sql.includes("information_schema.columns")) return [{ existe: db.columna }];
    if (sql.includes('"deletedAt" IS NOT NULL')) return db.gastos.filter((g) => g.clinicId === v[0] && g.deletedAt).map((g) => ({ id: g.id }));
    throw new Error(`SQL inesperado: ${sql}`);
  },
  $executeRaw: async (q: TemplateStringsArray, ...v: unknown[]) => {
    const sql = sqlDe(q);
    db.executeRaw.push(sql);
    const [userId, id, clinicId] = v as string[];
    const g = db.gastos.find((x) => x.id === id && x.clinicId === clinicId && !x.deletedAt);
    if (!g) return 0;
    g.deletedAt = new Date();
    g.deletedById = userId;
    return 1;
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: "c1", userId: "u1", role: rol, permissionsOverride: null }) },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (o: any) => { bitacora.push(o); }, logAudit: async () => {} } });

function req(url: string, body?: any): any {
  return { url, json: async () => body, headers: new Headers() };
}

beforeEach(async () => {
  const { olvidarSondaDeGastos } = await import("@/lib/gastos-borrado.server");
  olvidarSondaDeGastos();
  db.columna = false;
  db.executeRaw = [];
  db.gastos = [
    { id: "g8", clinicId: "c1", date: new Date("2026-09-30T06:00:00Z"), category: "Renta", amount: 8_000, note: "Septiembre", deletedAt: null },
    { id: "gx", clinicId: "c2", date: new Date("2026-09-30T06:00:00Z"), category: "Renta", amount: 99_999, note: null, deletedAt: null },
  ];
  bitacora.length = 0;
  rol = "ADMIN";
});

test("borrar un gasto de $8,000 deja en la bitácora monto, categoría, fecha y nota (sin el SQL: borrado físico)", async () => {
  const { DELETE } = await import("@/app/api/gastos/route");
  const res = await DELETE(req("http://x/api/gastos?id=g8"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).borradoLogico, false);
  assert.equal(db.gastos.some((g) => g.id === "g8"), false);
  assert.equal(bitacora.length, 1);
  assert.equal(bitacora[0].entityType, "expense");
  assert.equal(bitacora[0].action, "delete");
  assert.deepEqual(bitacora[0].before, { fecha: "2026-09-30T06:00:00.000Z", categoria: "Renta", monto: 8_000, nota: "Septiembre" });
  assert.match(bitacora[0].texto, /Borró el gasto «Renta» de \$8,000\.00/);
  assert.equal(bitacora[0].clinicId, "c1");
});

test("con el SQL pegado el borrado es LÓGICO: la fila se queda con deletedAt y deja de listarse", async () => {
  db.columna = true;
  const { DELETE } = await import("@/app/api/gastos/route");
  const res = await DELETE(req("http://x/api/gastos?id=g8"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).borradoLogico, true);
  const g = db.gastos.find((x) => x.id === "g8");
  assert.ok(g?.deletedAt, "la fila sigue ahí, marcada");
  assert.equal(g?.deletedById, "u1");
  assert.match(db.executeRaw[0], /UPDATE "expenses" SET "deletedAt" = NOW\(\)/);
  assert.match(db.executeRaw[0], /"clinicId" = \?/);
  assert.equal(bitacora[0].action, "soft_delete");

  // Un borrado ya no se encuentra: ni se vuelve a borrar ni se corrige.
  const { filtroGastosVivos } = await import("@/lib/gastos-borrado.server");
  assert.deepEqual(await filtroGastosVivos("c1"), { id: { notIn: ["g8"] } });
  assert.equal((await DELETE(req("http://x/api/gastos?id=g8"))).status, 404);
  const { PATCH } = await import("@/app/api/gastos/route");
  assert.equal((await PATCH(req("http://x/api/gastos?id=g8", { amount: 1 }))).status, 404);
});

test("el gasto de otra clínica no se toca (404)", async () => {
  const { DELETE, PATCH } = await import("@/app/api/gastos/route");
  assert.equal((await DELETE(req("http://x/api/gastos?id=gx"))).status, 404);
  assert.equal((await PATCH(req("http://x/api/gastos?id=gx", { amount: 1 }))).status, 404);
  assert.equal(db.gastos.find((g) => g.id === "gx")?.amount, 99_999);
  assert.equal(bitacora.length, 0);
});

test("corregir: solo cambia lo enviado y la bitácora guarda antes y después", async () => {
  const { PATCH } = await import("@/app/api/gastos/route");
  const res = await PATCH(req("http://x/api/gastos?id=g8", { amount: 7_999.999 }));
  assert.equal(res.status, 200);
  const g = db.gastos.find((x) => x.id === "g8");
  assert.equal(g.amount, 8_000, "redondeado a centavos");
  assert.equal(g.category, "Renta");
  const r2 = await PATCH(req("http://x/api/gastos?id=g8", { amount: 6_500, category: "Servicios" }));
  assert.equal(r2.status, 200);
  const ultimo = bitacora[bitacora.length - 1];
  assert.equal(ultimo.action, "update");
  assert.equal(ultimo.before.monto, 8_000);
  assert.equal(ultimo.after.monto, 6_500);
  assert.equal(ultimo.after.categoria, "Servicios");
  assert.match(ultimo.texto, /\$8,000\.00 → \$6,500\.00/);
});

test("registrar deja su fila en la bitácora", async () => {
  const { POST } = await import("@/app/api/gastos/route");
  const res = await POST(req("http://x/api/gastos", { category: "Insumos", amount: 1_250, date: "2026-09-15" }));
  assert.equal(res.status, 201);
  assert.equal(bitacora[0].action, "create");
  assert.equal(bitacora[0].after.monto, 1_250);
});

test("sin expenses.edit no se borra ni se corrige (403)", async () => {
  rol = "DOCTOR";
  const { DELETE, PATCH } = await import("@/app/api/gastos/route");
  assert.equal((await DELETE(req("http://x/api/gastos?id=g8"))).status, 403);
  assert.equal((await PATCH(req("http://x/api/gastos?id=g8", { amount: 1 }))).status, 403);
  assert.equal(db.gastos.length, 2);
});

test("cambiosDelGasto: solo lo que cambió; la fecha solo si cambió el día", async () => {
  const { cambiosDelGasto, fechaLocalDeGasto } = await import("@/lib/finanzas/corregir-gasto");
  const original = { date: "2026-09-30T06:00:00.000Z", category: "Renta", amount: 8_000, note: null };
  const fecha = fechaLocalDeGasto(original.date);
  assert.equal(cambiosDelGasto(original, { fecha, categoria: "Renta", monto: 8_000, nota: "" }), null);
  assert.deepEqual(cambiosDelGasto(original, { fecha, categoria: "Renta", monto: 6_500, nota: " " }), { amount: 6_500 });
  assert.deepEqual(cambiosDelGasto(original, { fecha: "2026-09-01", categoria: " Luz ", monto: 8_000, nota: "agua" }), { date: "2026-09-01", category: "Luz", note: "agua" });
});
