// RONDA 4 · punto 7 de «lo que un barbero no entendería» (revisora ws6-t3,
// ronda 6). Solo TEXTO: la regla de la lealtad no cambia; aquí se fija tal
// como es y se comprueba que lo que se LEE dice eso mismo.
//
//   1. La casilla del cobro decía «Canjear premio de lealtad: Barba gratis
//      (3 sellos)» y dejaba gratis el servicio que estuviera en el ticket,
//      fuera barba o no. Ahora es genérica («Aplicar premio de lealtad
//      (3 sellos)») y, al marcarla, dice el servicio EXACTO que queda gratis
//      y cómo se llama el premio de la barbería.
//   2. Configuración decía «Con 10, la décima visita se lleva el premio».
//      Con cita sí (el sello cae al completar la visita, antes de cobrar);
//      sin cita el sello cae al cobrar y el premio se usa en la SIGUIENTE.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/lealtad-premio-textos-integration.test.ts
//
// Los textos se prueban siempre; la parte de la regla solo contra una base
// LOCAL (crea y borra una barbería: ver _base-local.ts).
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import type { Dictionary } from "@/i18n/t";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { makeBarberT } from "@/lib/barber/i18n";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BarberCajaError } from "@/lib/barber/commissions";
import { createSale, getCheckoutContext, lookupClients, openCashSession } from "@/lib/barber/cash";
import { loyaltyRedeemText } from "@/components/barber/cash/loyalty-redeem-text";

