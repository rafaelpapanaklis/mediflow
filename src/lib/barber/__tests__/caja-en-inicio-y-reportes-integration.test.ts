// ═══════════════════════════════════════════════════════════════════════
// Caja completa en Inicio y Reportes (ws6-t5, 16-nov-2026) — contra una base
// REAL y por las rutas REALES (/api/barber/stats/inicio y /reports) con el
// getBarberContext REAL; solo la sesión de Supabase está doblada
// (_permisos-arnes.ts).
//
//   · Las cuentas: gasto anulado no cuenta; gasto con tarjeta sí en la
//     ganancia y no en el efectivo; otra sede y otra barbería no se mezclan;
//     «En caja ahora» de Inicio = el esperado de la Caja, número por número.
//   · Permisos: quien no tiene «Ver caja» (Barbero, Recepción sin ese
//     permiso) no recibe NI UN monto nuevo: campo ausente o 403.
//   · Sin sql/barber_caja_completa.sql: Inicio y Reportes como antes.
//
//   # con el SQL pegado (base "caja") y sin él (base "sinsql"):
//   DATABASE_URL=postgresql://…@127.0.0.1:…/caja DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/caja-en-inicio-y-reportes-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { sesion, llamar, type Resp } from "./_permisos-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BASE_LOCAL as HAS_DB, skip as skipDb } from "./_base-local";

const RUN = `cir${Date.now().toString(36)}`;
const TZ = "America/Mexico_City";
const API = path.resolve(__dirname, "../../../app/api/barber");
const ruta = (rel: string) => import(path.join(API, rel, "route.ts")) as Promise<Record<string, Parameters<typeof llamar>[0]>>;

let prisma: typeof import("@/lib/prisma")["prisma"];
let cash: typeof import("@/lib/barber/cash");
let dinero: typeof import("@/lib/barber/caja-dinero");
let ready = false;

const sb: Record<string, string> = {};
const ctxs: Record<string, BarberContext> = {};
let shopA: string; // la sede del dueño (matriz)
let shopA2: string; // otra sede de la misma cadena
let shopB: string; // otra barbería
let shopC: string; // caja abierta desde antier
let juan: string;
let beto: string;

async function persona(tag: string, shopId: string, role: "OWNER" | "RECEPTION" | "BARBER", extra: Partial<Prisma.BarberUserUncheckedCreateInput> = {}) {
  const supabaseId = `${RUN}-${tag}`;
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId, email: `${supabaseId}@test.local`, firstName: tag, lastName: "Prueba", role, ...extra },
  });
  const barbershop = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
  sb[tag] = supabaseId;
  ctxs[tag] = { barberUserId: user.id, barbershopId: shopId, barbershop, user, barber: null, role } as BarberContext;
}

async function shop(suffix: string, extra: Partial<Prisma.BarbershopUncheckedCreateInput> = {}) {
  return (
    await prisma.barbershop.create({
      data: { name: `Caja ${suffix}`, slug: `${RUN}-${suffix}`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: TZ, locale: "es", ...extra },
    })
  ).id;
}

async function mov(p: { shop: string; by: string; session?: string | null; type: string; method?: string; amount: number; category?: string; barberId?: string; payoutKind?: string; voided?: boolean }) {
  await prisma.$executeRaw`
    INSERT INTO "barber_cash_movements" ("id", "barbershopId", "sessionId", "type", "method", "amount", "category", "barberId", "payoutKind", "createdByUserId", "createdAt", "voidedAt", "voidedByUserId")
    VALUES (${randomUUID()}, ${p.shop}, ${p.session ?? null}, ${p.type}, ${p.method ?? "CASH"}, ${new Prisma.Decimal(p.amount).toFixed(2)}::numeric, ${p.category ?? null},
            ${p.barberId ?? null}, ${p.payoutKind ?? null}, ${p.by}, now(), ${p.voided ? new Date() : null}, ${p.voided ? p.by : null})
  `;
}

