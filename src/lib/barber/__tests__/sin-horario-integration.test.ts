// Integración contra Postgres REAL: una barbería SIN horarios cargados.
//
// El bug de producción: una barbería nueva publica su página, comparte la
// liga y la reserva dice "No hay lugares libres en las próximas semanas" —
// que se lee como "está llena". Aquí se prueba lo que la página y el panel
// necesitan para decir la verdad:
//   · getPublicBarbers() dice quién tiene horario (hasSchedule);
//   · getInicioSummary().setup.bookingBlocked se enciende SOLO cuando la
//     reserva en línea está activa y no hay ni un horario, y se apaga con el
//     primero que se carga;
//   · getPublicContact() da WhatsApp/teléfono para ofrecer una salida.
//
//   docker run -d --name barber-deuda-pg -e POSTGRES_PASSWORD=x -e POSTGRES_DB=x \
//     -p 54331:5432 postgres:16-alpine
//   DATABASE_URL=postgresql://postgres:x@localhost:54331/x \
//   DIRECT_URL=$DATABASE_URL npx prisma db push --skip-generate
//   DATABASE_URL=... DIRECT_URL=... npx tsx --test \
//     src/lib/barber/__tests__/sin-horario-integration.test.ts
//
// Sin DATABASE_URL se SALTAN (no fallan). JAMÁS apuntarlas a producción.
import "./_sin-server-only";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { getPublicBarbers, getPublicContact } from "../booking";
import { getInicioSummary } from "../stats";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : "DATABASE_URL no definido: se salta la integración";

const RUN = `sh${Date.now().toString(36)}`;
const PRO = { publicBooking: true, cash: true, analytics: true };

let shopId = "";
let ctx: BarberContext;
let alan = "";
let beto = "";

before(async () => {
  if (!HAS_DB) return;
  const shop = await prisma.barbershop.create({
    data: {
      name: "Sin Horario",
      slug: `${RUN}-a`,
      plan: "PROFESIONAL",
      subscriptionStatus: "active",
      phone: "55 1234 5678",
    },
  });
  shopId = shop.id;
  const user = await prisma.barberUser.create({
    data: {
      barbershopId: shop.id,
      supabaseId: `${RUN}-owner`,
      email: `${RUN}@test.local`,
      firstName: "Dueño",
      lastName: "Prueba",
      role: "OWNER",
    },
  });
  ctx = { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" };
  const a = await prisma.barber.create({ data: { barbershopId: shop.id, name: "Alan", sortOrder: 1 }, select: { id: true } });
  const b = await prisma.barber.create({ data: { barbershopId: shop.id, name: "Beto", sortOrder: 2 }, select: { id: true } });
  alan = a.id;
  beto = b.id;
});

after(async () => {
  if (!HAS_DB) return;
  await prisma.barbershop.deleteMany({ where: { slug: { startsWith: `${RUN}-` } } });
  await prisma.$disconnect();
});

test("sin un solo horario: ningún barbero público tiene hasSchedule y el Inicio se BLOQUEA", { skip }, async () => {
  const barbers = await getPublicBarbers(shopId);
  assert.deepEqual(
    barbers.map((b) => [b.name, b.hasSchedule]),
    [["Alan", false], ["Beto", false]],
  );

  const s = await getInicioSummary(ctx, { features: PRO });
  assert.equal(s.setup.hasSchedules, false);
  assert.equal(s.setup.publicBookingOn, true);
  assert.equal(s.setup.bookingBlocked, true, "reserva en línea activa + cero horarios = bloqueo");
  assert.equal(s.alerts.barbersNoSchedule?.count, 2, "y el aviso de siempre sigue ahí");

  // Sin reserva en línea en el plan no hay liga que mienta: no se bloquea.
  const basico = await getInicioSummary(ctx, { features: { ...PRO, publicBooking: false } });
  assert.equal(basico.setup.publicBookingOn, false);
  assert.equal(basico.setup.bookingBlocked, false);
});

test("con el primer horario cargado: ese barbero sale con hasSchedule y el bloqueo se apaga", { skip }, async () => {
  await prisma.barberSchedule.create({
    data: { barbershopId: shopId, barberId: alan, dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 },
  });
  // Un horario INACTIVO no cuenta: Beto sigue sin horario.
  await prisma.barberSchedule.create({
    data: { barbershopId: shopId, barberId: beto, dayOfWeek: 2, startMinute: 9 * 60, endMinute: 18 * 60, isActive: false },
  });

  const barbers = await getPublicBarbers(shopId);
  assert.deepEqual(
    barbers.map((b) => [b.name, b.hasSchedule]),
    [["Alan", true], ["Beto", false]],
  );

  const s = await getInicioSummary(ctx, { features: PRO });
  assert.equal(s.setup.hasSchedules, true);
  assert.equal(s.setup.bookingBlocked, false);
  assert.equal(s.alerts.barbersNoSchedule?.count, 1, "Beto sigue en el aviso por barbero");
});

test("el contacto público sale de la mini-web si lo hay y si no del teléfono de la barbería", { skip }, async () => {
  const delTelefono = await getPublicContact({ id: shopId, phone: "55 1234 5678" });
  assert.deepEqual(delTelefono, { whatsapp: "525512345678", phone: "55 1234 5678" });

  await prisma.barberLandingConfig.create({
    data: { barbershopId: shopId, template: "classic", config: { whatsapp: "5587654321" } },
  });
  const deLaWeb = await getPublicContact({ id: shopId, phone: "55 1234 5678" });
  assert.equal(deLaWeb.whatsapp, "525587654321", "el WhatsApp configurado en Mi web manda");
  assert.equal(deLaWeb.phone, "55 1234 5678");

  const sinNada = await getPublicContact({ id: `${RUN}-no-existe`, phone: null });
  assert.deepEqual(sinNada, { whatsapp: null, phone: null });
});
