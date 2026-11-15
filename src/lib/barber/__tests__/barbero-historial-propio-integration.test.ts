// EL BARBERO SOLO VE LO SUYO, TAMBIÉN EN EL HISTORIAL (decisión #9 de Rafael,
// 15-nov-2026: «que vea solo lo de él, no de otros barberos»; A-M2 de
// REPORTE-ws6-t2-ronda10).
//
// Antes: en la ficha de un cliente SUYO, getBarberVisitHistory traía TODAS
// las visitas y ventas del cliente, incluidas las de otros barberos, con
// servicio, importe, notas y fotos.
//
// Ahora, con el rol Barbero (alcance «own»): solo las visitas y los tickets
// que atendió él, sus fotos y los canjes de lealtad apuntados sobre una visita
// suya. Dueño, Encargado, Recepción y un Barbero con clients.edit por permiso
// personal: igual que antes (todo).
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/barbero-historial-propio-integration.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  if (request === "next/headers") {
    return { __esModule: true, cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() };
  }
  return cargaOriginal.call(this, request, parent, isMain);
};

const RUN = `hist${Date.now().toString(36)}`;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let prisma: typeof import("@/lib/prisma")["prisma"];
let loyalty: typeof import("@/lib/barber/loyalty");
let clients: typeof import("@/lib/barber/clients");

let shopId: string;
let uno: string;
let dos: string;
let clienteId: string;
let citaUno: string;
let citaDos: string;
let ventaUno: string;
let ventaDos: string;
let fotoUno: string;
let fotoDos: string;
let fotoSuelta: string;
const ctxs: Record<string, BarberContext> = {};

async function persona(tag: string, role: "OWNER" | "MANAGER" | "RECEPTION" | "BARBER", barberId: string | null = null, permissionsOverride: string[] = []) {
  const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: tag, lastName: "Prueba", role, barberId, permissionsOverride },
  });
  const barber = barberId ? await prisma.barber.findUniqueOrThrow({ where: { id: barberId } }) : null;
  ctxs[tag] = { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber, role };
  return user.id;
}

async function cita(barberId: string, daysAgo: number, notes: string) {
  const start = new Date(Date.now() - daysAgo * DAY);
  const svc = await prisma.barberService.findFirstOrThrow({ where: { barbershopId: shopId } });
  return (await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, barberId, clientId: clienteId, clientName: "Compartido", clientPhone: "5599990000",
      status: "DONE", notes, startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId: svc.id, priceAtBooking: new Prisma.Decimal(daysAgo * 10 + 100) }] },
    },
  })).id;
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  loyalty = await import("@/lib/barber/loyalty");
  clients = await import("@/lib/barber/clients");

  shopId = (await prisma.barbershop.create({
    data: { name: "Barbería Historial", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active" },
  })).id;
  uno = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Uno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  dos = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Dos", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } });
  clienteId = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: "Compartido", phone: "5599990000" } })).id;

  const dueno = await persona("dueno", "OWNER");
  await persona("encargado", "MANAGER");
  await persona("recepcion", "RECEPTION");
  await persona("barbero-uno", "BARBER", uno);
  await persona("barbero-uno-amplio", "BARBER", uno, ["agenda.view", "clients.view", "clients.edit", "walkin.manage"]);

  citaUno = await cita(uno, 10, "Nota de Uno: degradado bajo");
  citaDos = await cita(dos, 5, "Nota de Dos: secreto de Dos");
  ventaUno = (await prisma.barberSale.create({
    data: { barbershopId: shopId, soldByUserId: dueno, barberId: uno, clientId: clienteId, total: new Prisma.Decimal(111), notes: "Ticket de Uno" },
  })).id;
  ventaDos = (await prisma.barberSale.create({
    data: { barbershopId: shopId, soldByUserId: dueno, barberId: dos, clientId: clienteId, total: new Prisma.Decimal(999), notes: "Ticket de Dos" },
  })).id;
  const foto = async (appointmentId: string | null) =>
    (await prisma.barberVisitPhoto.create({
      data: { barbershopId: shopId, clientId: clienteId, appointmentId, url: `${shopId}/${RUN}-${appointmentId ?? "suelta"}.jpg`, kind: "AFTER", uploadedByUserId: dueno },
    })).id;
  fotoUno = await foto(citaUno);
  fotoDos = await foto(citaDos);
  fotoSuelta = await foto(null);

  // Dos canjes de lealtad apuntados: uno sobre la visita de Uno, otro sobre la de Dos.
  await prisma.barberClient.update({
    where: { id: clienteId },
    data: {
      preferences: {
        __loyalty: {
          redeemedVisits: 20,
          redemptions: [
            { at: new Date(Date.now() - 9 * DAY).toISOString(), byUserId: dueno, threshold: 10, reward: "Premio en visita de Uno", appointmentId: citaUno, note: "canje Uno" },
            { at: new Date(Date.now() - 4 * DAY).toISOString(), byUserId: dueno, threshold: 10, reward: "Premio en visita de Dos", appointmentId: citaDos, note: "canje Dos" },
          ],
        },
      },
    },
  });
});

