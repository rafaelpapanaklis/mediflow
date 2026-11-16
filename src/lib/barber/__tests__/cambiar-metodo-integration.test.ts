// ─────────────────────────────────────────────────────────────────────────
// «Cambiar método de pago» de un ticket ya cobrado (lógica L2, ronda 2) contra
// Postgres de verdad: el corte por método y el esperado en efectivo se
// recalculan, la bitácora queda (quién, cuándo, de qué a qué) sin verse como
// nota, una membresía vendida con ese ticket se corrige igual, y después del
// corte solo se cancela.
//
//   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/cambiar-metodo-integration.test.ts
//
// Sin DATABASE_URL se SALTA. Jamás apuntarlo a producción.
// ─────────────────────────────────────────────────────────────────────────
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BarberCajaError } from "@/lib/barber/commissions";
import { BarberForbiddenError } from "@/lib/barber/permissions";
import {
  cancelSale,
  changeSalePaymentMethod,
  closeCashSession,
  createSale,
  getCashState,
  openCashSession,
} from "@/lib/barber/cash";
import { sellMembership } from "@/lib/barber/memberships";
import { parseMethodChanges } from "@/lib/barber/method-change-core";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";
const db = prisma;
const RUN = `m${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.AVANZADO.features;
const codeIs = (code: string) => (e: unknown) => e instanceof BarberCajaError && e.code === code;

let ctx: BarberContext;
let other: BarberContext;
let recep: BarberContext;
let shopId: string;
let corte: string;
let alan: string;
let client: string;
let plan: string;

before(async () => {
  if (!HAS_DB) return;
  const mk = async (name: string) => {
    const shop = await db.barbershop.create({
      data: { name, slug: `${RUN}-${name.toLowerCase()}`, plan: "AVANZADO", subscriptionStatus: "active", timezone: "America/Mexico_City" },
    });
    const user = await db.barberUser.create({
      data: { barbershopId: shop.id, supabaseId: `${RUN}-${name}`, email: `${RUN}-${name}@test.local`, firstName: "Dueña", lastName: name, role: "OWNER" },
    });
    return { shop, user, ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" } as BarberContext };
  };
  const a = await mk("A");
  const b = await mk("B");
  ctx = a.ctx;
  other = b.ctx;
  shopId = a.shop.id;
  const barberUser = await db.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-barb`, email: `${RUN}-barb@test.local`, firstName: "Solo", lastName: "Mira", role: "BARBER" },
  });
  recep = { barberUserId: barberUser.id, barbershopId: shopId, barbershop: a.shop, user: barberUser, barber: null, role: "BARBER" } as BarberContext;
  alan = (await db.barber.create({ data: { barbershopId: shopId, name: "Alan", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(40) } })).id;
  corte = (await db.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  client = (await db.barberClient.create({ data: { barbershopId: shopId, name: "Cliente Método", phone: "5511112222" } })).id;
  plan = (await db.barberMembership.create({ data: { barbershopId: shopId, name: "4 cortes", price: new Prisma.Decimal(500), includedCuts: 4, periodDays: 30 } })).id;
});

after(async () => {
  if (!HAS_DB) return;
  const ids = (await db.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } })).map((s) => s.id);
  await db.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await db.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberClientMembership.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await db.barbershop.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test("cambiar Efectivo → Tarjeta mueve el dinero en el corte y el esperado en efectivo", { skip }, async () => {
  await openCashSession(ctx, { openingAmount: 500 });
  const a = await createSale(ctx, { clientId: client, barberId: alan, items: [{ kind: "service", id: corte }], tip: 20, paymentMethod: "CASH" }, FEATURES);
  await createSale(ctx, { items: [{ kind: "service", id: corte }], paymentMethod: "CASH" }, FEATURES);

  const antes = (await getCashState(ctx)).open!;
  assert.equal(antes.byMethod.CASH.total, 380);
  assert.equal(antes.byMethod.CARD.total, 0);
  assert.equal(antes.expectedCash, 880, "500 + 200 + 180");

  const row = await changeSalePaymentMethod(ctx, a.id, { paymentMethod: "CARD" }, new Date("2026-11-15T20:00:00.000Z"));
  assert.equal(row.paymentMethod, "CARD");
  assert.equal(row.total, 200, "el importe no cambia");
  assert.deepEqual(row.methodChanges, [{ at: "2026-11-15T20:00:00.000Z", by: "Dueña A", from: "CASH", to: "CARD" }]);
  assert.equal(row.notes, null, "la bitácora no se enseña como nota");

  const despues = (await getCashState(ctx)).open!;
  assert.equal(despues.byMethod.CASH.total, 180);
  assert.equal(despues.byMethod.CASH.count, 1);
  assert.equal(despues.byMethod.CARD.total, 200);
  assert.equal(despues.byMethod.CARD.count, 1);
  assert.equal(despues.cashTips, 0, "la propina se fue con la tarjeta");
  assert.equal(despues.expectedCash, 680, "500 + 180: los 200 ya no están en el cajón");
  assert.equal(despues.session.salesTotal, antes.session.salesTotal, "lo vendido no cambia");

  // Otro cambio: la bitácora conserva los dos, en orden.
  await changeSalePaymentMethod(ctx, a.id, { paymentMethod: "SPEI" });
  const raw = await db.barberSale.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal(raw.paymentMethod, "SPEI");
  assert.deepEqual(parseMethodChanges(raw.notes).map((c) => `${c.from}>${c.to}`), ["CASH>CARD", "CARD>SPEI"]);
});