const ROOT = join(__dirname, "..", "..", "..", "..");
const RUN = `t${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;
const MIN = 60_000;
const DAY = 86_400_000;

type Locale = "es" | "en";
const dictOf = (locale: Locale) => (getBarberDict(locale) as unknown as { barber: Record<string, Dictionary> }).barber;
const cajaT = (locale: Locale) => makeBarberT(dictOf(locale).caja);
const ajustesT = (locale: Locale) => makeBarberT(dictOf(locale).ajustes);

// ═══ 1. Lo que se lee (sin base) ════════════════════════════════════════

test("la casilla del cobro es genérica: no lleva el nombre del premio", () => {
  const es = loyaltyRedeemText(cajaT("es"), { stamps: 3, reward: "Barba gratis", serviceName: null });
  assert.equal(es.label, "Aplicar premio de lealtad (3 sellos)");
  assert.doesNotMatch(es.label, /Barba/, "ya no parece que lo que se regala es la barba");
  assert.equal(es.effect, null, "sin servicio elegido no promete nada");

  const en = loyaltyRedeemText(cajaT("en"), { stamps: 3, reward: "Barba gratis", serviceName: "" });
  assert.equal(en.label, "Apply loyalty reward (3 stamps)");
  assert.equal(en.effect, null);
});

test("al marcarla dice el servicio EXACTO que queda gratis y, aparte, el premio de la barbería", () => {
  const es = loyaltyRedeemText(cajaT("es"), { stamps: 3, reward: "Barba gratis", serviceName: "Corte" });
  assert.equal(es.effect, "«Corte» queda gratis en este ticket. El premio de la barbería es «Barba gratis».");

  const otra = loyaltyRedeemText(cajaT("es"), { stamps: 10, reward: "Corte gratis", serviceName: "Barba" });
  assert.equal(otra.label, "Aplicar premio de lealtad (10 sellos)");
  assert.equal(otra.effect, "«Barba» queda gratis en este ticket. El premio de la barbería es «Corte gratis».");

  const en = loyaltyRedeemText(cajaT("en"), { stamps: 3, reward: "Free beard", serviceName: "Haircut" });
  assert.equal(en.effect, "“Haircut” is free on this ticket. This shop's reward is “Free beard”.");
});

test("el cobro usa esos textos (y ya no arma «Canjear premio de lealtad: {reward}»)", () => {
  const src = readFileSync(join(ROOT, "src/components/barber/cash/ticket-modal.tsx"), "utf8");
  assert.match(src, /loyaltyRedeemText\(t, \{/);
  // ws6-t5: la casilla se volvió el selector «Aplicar bono» (varios bonos);
  // el efecto del servicio gratis sigue saliendo de este mismo texto probado.
  assert.match(src, /st\("caja\.applyBonus"\)/);
  assert.match(src, /loyaltyText\.effect \? /);
  assert.doesNotMatch(src, /t\("ticket\.loyaltyRedeem"/, "la casilla no se arma por fuera del texto probado");
  for (const locale of ["es", "en"] as const) {
    const raw = JSON.parse(readFileSync(join(ROOT, `src/i18n/dictionaries/barber/caja.${locale}.json`), "utf8"));
    assert.doesNotMatch(raw.ticket.loyaltyRedeem, /\{reward\}/, `[${locale}] la casilla no lleva el nombre del premio`);
    assert.match(raw.ticket.loyaltyRedeemEffect, /\{service\}.*\{reward\}/, `[${locale}] el efecto nombra el servicio y el premio`);
  }
});

test("Configuración ya no promete «la décima visita se lleva el premio»: dice con cita y sin cita", () => {
  const es = ajustesT("es")("configuracion.loyalty.thresholdHint");
  assert.doesNotMatch(es, /la décima visita se lleva el premio/);
  assert.match(es, /Con cita, el sello cae al completar la visita: la décima cita ya puede salir gratis\./);
  assert.match(es, /Sin cita, el sello cae al cobrar: el premio se usa en la visita siguiente\./);
  assert.match(es, /Cuentan las citas completadas y las ventas de servicio en caja\./, "lo que cuenta como visita no cambió");

  const en = ajustesT("en")("configuracion.loyalty.thresholdHint");
  assert.doesNotMatch(en, /the tenth visit earns the reward/);
  assert.match(en, /With an appointment, the stamp lands when the visit is completed/);
  assert.match(en, /Without one, the stamp lands when they pay: the reward is used on the next visit\./);
});

// ═══ 2. Lo que de verdad pasa (la regla, sin tocarla) ════════════════════

let shopId = "";
let ctx: BarberContext;
let barberId = "";
let corte = "";
let barba = "";
let conCita = "";
let sinCita = "";

const estado = async (name: string) => {
  const hits = await lookupClients(ctx, name);
  assert.equal(hits.length, 1, `un cliente llamado ${name}`);
  return { sellos: hits[0].loyaltyCount, premio: hits[0].loyaltyEligible };
};

const mostrador = (clientId: string, extra: Record<string, unknown> = {}) =>
  createSale(ctx, { barberId, clientId, items: [{ kind: "service", id: corte }], paymentMethod: "CASH", ...extra }, FEATURES);

before(async () => {
  if (!HAS_DB) return;
  // Umbral 3 y premio «Barba gratis»: lo mismo que puso la revisora para probar.
  const shop = await prisma.barbershop.create({
    data: {
      name: "Barbería Ronda 4 lealtad", slug: `${RUN}-lealtad`, plan: "PROFESIONAL", subscriptionStatus: "active",
      timezone: "America/Mexico_City", loyaltyThreshold: 3, loyaltyReward: "Barba gratis",
    },
  });
  shopId = shop.id;
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-owner`, email: `${RUN}@test.local`, firstName: "Dueña", lastName: "R4", role: "OWNER" },
  });
  ctx = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber: null, role: "OWNER" };
  barberId = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Uno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  corte = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  barba = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Barba", durationMin: 20, price: new Prisma.Decimal(140) } })).id;
  const tel = Date.now().toString().slice(-7);
  conCita = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: `Concita ${RUN}`, phone: `556${tel}` } })).id;
  sinCita = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: `Sincita ${RUN}`, phone: `557${tel}` } })).id;
  await openCashSession(ctx, { openingAmount: 0 });
});

after(async () => {
  if (!HAS_DB || !shopId) return;
  const w = { barbershopId: shopId };
  await prisma.barberCommissionEntry.deleteMany({ where: w });
  await prisma.barberSaleItem.deleteMany({ where: { sale: w } });
  await prisma.barberSale.deleteMany({ where: w });
  await prisma.barberCashSession.deleteMany({ where: w });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: w } });
  await prisma.barberAppointment.deleteMany({ where: w });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