/** Llama una ruta GET como `tag`. */
async function como(tag: string, rel: string, query = ""): Promise<Resp> {
  sesion.supabaseId = sb[tag];
  sesion.cookieSede = null;
  sesion.pinSede = null;
  const mod = await ruta(rel);
  return llamar(mod.GET, { url: `http://localhost/api/barber/${rel}${query ? `?${query}` : ""}` });
}
const body = (r: Resp) => r.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  dinero = await import("@/lib/barber/caja-dinero");
  const { cashMovementsReady, resetCashMovementsReadyCache } = await import("@/lib/barber/cash-movements");
  resetCashMovementsReadyCache();
  ready = await cashMovementsReady(prisma);
  const { FALLBACK_BARBER_PLAN_CONFIG } = await import("@/lib/barber/plan-shared");
  const PRO = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;

  shopA = await shop("a");
  shopA2 = await shop("a2", { parentId: shopA, branchName: "Norte" });
  shopB = await shop("b");
  shopC = await shop("c");
  juan = (await prisma.barber.create({ data: { barbershopId: shopA, name: "Juan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  beto = (await prisma.barber.create({ data: { barbershopId: shopA, name: "Beto", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  const corte = (await prisma.barberService.create({ data: { barbershopId: shopA, name: "Corte", durationMin: 30, price: new Prisma.Decimal(800) } })).id;
  const corteA2 = (await prisma.barberService.create({ data: { barbershopId: shopA2, name: "Corte", durationMin: 30, price: new Prisma.Decimal(400) } })).id;

  await persona("dueno", shopA, "OWNER");
  await persona("barbero", shopA, "BARBER", { barberId: juan });
  // Recepción a la que el dueño le quitó «Ver caja» (y «Cobrar»), pero ve comisiones → entra a Reportes.
  await persona("recepcion", shopA, "RECEPTION", { permissionsOverride: ["agenda.view", "clients.view", "commissions.view"] });
  await persona("duenoB", shopB, "OWNER");
  await persona("duenoC", shopC, "OWNER");
  const enA2: BarberContext = { ...ctxs.dueno, barbershopId: shopA2, barbershop: await prisma.barbershop.findUniqueOrThrow({ where: { id: shopA2 } }) };

  // Sede A, hoy: fondo 500, efectivo 800 + 50 de propina, tarjeta 800.
  const open = await cash.openCashSession(ctxs.dueno, { openingAmount: 500 });
  await cash.createSale(ctxs.dueno, { barberId: juan, items: [{ kind: "service", id: corte }], tip: 50, paymentMethod: "CASH" }, PRO);
  await cash.createSale(ctxs.dueno, { barberId: beto, items: [{ kind: "service", id: corte }], paymentMethod: "CARD" }, PRO);
  // La otra sede vende y gasta; la otra barbería también.
  await cash.openCashSession(enA2, { openingAmount: 0 });
  await cash.createSale(enA2, { items: [{ kind: "service", id: corteA2 }], paymentMethod: "CASH" }, PRO);
  // Caja C abierta desde antier.
  const openC = await cash.openCashSession(ctxs.duenoC, { openingAmount: 300 });
  await prisma.barberCashSession.update({ where: { id: openC.session.id }, data: { openedAt: new Date(Date.now() - 2 * 86_400_000) } });

  if (!ready) return;
  const by = ctxs.dueno.barberUserId;
  const s = open.session.id;
  await mov({ shop: shopA, by, session: s, type: "EXPENSE", amount: 80, category: "SUPPLIES" }); // garrafón, del cajón
  await mov({ shop: shopA, by, session: null, type: "EXPENSE", amount: 300, method: "CARD", category: "CLEANING" }); // con tarjeta
  await mov({ shop: shopA, by, session: s, type: "EXPENSE", amount: 999, category: "OTHER", voided: true }); // anulado
  await mov({ shop: shopA, by, session: s, type: "BARBER_PAYOUT", amount: 200, barberId: juan, payoutKind: "ADVANCE" });
  await mov({ shop: shopA, by, session: null, type: "BARBER_PAYOUT", amount: 150, method: "TRANSFER", barberId: beto, payoutKind: "COMMISSION" });
  await mov({ shop: shopA, by, session: s, type: "WITHDRAWAL", amount: 1000 });
  await mov({ shop: shopA, by, session: s, type: "DEPOSIT", amount: 200 });
  await mov({ shop: shopA2, by, session: null, type: "EXPENSE", amount: 7777, method: "TRANSFER", category: "RENT" });
  await mov({ shop: shopB, by: ctxs.duenoB.barberUserId, session: null, type: "EXPENSE", amount: 5555, category: "RENT" });
  await mov({ shop: shopC, by: ctxs.duenoC.barberUserId, session: openC.session.id, type: "EXPENSE", amount: 100, category: "FOOD" });
});

after(async () => {
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((x) => x.id);
  if (ready) await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY(${ids}::text[])`;
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.updateMany({ where: { id: { in: ids } }, data: { parentId: null } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ── Con el SQL de caja completa ─────────────────────────────────────────

test("Inicio del dueño: gastos de hoy, te queda hoy y en caja ahora (= la Caja)", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const r = await como("dueno", "stats/inicio");
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const m = body(r).money;
  assert.ok(m, "viaja el dinero de hoy");
  assert.equal(m.income, 1600, "850 + 800 − 50 de propina = la cifra de «Ingresos de hoy»");
  assert.equal(body(r).today.revenue, m.income, "cuadra con la banda de Inicio");
  assert.equal(m.expenses, 380, "80 efectivo + 300 tarjeta; el anulado de 999 y los 7,777 de la otra sede no");
  assert.equal(m.expensesCash, 80, "el de tarjeta no salió del cajón");
  assert.equal(m.payouts, 350, "lo entregado hoy se enseña, pero ya no resta (G2)");
  assert.equal(m.tips, 50, "las propinas, aparte");
  assert.equal(m.barberCost, 800, "comisión devengada: 50 % de 800 + 50 % de 800, sin propinas");
  assert.equal(m.profit, 420, "1,600 − 380 − 800 (lo devengado, no lo pagado)");

  const c = body(r).cash;
  assert.equal(c.full, true);
  assert.equal(c.staleSince, null, "la caja es de hoy");
  // 500 + 850 + 200 − 80 − 1,000 − 200 = 270, y es EXACTAMENTE lo que dice la Caja.
  assert.equal(c.expectedCash, 270);
  const state = await cash.getCashState(ctxs.dueno);
  assert.equal(c.expectedCash, state.open!.expectedCash, "Inicio y Caja dan el mismo número");
});

test("Inicio: caja abierta de OTRO día → aviso con el día en que se abrió", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const r = await como("duenoC", "stats/inicio");
  assert.equal(r.status, 200);
  const c = body(r).cash;
  const session = await prisma.barberCashSession.findFirstOrThrow({ where: { barbershopId: shopC, closedAt: null } });
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(session.openedAt);
  assert.equal(c.staleSince, dia);
  assert.equal(c.expectedCash, 200, "300 de fondo − 100 de comida (aunque el gasto sea de hoy y la caja de antier)");
  assert.equal(c.expectedCash, (await cash.getCashState(ctxs.duenoC)).open!.expectedCash);
  assert.equal(body(r).money.expenses, 100);
});

test("Reportes del dueño: ingresos y gastos, ganancia, comparación y por barbero", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const r = await como("dueno", "stats/reports", "range=today");
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const cf = body(r).cashFlow;
  assert.ok(cf, "viaja la sección");
  assert.equal(cf.current.charged, 1650);
  assert.equal(cf.current.tips, 50);
  assert.equal(cf.current.income, 1600);
  assert.equal(cf.current.income, body(r).totals.revenue, "cuadra con «Ingresos» de Reportes");
  assert.equal(cf.current.byMethod.CASH.total, 850);
  assert.equal(cf.current.byMethod.CARD.total, 800);
  assert.deepEqual(
    cf.current.expenses.byCategory.map((x: { category: string; total: number }) => [x.category, x.total]),
    [["CLEANING", 300], ["SUPPLIES", 80]],
    "por categoría, sin el anulado ni la renta de la otra sede",
  );
  assert.equal(cf.current.payouts.byKind.ADVANCE, 200);
  assert.equal(cf.current.payouts.byKind.COMMISSION, 150);
  assert.equal(cf.current.barberCost.total, 800);
  assert.equal(cf.current.profit, 420);
  assert.equal(cf.current.cashNet, -230, "850 + 200 − 80 − 1,000 − 200: la tarjeta no toca el cajón");
  assert.equal(cf.previous.profit, 0);
  assert.equal(cf.vsPrevProfitPct, null, "sin periodo anterior no hay porcentaje");
  assert.equal(cf.barberFiltered, false);

  const fila = (id: string) => body(r).byBarber.find((b: { barberId: string }) => b.barberId === id);
  assert.deepEqual([fila(juan).tips, fila(juan).paidOut, fila(juan).advances], [50, 200, 200]);
  assert.deepEqual([fila(beto).tips, fila(beto).paidOut, fila(beto).advances], [0, 150, 0]);

  const csv = await como("dueno", "stats/reports", "range=today&format=csv&section=money");
  assert.equal(csv.status, 200);
  const txt = String(csv.body);
  assert.match(txt, /Ganancia,420/);
  assert.match(txt, /Comisiones y sueldos devengados \(sin propinas\),800/);
  assert.match(txt, /No incluye cobros en línea/);
  assert.match(txt, /Gastos,380/);
  assert.match(txt, /Limpieza,1,300/);
  assert.doesNotMatch(txt, /7777|5555/);
  const todo = String((await como("dueno", "stats/reports", "range=today&format=csv")).body);
  assert.match(todo, /Ingresos y gastos/, "el CSV completo también la trae");
  assert.match(todo, /Juan,1,800,50,800,(.*,)?200,200/, "y por barbero: propinas, pagado y adelantos");
});

test("🔴 otra sede y otra barbería no se mezclan; la cadena junta solo sus sedes", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
  const soloA = await dinero.getDineroPeriodo(ctxs.dueno, [shopA], range);
  const cadena = await dinero.getDineroPeriodo(ctxs.dueno, [shopA, shopA2], range);
  assert.equal(soloA!.dinero.expenses.total, 380);
  assert.equal(cadena!.dinero.expenses.total, 380 + 7777, "la renta de la sede Norte entra en la cadena");
  assert.equal(cadena!.dinero.income, 1600 + 400);
  assert.ok(!cadena!.dinero.expenses.byCategory.some((x) => x.total === 5555), "la otra barbería jamás");
  // Por la ruta: «Toda la cadena», si la cadena se puede consolidar.
  const r = await como("dueno", "stats/inicio", "branchId=all");
  if (body(r).scope.consolidated) assert.equal(body(r).money.expenses, 380 + 7777);
});

test("🔴 sin «Ver caja» no viaja NI UN monto nuevo (Barbero y Recepción sin el permiso)", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  for (const tag of ["barbero", "recepcion"]) {
    const ini = await como(tag, "stats/inicio");
    assert.equal(ini.status, 200, tag);
    assert.ok(!("money" in body(ini)), `${tag}: Inicio sin «money»`);
    assert.equal(body(ini).cash, null, `${tag}: ni la tarjeta de caja`);

    const rep = await como(tag, "stats/reports", "range=today");
    assert.equal(rep.status, 200, `${tag}: entra a Reportes por «Ver comisiones»`);
    assert.ok(!("cashFlow" in body(rep)), `${tag}: Reportes sin «cashFlow»`);
    for (const b of body(rep).byBarber) {
      assert.ok(!("paidOut" in b) && !("advances" in b), `${tag}: por barbero sin pagado ni adelantos`);
    }
    const txt = JSON.stringify(body(rep));
    assert.doesNotMatch(txt, /"profit"|"expenses"|"payouts"/, `${tag}: ninguna llave de gastos en la respuesta`);

    const csvMoney = await como(tag, "stats/reports", "range=today&format=csv&section=money");
    assert.equal(csvMoney.status, 403, `${tag}: el CSV de ingresos y gastos es 403`);
    const csv = String((await como(tag, "stats/reports", "range=today&format=csv")).body);
    assert.doesNotMatch(csv, /Ingresos y gastos|Ganancia|Adelantos/, `${tag}: ni en el CSV completo`);
  }
  // Y la función misma se niega sin el permiso.
  await assert.rejects(() => dinero.getDineroPeriodo(ctxs.recepcion, [shopA], { from: new Date(0), to: new Date() }), /cash\.view/);
});

test("🔴 G2 (caso de t8): $800 + $50 de propina al 50 % → Ganancia $400 en Reportes, Inicio y CSV, marcado pagado o no", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const { FALLBACK_BARBER_PLAN_CONFIG } = await import("@/lib/barber/plan-shared");
  const commissions = await import("@/lib/barber/commissions");
  const shopD = await shop("d");
  await persona("duenoD", shopD, "OWNER");
  const pepe = (await prisma.barber.create({ data: { barbershopId: shopD, name: "Pepe", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  const corte = (await prisma.barberService.create({ data: { barbershopId: shopD, name: "Corte", durationMin: 30, price: new Prisma.Decimal(800) } })).id;
  await cash.openCashSession(ctxs.duenoD, { openingAmount: 0 });
  await cash.createSale(ctxs.duenoD, { barberId: pepe, items: [{ kind: "service", id: corte }], tip: 50, paymentMethod: "CASH" }, FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features);

  const mirar = async () => {
    const rep = body(await como("duenoD", "stats/reports", "range=today"));
    const ini = body(await como("duenoD", "stats/inicio"));
    const csv = String((await como("duenoD", "stats/reports", "range=today&format=csv&section=money")).body);
    return { rep: rep.cashFlow, ini: ini.money, csv };
  };

  const antes = await mirar();
  assert.equal(antes.rep.current.income, 800);
  assert.equal(antes.rep.current.tips, 50);
  assert.equal(antes.rep.current.profit, 400, "sin marcar pagado: 800 − 400 de comisión");
  assert.equal(antes.ini.profit, 400, "Inicio «Te queda hoy», mismo criterio");
  assert.equal(antes.ini.tips, 50);
  assert.match(antes.csv, /Ganancia,400/);

  // Se marca pagado «Sale de la caja en efectivo»: $450 = 400 de comisión + 50 de propina.
  const periodKey = commissions.currentPeriodKey("America/Mexico_City");
  const pago = await commissions.markCommissionsPaid(ctxs.duenoD, { barberId: pepe, periodKey }, new Date(), { cashOut: { method: "CASH" } });
  assert.equal(pago.paidAmount, 450);

  const despues = await mirar();
  assert.equal(despues.rep.current.payouts.total, 450, "lo entregado se ve…");
  assert.equal(despues.rep.current.profit, 400, "…pero la ganancia NO cambia por marcar pagado");
  assert.equal(despues.ini.profit, 400);
  assert.equal(despues.ini.payouts, 450);
  assert.match(despues.csv, /Ganancia,400/);
  await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ${shopD}`;
});

test("N5: una sede con 5,000 movimientos o más en el periodo → Reportes lo avisa (truncated), no recorta en silencio", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const shopE = await shop("e");
  await persona("duenoE", shopE, "OWNER");
  const by = ctxs.duenoE.barberUserId;
  const sinTope = body(await como("duenoE", "stats/reports", "range=today")).cashFlow;
  assert.equal(sinTope.current.truncated, false);
  await prisma.$executeRaw`
    INSERT INTO "barber_cash_movements" ("id", "barbershopId", "type", "method", "amount", "category", "createdByUserId", "createdAt")
    SELECT gen_random_uuid()::text, ${shopE}, 'EXPENSE', 'CARD', 1, 'OTHER', ${by}, now() FROM generate_series(1, 5000)
  `;
  const conTope = await como("duenoE", "stats/reports", "range=today");
  assert.equal(body(conTope).cashFlow.current.truncated, true);
  const csv = String((await como("duenoE", "stats/reports", "range=today&format=csv&section=money")).body);
  assert.match(csv, /más de 5000 movimientos|más de 5,000 movimientos/);
  await prisma.$executeRaw`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ${shopE}`;
});

test("M6: si la lectura del dinero falla, Inicio enseña «—» (null), nunca la cuenta vieja", { skip: skipDb }, async (t) => {
  if (!ready) return t.skip("sql/barber_caja_completa.sql no está pegado en esta base");
  const stats = await import("@/lib/barber/stats");
  // Se rompe la lectura de movimientos SOLO durante esta llamada: la tabla (de esta base LOCAL de
  // pruebas) se renombra y se devuelve en el finally.
  await prisma.$executeRawUnsafe(`ALTER TABLE "barber_cash_movements" RENAME TO "barber_cash_movements_m6"`);
  // cashMovementsReady ya vio la tabla (caché por proceso): la consulta de movimientos falla de verdad.
  const errores: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errores.push(a);
  try {
    const s = await stats.getInicioSummary(ctxs.dueno, { features: (await import("@/lib/barber/plan-shared")).FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features });
    assert.equal(s.money?.unavailable, true);
    assert.equal(s.money?.profit, null);
    assert.equal(s.money?.expenses, null);
    assert.equal(s.cash?.expectedCash, null, "ni la cifra vieja de fondo + efectivo (que no cuadra con Caja)");
    assert.ok(errores.length > 0, "y queda registrado");
  } finally {
    console.error = original;
    await prisma.$executeRawUnsafe(`ALTER TABLE "barber_cash_movements_m6" RENAME TO "barber_cash_movements"`);
  }
});

// ── Sin el SQL ──────────────────────────────────────────────────────────

test("sin sql/barber_caja_completa.sql: Inicio y Reportes como hoy", { skip: skipDb }, async (t) => {
  if (ready) return t.skip("esta base SÍ tiene el SQL (corre la suite contra una sin él)");
  const r = await como("dueno", "stats/inicio");
  assert.equal(r.status, 200);
  assert.ok(!("money" in body(r)), "sin «Dinero de hoy»");
  const c = body(r).cash;
  assert.ok(!("full" in c) && !("staleSince" in c), "la tarjeta de caja de siempre");
  assert.equal(c.expectedCash, 500 + 850, "fondo + efectivo, la cuenta de antes");
  const rep = await como("dueno", "stats/reports", "range=today");
  assert.ok(!("cashFlow" in body(rep)));
  assert.ok(body(rep).byBarber.every((b: object) => !("paidOut" in b)));
  assert.equal((await como("dueno", "stats/reports", "range=today&format=csv&section=money")).status, 403);
  const csv = String((await como("dueno", "stats/reports", "range=today&format=csv")).body);
  assert.doesNotMatch(csv, /Ingresos y gastos/);
});
