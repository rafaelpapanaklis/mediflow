// ═══════════════════════════════════════════════════════════════════════
// REPRODUCCIÓN de un hallazgo, no una prueba de esta ola.
//
// La caja (src/lib/barber/cash.ts, terminal de dinero) también descuenta el
// cupo de la membresía al cerrar el ticket, pero revisa el cupo en
// JavaScript (toClientLookup) y luego hace un increment SIN la condición en
// el WHERE:
//
//     await tx.barberClientMembership.updateMany({
//       where: { id: membershipUsed.id, barbershopId },   // <- falta el cupo
//       data:  { cutsUsed: { increment: 1 } },
//     });
//
// Con dos cobros al mismo tiempo, los dos leen el mismo cupo y los dos
// incrementan: la membresía de 2 cortes termina con 3. (Para la LEALTAD sí
// pusieron la condición dentro del WHERE — `loyaltyCount: { gte: TARGET }`
// más `if (r.count === 0) throw` —, así que es un olvido, no un criterio.)
//
// ESTA PRUEBA DOCUMENTA EL FALLO TAL COMO ESTÁ HOY: pasa mientras el fallo
// exista y TRUENA en cuanto se arregle, con un mensaje que dice qué hacer.
// El arreglo es una línea, usando el candado que esta ola ya expone:
//
//     const ok = await consumeMembershipCutTx(tx, {
//       barbershopId,
//       clientMembershipId: membershipUsed.id,
//       includedCuts: membershipUsed.includedCuts,
//     });
//     if (!ok) throw new BarberCajaError(409, "MEMBERSHIP_NOT_ACTIVE",
//       "La membresía se quedó sin cupo");
//
// Correr igual que las demás de integración (necesita DATABASE_URL).
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { createSale, openCashSession } from "@/lib/barber/cash";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";
const RUN = `r${Date.now().toString(36)}`;
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.AVANZADO.features;

after(async () => {
  if (!HAS_DB) return;
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: `${RUN}-` } } });
  await prisma.$disconnect();
});

test("dos cobros simultáneos con la MISMA membresía se pasan del cupo", { skip }, async () => {
  const shop = await prisma.barbershop.create({
    data: {
      name: "Carrera",
      slug: `${RUN}-carrera`,
      plan: "AVANZADO",
      subscriptionStatus: "active",
    },
  });
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-owner`,
      email: `${RUN}@test.local`,
      firstName: "Dueño",
      lastName: "Carrera",
      role: "OWNER",
    },
  });
  const ctx: BarberContext = {
    barberUserId: user.id,
    barbershopId: shop.id,
    barbershop: shop,
    user,
    barber: null,
    role: "OWNER",
  };

  const client = await prisma.barberClient.create({
    data: { barbershopId: shop.id, name: "Cliente", phone: `55${RUN.slice(-8)}0` },
  });
  const service = await prisma.barberService.create({
    data: {
      barbershopId: shop.id,
      name: "Corte",
      durationMin: 30,
      price: new Prisma.Decimal("180.00"),
    },
  });
  const plan = await prisma.barberMembership.create({
    data: {
      barbershopId: shop.id,
      name: "2 cortes",
      price: new Prisma.Decimal("349.00"),
      includedCuts: 2,
      periodDays: 30,
    },
  });
  const sub = await prisma.barberClientMembership.create({
    data: {
      barbershopId: shop.id,
      clientId: client.id,
      membershipId: plan.id,
      status: "ACTIVE",
      endAt: new Date(Date.now() + 30 * 86_400_000),
      cutsUsed: 1, // le queda UNO
      paymentMethod: "CASH",
    },
  });

  await openCashSession(ctx, { openingAmount: "0" });

  const cobrar = () =>
    createSale(
      ctx,
      {
        clientId: client.id,
        items: [{ kind: "service", id: service.id, qty: 1 }] as any,
        paymentMethod: "CASH",
        membershipItemIndex: 0,
      },
      FEATURES,
    ).then(
      () => "ok" as const,
      () => "rechazado" as const,
    );

  const [a, b] = await Promise.all([cobrar(), cobrar()]);
  const row = await prisma.barberClientMembership.findFirstOrThrow({ where: { id: sub.id } });

  if (row.cutsUsed <= 2) {
    // Ya se arregló: esta reproducción sobra y hay que borrarla.
    assert.fail(
      `La caja YA respeta el cupo (cutsUsed=${row.cutsUsed}, cobros: ${a}/${b}). ` +
        "Borra src/lib/barber/__tests__/caja-membresia-carrera.test.ts: el hallazgo que documenta está cerrado.",
    );
  }

  assert.ok(
    row.cutsUsed > 2,
    "reproducción del hallazgo: el cupo de 2 cortes quedó en " + row.cutsUsed,
  );
});