test("reglas: mismo método, método inválido, otra barbería, rol sin cobrar, cancelado", { skip }, async () => {
  const s = await createSale(ctx, { items: [{ kind: "service", id: corte }], paymentMethod: "CARD" }, FEATURES);
  await assert.rejects(changeSalePaymentMethod(ctx, s.id, { paymentMethod: "CARD" }), codeIs("SAME_METHOD"));
  await assert.rejects(changeSalePaymentMethod(ctx, s.id, { paymentMethod: "STRIPE" }), codeIs("INVALID_METHOD"));
  await assert.rejects(changeSalePaymentMethod(ctx, s.id, { paymentMethod: "bitcoin" }), codeIs("INVALID_METHOD"));
  await assert.rejects(changeSalePaymentMethod(other, s.id, { paymentMethod: "CASH" }), codeIs("SALE_NOT_FOUND"));
  await assert.rejects(changeSalePaymentMethod(recep, s.id, { paymentMethod: "CASH" }), (e: unknown) => e instanceof BarberForbiddenError);

  // Cambiado y luego cancelado: la cancelación sigue funcionando y bloquea más cambios.
  await changeSalePaymentMethod(ctx, s.id, { paymentMethod: "CASH" });
  const c = await cancelSale(ctx, s.id, { reason: "se equivocó de servicio" });
  assert.equal(c.cancelled, true);
  assert.equal(c.methodChanges.length, 1, "la bitácora sobrevive a la cancelación");
  await assert.rejects(changeSalePaymentMethod(ctx, s.id, { paymentMethod: "CARD" }), codeIs("ALREADY_CANCELLED"));
});

test("membresía vendida con ese ticket: la tarjeta queda con el método corregido", { skip }, async () => {
  await sellMembership({ barbershopId: shopId, clientId: client, membershipId: plan, paymentMethod: "CASH", soldByUserId: ctx.barberUserId });
  const sale = await db.barberSale.findFirstOrThrow({ where: { barbershopId: shopId, notes: { contains: '"k":"membership"' } }, orderBy: { createdAt: "desc" } });
  const cm = await db.barberClientMembership.findFirstOrThrow({ where: { barbershopId: shopId, clientId: client } });
  assert.equal(cm.paymentMethod, "CASH");
  const row = await changeSalePaymentMethod(ctx, sale.id, { paymentMethod: "SPEI" });
  assert.equal(row.kind, "membership", "sigue siendo ticket de membresía (el sello no se tocó)");
  assert.equal((await db.barberClientMembership.findUniqueOrThrow({ where: { id: cm.id } })).paymentMethod, "SPEI");
});

test("después del corte solo se cancela: el turno cerrado no deja cambiar el método", { skip }, async () => {
  const s = await createSale(ctx, { items: [{ kind: "service", id: corte }], paymentMethod: "CASH" }, FEATURES);
  const open = (await getCashState(ctx)).open!;
  await closeCashSession(ctx, { countedAmount: open.expectedCash });
  await assert.rejects(changeSalePaymentMethod(ctx, s.id, { paymentMethod: "CARD" }), codeIs("SESSION_CLOSED"));
  const raw = await db.barberSale.findUniqueOrThrow({ where: { id: s.id } });
  assert.equal(raw.paymentMethod, "CASH", "nada cambió");
});
