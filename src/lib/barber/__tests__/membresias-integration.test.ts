// Integración contra Postgres REAL. Los invariantes de esta ola (cupo que
// no se pasa con dos cierres simultáneos, anticipo que no se aplica dos
// veces, aislamiento entre barberías) son garantías de base de datos: no se
// pueden fingir con mocks.
//
//   docker run -d --name barber-membresias-pg -e POSTGRES_PASSWORD=barber \
//     -e POSTGRES_DB=barber -p 54331:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:barber@localhost:54331/barber \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   psql ... -f sql/barber_membresias.sql
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test \
//     src/lib/barber/__tests__/membresias-integration.test.ts
//
// Sin DATABASE_URL se SALTAN (no fallan). JAMÁS apuntarlas a producción:
// crean y borran barberías.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  applyMembershipToVisit,
  consumeMembershipCutTx,
  getMembershipStats,
  listClientMemberships,
  listMembershipPlans,
  previewMembershipCoverage,
  renewClientMembership,
  sellMembership,
  sweepExpiredMemberships,
} from "../memberships";
import {
  applyDepositToSale,
  getBarberPaymentSettings,
  listDeposits,
  previewDepositForSale,
  saveBarberDepositPolicy,
  quoteDepositForBooking,
  BarberPaymentsError,
} from "../payments";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const RUN = `m${Date.now().toString(36)}`;
const DAY = 86_400_000;

interface Shop {
  id: string;
  userId: string;
  clientId: string;
  serviceId: string;
}

const shops: Record<"A" | "B", Shop> = {} as any;

async function makeShop(tag: string): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbería ${tag}`,
      slug: `${RUN}-${tag.toLowerCase()}`,
      plan: "AVANZADO",
      subscriptionStatus: "active",
    },
  });
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-${tag}-owner`,
      email: `${RUN}-${tag}@test.local`,
      firstName: "Dueño",
      lastName: tag,
      role: "OWNER",
    },
  });
  const client = await prisma.barberClient.create({
    data: { barbershopId: shop.id, name: `Cliente ${tag}`, phone: `55${RUN.slice(-8)}${tag === "A" ? 1 : 2}` },
  });
  const service = await prisma.barberService.create({
    data: {
      barbershopId: shop.id,
      name: "Corte de cabello",
      durationMin: 30,
      price: new Prisma.Decimal("180.00"),
    },
  });
  return { id: shop.id, userId: user.id, clientId: client.id, serviceId: service.id };
}

async function makePlan(shopId: string, includedCuts: number | null, periodDays = 30) {
  const p = await prisma.barberMembership.create({
    data: {
      barbershopId: shopId,
      name: includedCuts === null ? "Ilimitado" : `${includedCuts} cortes`,
      price: new Prisma.Decimal("349.00"),
      includedCuts,
      periodDays,
    },
  });
  return p.id;
}

function lines(shop: Shop) {
  return [{ serviceId: shop.serviceId, description: "Corte de cabello", unitPriceCents: 18000, qty: 1 }];
}