after(async () => {
  M._load = cargaOriginal;
  if (!HAS_DB) return;
  await prisma.barberVisitPhoto.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: shopId } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberClient.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberService.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

test("🔴 el Barbero, en un cliente suyo, ve SOLO sus visitas, sus tickets, sus notas y sus fotos", { skip }, async () => {
  const h = await loyalty.getBarberVisitHistory(ctxs["barbero-uno"], clienteId);
  const ids = h.entries.map((e) => e.id);
  assert.ok(ids.includes(citaUno) && ids.includes(ventaUno), "lo suyo sí");
  assert.ok(!ids.includes(citaDos) && !ids.includes(ventaDos), "lo de Dos no");
  const texto = JSON.stringify(h);
  for (const ajeno of ["secreto de Dos", "Ticket de Dos", "999", fotoDos, "Premio en visita de Dos", "canje Dos"]) {
    assert.ok(!texto.includes(ajeno), `se coló «${ajeno}»`);
  }
  assert.ok(texto.includes("Premio en visita de Uno"), "el canje sobre su visita sí sale");
  for (const e of h.entries) assert.ok(e.barberId === uno || e.kind === "redemption", `entrada ajena: ${e.id}`);
  assert.deepEqual(h.entries.find((e) => e.id === citaUno)?.photos.map((p) => p.id), [fotoUno]);
  assert.deepEqual(h.loosePhotos.map((p) => p.id), [], "la foto suelta la subió otro");
  assert.equal(h.latestPhoto?.id, fotoUno);
});

test("la galería de fotos de la ficha también se recorta para el Barbero", { skip }, async () => {
  const fotos = await clients.listBarberClientPhotos(ctxs["barbero-uno"], clienteId);
  assert.deepEqual(fotos.map((f) => f.id), [fotoUno]);
});

test("Dueño, Encargado y Recepción ven el historial completo, como antes", { skip }, async () => {
  for (const tag of ["dueno", "encargado", "recepcion"]) {
    const h = await loyalty.getBarberVisitHistory(ctxs[tag], clienteId);
    const ids = h.entries.map((e) => e.id);
    for (const id of [citaUno, citaDos, ventaUno, ventaDos]) assert.ok(ids.includes(id), `${tag}: falta ${id}`);
    assert.equal(h.entries.filter((e) => e.kind === "redemption").length, 2, tag);
    assert.deepEqual(h.loosePhotos.map((p) => p.id), [fotoSuelta], tag);
    const fotos = await clients.listBarberClientPhotos(ctxs[tag], clienteId);
    assert.equal(fotos.length, 3, tag);
  }
});

test("un Barbero con clients.edit por permiso personal sigue viendo todo (se respeta)", { skip }, async () => {
  const h = await loyalty.getBarberVisitHistory(ctxs["barbero-uno-amplio"], clienteId);
  const ids = h.entries.map((e) => e.id);
  assert.ok(ids.includes(citaDos) && ids.includes(ventaDos));
});
