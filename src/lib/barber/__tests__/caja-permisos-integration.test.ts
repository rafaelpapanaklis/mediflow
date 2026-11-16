// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1), punto 6: PERMISOS de cada API nueva, por rol,
// contra las rutas REALES y el getBarberContext REAL (arnés de ws6-t8: solo
// la sesión de Supabase está doblada).
//
//   cash.expenses «Registrar gastos y entradas»
//   cash.withdraw «Sacar efectivo y pagar a barberos»
//   Dueño y Encargado: todo · Recepción: gastos sí, sacar no · Barbero: nada.
//   cash.view sin cash.manage: ve el resumen, no abre/cierra ni cobra.
//   Quitar un acceso = la SIGUIENTE petición ya no pasa (G1: nada ≠ hereda).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-permisos-integration.test.ts
// Requiere sql/barber_caja_completa.sql pegado en esa base local.
// ═══════════════════════════════════════════════════════════════════════
import { sesion, llamar, type Resp } from "./_permisos-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";
import { BARBER_ROLE_DEFAULT_PERMISSIONS, hasBarberPermission, resolveBarberPermissions } from "../permissions";

const API = path.resolve(__dirname, "../../../app/api/barber");
const ruta = (rel: string) => import(path.join(API, rel, "route.ts")) as Promise<Record<string, Parameters<typeof llamar>[0]>>;

const RUN = `cperm${Date.now().toString(36)}`;
let prisma: typeof import("@/lib/prisma")["prisma"];
let skip: false | string = skipDb;
const sb: Record<string, string> = {};
const uid: Record<string, string> = {};
let shopId: string;
let otraId: string;
let barberoId: string;

async function persona(tag: string, role: "OWNER" | "MANAGER" | "RECEPTION" | "BARBER", extra: Partial<Prisma.BarberUserUncheckedCreateInput> = {}, shop = shopId) {
  const supabaseId = `${RUN}-${tag}`;
  const u = await prisma.barberUser.create({
    data: { barbershopId: shop, supabaseId, email: `${supabaseId}@test.local`, firstName: tag, lastName: "Caja", role, ...extra },
  });
  sb[tag] = supabaseId;
  uid[tag] = u.id;
}

async function como(tag: string | null, rel: string, metodo: string, opts: { body?: unknown; params?: Record<string, string>; query?: string; shop?: string } = {}): Promise<Resp> {
  sesion.supabaseId = tag ? sb[tag] : null;
  sesion.pinSede = metodo === "GET" ? null : opts.shop ?? shopId;
  const mod = await ruta(rel);
  return llamar(mod[metodo], {
    method: metodo,
    url: `http://localhost/api/barber/${rel}${opts.query ? `?${opts.query}` : ""}`,
    body: opts.body,
    params: opts.params,
  });
}

const gasto = (amount = 10) => ({ type: "EXPENSE", amount, category: "SUPPLIES" });

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  const { cashMovementsReady, resetCashMovementsReadyCache } = await import("@/lib/barber/cash-movements");
  resetCashMovementsReadyCache();
  if (!(await cashMovementsReady(prisma))) {
    skip = "sql/barber_caja_completa.sql no está pegado en esta base local";
    return;
  }
  shopId = (await prisma.barbershop.create({ data: { name: "Caja Permisos", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active" } })).id;
  otraId = (await prisma.barbershop.create({ data: { name: "Otra", slug: `${RUN}-b`, plan: "PROFESIONAL", subscriptionStatus: "active" } })).id;
  barberoId = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Beto", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  await persona("dueno", "OWNER");
  await persona("gerente", "MANAGER");
  await persona("recepcion", "RECEPTION");
  await persona("rita", "RECEPTION"); // a la que se le quitan cosas
  await persona("barbero", "BARBER", { barberId: barberoId });
  await persona("soloVer", "RECEPTION", { permissionsOverride: ["cash.view"] });
  await persona("ajeno", "OWNER", {}, otraId);
  const r = await como("dueno", "cash-sessions/open", "POST", { body: { openingAmount: 1000 } });
  assert.equal(r.status, 201, "el dueño abre caja");
  const r2 = await como("ajeno", "cash-sessions/open", "POST", { body: { openingAmount: 0 }, shop: otraId });
  assert.equal(r2.status, 201, "el de la otra barbería abre la suya");
});

after(async () => {
  if (!HAS_DB) return;
  if (!skip) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" IN (SELECT "id" FROM "barber_shops" WHERE "slug" LIKE ${`${RUN}-%`})`;
  await prisma.barberCashSession.deleteMany({ where: { barbershop: { slug: { startsWith: RUN } } } }).catch(() => undefined);
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: RUN } } }).catch(() => undefined);
  await prisma.$disconnect();
});