test("la caja lee la regla de la barbería: 3 sellos, premio «Barba gratis»", { skip }, async () => {
  const checkout = await getCheckoutContext(ctx, FEATURES);
  assert.equal(checkout.loyaltyEnabled, true);
  assert.equal(checkout.loyaltyTarget, 3);
  assert.equal(checkout.loyaltyReward, "Barba gratis");
});

test("CON cita: el sello cae al completar la visita, así que la TERCERA cita ya puede salir gratis", { skip }, async () => {
  // Dos citas ya completadas y cobradas hace semanas.
  for (let i = 0; i < 2; i++) {
    const start = new Date(Date.now() - (20 + i) * DAY);
    await prisma.barberAppointment.create({
      data: { barbershopId: shopId, clientId: conCita, status: "DONE", startAt: start, endAt: new Date(start.getTime() + 30 * MIN) },
    });
  }
  assert.deepEqual(await estado(`Concita ${RUN}`), { sellos: 2, premio: false });

  // La tercera: se completa (todavía sin cobrar) y el premio ya está.
  const start = new Date(Date.now() - 40 * MIN);
  const tercera = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, clientId: conCita, barberId, status: "DONE", startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId: corte, priceAtBooking: new Prisma.Decimal(180) }] },
    },
  });
  assert.deepEqual(await estado(`Concita ${RUN}`), { sellos: 3, premio: true }, "3 de 3 antes de cobrar la tercera");

  const sale = await createSale(
    ctx,
    { appointmentId: tercera.id, items: [{ kind: "service", id: corte }], redeemLoyaltyItemIndex: 0, paymentMethod: "CASH" },
    FEATURES,
  );
  assert.equal(sale.total, 0, "la tercera cita sale gratis");
});

let cuarta: Awaited<ReturnType<typeof createSale>>;

test("SIN cita: el sello cae al cobrar, así que en la tercera visita aún no hay premio; se usa en la SIGUIENTE", { skip }, async () => {
  await mostrador(sinCita);
  await mostrador(sinCita);
  assert.deepEqual(await estado(`Sincita ${RUN}`), { sellos: 2, premio: false }, "llega a su tercera visita con 2 de 3");

  await assert.rejects(
    mostrador(sinCita, { redeemLoyaltyItemIndex: 0 }),
    (e: unknown) => e instanceof BarberCajaError && e.code === "LOYALTY_NOT_ELIGIBLE",
    "la tercera visita sin cita NO sale gratis",
  );
  const tercera = await mostrador(sinCita);
  assert.equal(tercera.total, 180, "la paga completa");
  assert.deepEqual(await estado(`Sincita ${RUN}`), { sellos: 3, premio: true }, "al cobrarla cae el tercer sello");

  // Cuarta visita: corte + barba, y el premio se aplica al CORTE.
  cuarta = await mostrador(sinCita, { items: [{ kind: "service", id: corte }, { kind: "service", id: barba }], redeemLoyaltyItemIndex: 0 });
  assert.equal(cuarta.total, 140, "el premio se usa en la visita siguiente");
});

test("el premio «Barba gratis» deja gratis el servicio ELEGIDO (aquí el corte), tal como avisa el texto", { skip }, async () => {
  const [lineaCorte, lineaBarba] = cuarta.items;
  assert.match(lineaCorte.description, /^Corte/);
  assert.equal(lineaCorte.unitPrice, 0, "el corte quedó en $0…");
  assert.match(lineaBarba.description, /^Barba/);
  assert.equal(lineaBarba.unitPrice, 140, "…y la barba se cobró, aunque el premio se llame «Barba gratis»");

  const aviso = loyaltyRedeemText(cajaT("es"), { stamps: 3, reward: "Barba gratis", serviceName: "Corte" });
  assert.equal(aviso.effect, "«Corte» queda gratis en este ticket. El premio de la barbería es «Barba gratis».");
});