before(async () => {
  if (!HAS_DB) return;
  // barber_payment_settings NO vive en prisma/schema.prisma (a propósito), así
  // que `prisma db push` la borra. Se recrea aquí para que las pruebas no
  // dependan del orden en que se corrieron los comandos.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "barber_payment_settings" (
      "barbershopId" TEXT NOT NULL,
      "settings"     JSONB NOT NULL DEFAULT '{}'::jsonb,
      "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "barber_payment_settings_pkey" PRIMARY KEY ("barbershopId")
    )`);
  shops.A = await makeShop("A");
  shops.B = await makeShop("B");
});

after(async () => {
  if (!HAS_DB) return;
  // Cascade se lleva todo lo que cuelga de la barbería.
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: `${RUN}-` } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Una membresía de 2 cortes: el tercero se cobra. Ni con 5 peticiones
//    simultáneas el cupo se pasa.
// ═══════════════════════════════════════════════════════════════════════

test("membresía de 2 cortes: cubre 2 y el TERCERO se cobra", { skip }, async () => {
  const A = shops.A;
  const planId = await makePlan(A.id, 2);
  const sold = await sellMembership({
    barbershopId: A.id,
    clientId: A.clientId,
    membershipId: planId,
    paymentMethod: "CASH",
  });
  assert.equal(sold.remaining, 2);

  for (const esperado of [1, 2]) {
    const r = await applyMembershipToVisit({
      barbershopId: A.id,
      clientId: A.clientId,
      lines: lines(A),
    });
    assert.equal(r.covered, true);
    assert.equal(r.cutsUsed, esperado);
    assert.equal(r.discountCents, 18000);
  }

  const tercero = await applyMembershipToVisit({
    barbershopId: A.id,
    clientId: A.clientId,
    lines: lines(A),
  });
  assert.equal(tercero.covered, false);
  assert.equal(tercero.reason, "QUOTA_EXHAUSTED");
  assert.equal(tercero.discountCents, 0);

  const row = await prisma.barberClientMembership.findFirstOrThrow({ where: { id: sold.id } });
  assert.equal(row.cutsUsed, 2, "el cupo no se pasa");

  await prisma.barberClientMembership.deleteMany({ where: { id: sold.id } });
});

test("5 cierres SIMULTÁNEOS sobre 2 cortes: exactamente 2 pasan (Postgres real)", { skip }, async () => {
  const A = shops.A;
  const planId = await makePlan(A.id, 2);
  const sold = await sellMembership({
    barbershopId: A.id,
    clientId: A.clientId,
    membershipId: planId,
    paymentMethod: "SPEI",
  });

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      applyMembershipToVisit({ barbershopId: A.id, clientId: A.clientId, lines: lines(A) }),
    ),
  );

  assert.equal(results.filter((r) => r.covered).length, 2, "solo 2 cierres quedan cubiertos");
  const row = await prisma.barberClientMembership.findFirstOrThrow({ where: { id: sold.id } });
  assert.equal(row.cutsUsed, 2);
  assert.ok(row.cutsUsed <= 2, "el cupo JAMÁS se pasa");

  await prisma.barberClientMembership.deleteMany({ where: { id: sold.id } });
});

test("CONTROL: leer el cupo y luego incrementar SIN condición SÍ se pasa", { skip }, async () => {
  // Reproduce, contra la MISMA base, el patrón inseguro: revisar el cupo en
  // JavaScript y después hacer un increment sin la condición en el WHERE.
  // Si esto NO se rompiera, la prueba de arriba no probaría nada.
  const A = shops.A;
  const planId = await makePlan(A.id, 2);
  const sold = await sellMembership({
    barbershopId: A.id,
    clientId: A.clientId,
    membershipId: planId,
    paymentMethod: "CASH",
  });

  async function inseguro() {
    return prisma.$transaction(async (tx) => {
      const m = await tx.barberClientMembership.findFirstOrThrow({ where: { id: sold.id } });
      if (m.cutsUsed >= 2) return false;
      await new Promise((r) => setTimeout(r, 25)); // la ventana de la carrera
      await tx.barberClientMembership.updateMany({
        where: { id: sold.id, barbershopId: A.id },
        data: { cutsUsed: { increment: 1 } },
      });
      return true;
    });
  }

  await Promise.all([inseguro(), inseguro(), inseguro()]);
  const row = await prisma.barberClientMembership.findFirstOrThrow({ where: { id: sold.id } });
  assert.ok(row.cutsUsed > 2, `el control debe romperse; cutsUsed=${row.cutsUsed}`);

  await prisma.barberClientMembership.deleteMany({ where: { id: sold.id } });
});

test("el candado sirve DENTRO de una transacción ajena (el que usa la caja)", { skip }, async () => {
  const A = shops.A;
  const planId = await makePlan(A.id, 1);
  const sold = await sellMembership({
    barbershopId: A.id,
    clientId: A.clientId,
    membershipId: planId,
    paymentMethod: "CASH",
  });

  const both = await Promise.all([
    prisma.$transaction((tx) =>
      consumeMembershipCutTx(tx as any, {
        barbershopId: A.id,
        clientMembershipId: sold.id,
        includedCuts: 1,
      }),
    ),
    prisma.$transaction((tx) =>
      consumeMembershipCutTx(tx as any, {
        barbershopId: A.id,
        clientMembershipId: sold.id,
        includedCuts: 1,
      }),
    ),
  ]);

  assert.equal(both.filter(Boolean).length, 1, "con 1 corte disponible solo gana uno");
  const row = await prisma.barberClientMembership.findFirstOrThrow({ where: { id: sold.id } });
  assert.equal(row.cutsUsed, 1);

  await prisma.barberClientMembership.deleteMany({ where: { id: sold.id } });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Una membresía de EFECTIVO vence sola y aparece en "por vencer"
// ═══════════════════════════════════════════════════════════════════════

test("la membresía de efectivo vence sola y sale en 'por vencer' (sin tocar Stripe)", { skip }, async () => {
  const A = shops.A;
  const planId = await makePlan(A.id, 2);

  const vencida = await prisma.barberClientMembership.create({
    data: {
      barbershopId: A.id,
      clientId: A.clientId,
      membershipId: planId,
      status: "ACTIVE",
      startAt: new Date(Date.now() - 40 * DAY),
      endAt: new Date(Date.now() - 2 * DAY),
      paymentMethod: "CASH",
    },
  });

  const barridas = await sweepExpiredMemberships(A.id);
  assert.ok(barridas >= 1);
  const post = await prisma.barberClientMembership.findFirstOrThrow({ where: { id: vencida.id } });
  assert.equal(post.status, "EXPIRED");
  assert.equal(post.stripeSubscriptionId, null, "no hizo falta Stripe para vencerla");

  // Y una que vence en 3 días aparece en el filtro "por vencer".
  await prisma.barberClientMembership.update({
    where: { id: vencida.id },
    data: { status: "ACTIVE", endAt: new Date(Date.now() + 3 * DAY) },
  });
  const soon = await listClientMemberships(A.id, { filter: "soon" });
  assert.ok(soon.some((m) => m.id === vencida.id), "sale en 'por vencer'");
  assert.equal(soon.find((m) => m.id === vencida.id)?.urgency, "SOON");

  const stats = await getMembershipStats(A.id);
  assert.ok(stats.soonCount >= 1);

  // Renovar encadena el periodo: no pierde los 3 días que le quedaban.
  const antes = post.endAt;
  const renovada = await renewClientMembership({
    barbershopId: A.id,
    clientMembershipId: vencida.id,
    paymentMethod: "CASH",
  });
  assert.equal(renovada.cutsUsed, 0, "renovar reinicia el contador de cortes");
  assert.ok(new Date(renovada.endAt).getTime() > antes.getTime());

  await prisma.barberClientMembership.deleteMany({ where: { id: vencida.id } });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. El anticipo aplicado a un ticket no se aplica dos veces
// ═══════════════════════════════════════════════════════════════════════

async function makeAppointmentWithDeposit(shop: Shop, amount: string) {
  const appt = await prisma.barberAppointment.create({
    data: {
      barbershopId: shop.id,
      clientId: shop.clientId,
      startAt: new Date(Date.now() + DAY),
      endAt: new Date(Date.now() + DAY + 1800_000),
      status: "CONFIRMED",
      depositAmount: new Prisma.Decimal(amount),
      depositStatus: "PAID",
    },
  });
  const sale = await prisma.barberSale.create({
    data: {
      barbershopId: shop.id,
      appointmentId: appt.id,
      clientId: shop.clientId,
      soldByUserId: shop.userId,
      subtotal: new Prisma.Decimal("180.00"),
      total: new Prisma.Decimal("180.00"),
    },
  });
  return { apptId: appt.id, saleId: sale.id };
}

test("el anticipo se aplica UNA vez: la segunda devuelve ALREADY_APPLIED", { skip }, async () => {
  const A = shops.A;
  const { apptId, saleId } = await makeAppointmentWithDeposit(A, "150.00");

  const preview = await previewDepositForSale({ barbershopId: A.id, appointmentId: apptId });
  assert.equal(preview.amountCents, 15000);

  const first = await applyDepositToSale({ barbershopId: A.id, appointmentId: apptId, saleId });
  assert.equal(first.applied, true);
  assert.equal(first.amountCents, 15000);

  const second = await applyDepositToSale({ barbershopId: A.id, appointmentId: apptId, saleId });
  assert.equal(second.applied, false);
  assert.equal(second.reason, "ALREADY_APPLIED");

  const items = await prisma.barberSaleItem.findMany({ where: { saleId } });
  const credits = items.filter((i) => Number(i.unitPrice) < 0);
  assert.equal(credits.length, 1, "una sola línea de crédito");
  assert.equal(Number(credits[0].unitPrice), -150);

  await prisma.barberAppointment.deleteMany({ where: { id: apptId } });
});

test("dos aplicaciones SIMULTÁNEAS del mismo anticipo: solo una entra", { skip }, async () => {
  const A = shops.A;
  const { apptId, saleId } = await makeAppointmentWithDeposit(A, "200.00");

  const results = await Promise.all([
    applyDepositToSale({ barbershopId: A.id, appointmentId: apptId, saleId }),
    applyDepositToSale({ barbershopId: A.id, appointmentId: apptId, saleId }),
    applyDepositToSale({ barbershopId: A.id, appointmentId: apptId, saleId }),
  ]);

  assert.equal(results.filter((r) => r.applied).length, 1);
  const items = await prisma.barberSaleItem.findMany({ where: { saleId } });
  assert.equal(items.filter((i) => Number(i.unitPrice) < 0).length, 1);

  await prisma.barberAppointment.deleteMany({ where: { id: apptId } });
});

test("un anticipo que NO está pagado no se aplica", { skip }, async () => {
  const A = shops.A;
  const { apptId, saleId } = await makeAppointmentWithDeposit(A, "100.00");
  await prisma.barberAppointment.update({
    where: { id: apptId },
    data: { depositStatus: "PENDING" },
  });

  const r = await applyDepositToSale({ barbershopId: A.id, appointmentId: apptId, saleId });
  assert.equal(r.applied, false);
  assert.equal(r.reason, "NOT_PAID");

  await prisma.barberAppointment.deleteMany({ where: { id: apptId } });
});

// ═══════════════════════════════════════════════════════════════════════
// La política de anticipos vive en su tabla y se lee de vuelta
// ═══════════════════════════════════════════════════════════════════════

test("la política de anticipos se guarda, se relee y decide a quién cobrarle", { skip }, async () => {
  const A = shops.A;
  const guardada = await saveBarberDepositPolicy(A.id, {
    enabled: true,
    mode: "PERCENT",
    percent: 30,
    audience: "NO_SHOW",
    refundWindowHours: 24,
    onlineEnabled: false,
  });
  assert.equal(guardada.enabled, true);
  assert.equal(guardada.percent, 30);

  const { policy, storageReady } = await getBarberPaymentSettings(A.id);
  assert.equal(storageReady, true, "la tabla barber_payment_settings existe");
  assert.equal(policy.audience, "NO_SHOW");

  // El cliente A no ha faltado nunca: no le toca anticipo.
  const sinFaltas = await quoteDepositForBooking({
    barbershopId: A.id,
    clientId: A.clientId,
    serviceIds: [A.serviceId],
  });
  assert.equal(sinFaltas.required, false);
  assert.equal(sinFaltas.reason, "NOT_IN_AUDIENCE");

  // Le registramos una ausencia: ahora sí, 30% de $180 = $54.
  const falta = await prisma.barberAppointment.create({
    data: {
      barbershopId: A.id,
      clientId: A.clientId,
      startAt: new Date(Date.now() - 5 * DAY),
      endAt: new Date(Date.now() - 5 * DAY + 1800_000),
      status: "NO_SHOW",
    },
  });
  const conFalta = await quoteDepositForBooking({
    barbershopId: A.id,
    clientId: A.clientId,
    serviceIds: [A.serviceId],
  });
  assert.equal(conFalta.required, true);
  assert.equal(conFalta.amountCents, 5400);
  assert.ok(conFalta.policyText.includes("54"), "el texto dice el monto antes de pagar");
  assert.ok(conFalta.policyText.includes("24"), "y la ventana de cancelación");

  await prisma.barberAppointment.deleteMany({ where: { id: falta.id } });
  await saveBarberDepositPolicy(A.id, { enabled: false });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Con dos barberías, ninguna ve lo de la otra
// ═══════════════════════════════════════════════════════════════════════

test("la barbería B no ve planes, membresías ni anticipos de A", { skip }, async () => {
  const A = shops.A;
  const B = shops.B;

  const planA = await makePlan(A.id, 2);
  const ventaA = await sellMembership({
    barbershopId: A.id,
    clientId: A.clientId,
    membershipId: planA,
    paymentMethod: "CASH",
  });
  const { apptId } = await makeAppointmentWithDeposit(A, "120.00");

  // Catálogo.
  const planesB = await listMembershipPlans(B.id, { includeInactive: true });
  assert.equal(planesB.some((p) => p.id === planA), false);

  // Membresías vendidas.
  const membresiasB = await listClientMemberships(B.id, { filter: "all" });
  assert.equal(membresiasB.some((m) => m.id === ventaA.id), false);
  const statsB = await getMembershipStats(B.id);
  assert.equal(statsB.activeCount, 0);

  // Anticipos.
  const anticiposB = await listDeposits(B.id, { filter: "all" });
  assert.equal(anticiposB.some((d) => d.appointmentId === apptId), false);

  // Y no puede tocarlos aunque conozca los ids.
  await assert.rejects(
    () => previewDepositForSale({ barbershopId: B.id, appointmentId: apptId }),
    (err: unknown) =>
      err instanceof BarberPaymentsError && err.code === "APPOINTMENT_NOT_FOUND",
  );

  const robo = await previewMembershipCoverage({
    barbershopId: B.id,
    clientId: A.clientId, // cliente de OTRA barbería
    lines: lines(B),
  });
  assert.equal(robo.covered, false);
  assert.equal(robo.reason, "NO_MEMBERSHIP");

  const consumo = await consumeMembershipCutTx(prisma, {
    barbershopId: B.id,
    clientMembershipId: ventaA.id,
    includedCuts: 2,
  });
  assert.equal(consumo, false, "B no puede descontar el cupo de A");
  const intacta = await prisma.barberClientMembership.findFirstOrThrow({ where: { id: ventaA.id } });
  assert.equal(intacta.cutsUsed, 0);

  await prisma.barberAppointment.deleteMany({ where: { id: apptId } });
  await prisma.barberClientMembership.deleteMany({ where: { id: ventaA.id } });
});

test("no se le puede vender una segunda membresía a quien ya tiene una vigente", { skip }, async () => {
  const A = shops.A;
  const planId = await makePlan(A.id, 2);
  const primera = await sellMembership({
    barbershopId: A.id,
    clientId: A.clientId,
    membershipId: planId,
    paymentMethod: "CASH",
  });

  await assert.rejects(
    () =>
      sellMembership({
        barbershopId: A.id,
        clientId: A.clientId,
        membershipId: planId,
        paymentMethod: "CASH",
      }),
    (err: any) => err?.code === "ALREADY_ACTIVE",
  );

  await prisma.barberClientMembership.deleteMany({ where: { id: primera.id } });
});