test("los defaults por rol: Dueño y Encargado todo; Recepción gastos sí y sacar no; Barbero nada", () => {
  for (const [role, expenses, withdraw] of [
    ["OWNER", true, true],
    ["MANAGER", true, true],
    ["RECEPTION", true, false],
    ["BARBER", false, false],
  ] as const) {
    assert.equal(hasBarberPermission({ role }, "cash.expenses"), expenses, `${role} cash.expenses`);
    assert.equal(hasBarberPermission({ role }, "cash.withdraw"), withdraw, `${role} cash.withdraw`);
  }
  assert.ok(!BARBER_ROLE_DEFAULT_PERMISSIONS.BARBER.some((k) => k.startsWith("cash.")), "el Barbero no trae nada de caja");
});

test("POST /cash-movements por rol y tipo (201 / 403)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const matriz: Array<[string, Record<string, unknown>, number]> = [
    ["dueno", gasto(), 201],
    ["gerente", gasto(), 201],
    ["recepcion", gasto(), 201],
    ["barbero", gasto(), 403],
    ["soloVer", gasto(), 403],
    [null as unknown as string, gasto(), 401],
    ["dueno", { type: "DEPOSIT", amount: 200 }, 201],
    ["recepcion", { type: "DEPOSIT", amount: 50 }, 201],
    ["barbero", { type: "DEPOSIT", amount: 50 }, 403],
    ["dueno", { type: "WITHDRAWAL", amount: 100 }, 201],
    ["gerente", { type: "WITHDRAWAL", amount: 100 }, 201],
    ["recepcion", { type: "WITHDRAWAL", amount: 100 }, 403],
    ["barbero", { type: "WITHDRAWAL", amount: 100 }, 403],
    ["soloVer", { type: "WITHDRAWAL", amount: 100 }, 403],
    ["gerente", { type: "BARBER_PAYOUT", amount: 50, barberId: "" }, 400],
    ["recepcion", { type: "BARBER_PAYOUT", amount: 50 }, 403],
    ["barbero", { type: "BARBER_PAYOUT", amount: 50 }, 403],
  ];
  for (const [tag, body, esperado] of matriz) {
    const b = body.type === "BARBER_PAYOUT" && body.barberId === undefined ? { ...body, barberId: barberoId } : body;
    const r = await como(tag, "cash-movements", "POST", { body: b });
    assert.equal(r.status, esperado, `${tag ?? "sin sesión"} ${String(body.type)}: ${JSON.stringify(r.body)}`);
  }
  // Un 403 no deja nada escrito.
  const n = await prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM "barber_cash_movements" WHERE "barbershopId" = ${shopId}`;
  assert.equal(n[0].n, 7, "solo los 201");
});

test("anular: la misma llave que registrar (Recepción anula un gasto, no un retiro); el Barbero nada; otra barbería → 404", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const g = await como("dueno", "cash-movements", "POST", { body: gasto(33) });
  const w = await como("dueno", "cash-movements", "POST", { body: { type: "WITHDRAWAL", amount: 44 } });
  const gid = (g.body as { movement: { id: string } }).movement.id;
  const wid = (w.body as { movement: { id: string } }).movement.id;
  assert.equal((await como("barbero", "cash-movements/[id]/void", "POST", { params: { id: gid }, body: {} })).status, 403);
  assert.equal((await como("soloVer", "cash-movements/[id]/void", "POST", { params: { id: gid }, body: {} })).status, 403);
  assert.equal((await como("recepcion", "cash-movements/[id]/void", "POST", { params: { id: wid }, body: {} })).status, 403);
  assert.equal((await como("ajeno", "cash-movements/[id]/void", "POST", { params: { id: gid }, body: {}, shop: otraId })).status, 404, "dueño de OTRA barbería");
  const ok = await como("recepcion", "cash-movements/[id]/void", "POST", { params: { id: gid }, body: { reason: "doble" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await como("gerente", "cash-movements/[id]/void", "POST", { params: { id: wid }, body: {} })).status, 200);
});

test("comprobante: subir pide cash.expenses o cash.withdraw; verlo pide cash.view; de otra barbería → 404", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  assert.equal((await como("barbero", "cash-movements/receipt", "POST", { body: {} })).status, 403);
  assert.equal((await como("soloVer", "cash-movements/receipt", "POST", { body: {} })).status, 403);
  assert.equal((await como("recepcion", "cash-movements/receipt", "POST", { body: {} })).status, 400, "pasa el permiso; falla porque no llegó foto");
  const g = await como("dueno", "cash-movements", "POST", { body: gasto(12) });
  const gid = (g.body as { movement: { id: string } }).movement.id;
  assert.equal((await como("barbero", "cash-movements/[id]/receipt", "GET", { params: { id: gid } })).status, 403);
  assert.equal((await como("soloVer", "cash-movements/[id]/receipt", "GET", { params: { id: gid } })).status, 404, "puede ver; ese gasto no tiene foto");
  assert.equal((await como("ajeno", "cash-movements/[id]/receipt", "GET", { params: { id: gid } })).status, 404);
});

test("Gastos y Cortes (lectura): cash.view sí, Barbero no; cerrar caja pide cash.manage", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  for (const rel of ["cash-movements/expenses", "cash-sessions/cortes"]) {
    assert.equal((await como("soloVer", rel, "GET")).status, 200, `soloVer ${rel}`);
    assert.equal((await como("recepcion", rel, "GET")).status, 200, `recepcion ${rel}`);
    assert.equal((await como("barbero", rel, "GET")).status, 403, `barbero ${rel}`);
    assert.equal((await como(null, rel, "GET")).status, 401);
  }
  const csv = await como("soloVer", "cash-sessions/cortes", "GET", { query: "format=csv" });
  assert.equal(csv.status, 200);
  assert.match(String(csv.body), /Fondo/);
  // cash.view sin cash.manage: no abre, no cierra, no cobra.
  assert.equal((await como("soloVer", "cash-sessions/close", "POST", { body: { countedAmount: 1 } })).status, 403);
  assert.equal((await como("soloVer", "cash-sessions/open", "POST", { body: { openingAmount: 1 } })).status, 403);
  assert.equal((await como("soloVer", "sales", "POST", { body: { items: [] } })).status, 403);
  assert.equal((await como("barbero", "cash-sessions/close", "POST", { body: { countedAmount: 1 } })).status, 403);
  // Los gastos de la otra barbería no se ven.
  const r = await como("ajeno", "cash-movements/expenses", "GET");
  assert.equal((r.body as { items: unknown[] }).items.length, 0);
});

test("pago de comisión «sale de la caja»: Recepción no (403); el Encargado sí", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  const { currentPeriodKey } = await import("@/lib/barber/commissions");
  const periodKey = currentPeriodKey("America/Mexico_City");
  assert.equal((await como("recepcion", "commissions/pay", "POST", { body: { barberId: barberoId, periodKey, fromCash: true } })).status, 403);
  assert.equal((await como("barbero", "commissions/pay", "POST", { body: { barberId: barberoId, periodKey, fromCash: true } })).status, 403);
  const ok = await como("gerente", "commissions/pay", "POST", { body: { barberId: barberoId, periodKey, fromCash: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test("quitar un acceso = la SIGUIENTE petición ya no pasa (y «nada» no hereda el rol)", { skip: skipDb }, async (t) => {
  if (skip) return t.skip(skip);
  assert.equal((await como("rita", "cash-movements", "POST", { body: gasto() })).status, 201, "Recepción de fábrica registra gastos");
  // El dueño le quita SOLO «Registrar gastos y entradas» con la matriz de Equipo.
  const sinGastos = [...resolveBarberPermissions("RECEPTION", null)].filter((k) => k !== "cash.expenses");
  const put = await como("dueno", "team/members/[id]/permissions", "PUT", { params: { id: uid.rita }, body: { permissions: sinGastos } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await como("rita", "cash-movements", "POST", { body: gasto() })).status, 403, "ya no");
  assert.equal((await como("rita", "cash-movements", "POST", { body: { type: "DEPOSIT", amount: 5 } })).status, 403, "entradas tampoco");
  assert.equal((await como("rita", "cash-movements/expenses", "GET")).status, 200, "sigue viendo la caja");
  // Le da «Sacar efectivo»: ahora sí puede sacar.
  const conSacar = [...sinGastos, "cash.withdraw"];
  assert.equal((await como("dueno", "team/members/[id]/permissions", "PUT", { params: { id: uid.rita }, body: { permissions: conSacar } })).status, 200);
  assert.equal((await como("rita", "cash-movements", "POST", { body: { type: "WITHDRAWAL", amount: 5 } })).status, 201);
  // G1: apagar TODO no devuelve los permisos del rol.
  assert.equal((await como("dueno", "team/members/[id]/permissions", "PUT", { params: { id: uid.rita }, body: { permissions: [] } })).status, 200);
  for (const body of [gasto(), { type: "WITHDRAWAL", amount: 5 }]) {
    assert.equal((await como("rita", "cash-movements", "POST", { body })).status, 403, `nada = nada (${String(body.type)})`);
  }
  assert.equal((await como("rita", "cash-movements/expenses", "GET")).status, 403);
});
