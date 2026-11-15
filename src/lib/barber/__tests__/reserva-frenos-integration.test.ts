// Frenos de la reserva pública con Postgres REAL (candados, transacciones).
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local
// (127.0.0.1 / localhost). Ver _wa-arnes.ts.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/reserva-frenos-integration.test.ts
//
// Lo que se demuestra:
//   · el tope diario por barbería de teléfonos sin historial SOLO SIN captcha
//     (ronda 15, M3), también A LA VEZ y para días distintos; con captcha
//     verificado no hay tope (Rafael, 15-nov); el tope por teléfono se queda;
//   · la cita repetida se comprueba DENTRO del candado (carrera forzada);
//   · nombre solo letras y teléfono mexicano real (1000000008 no pasa);
//   · la confirmación por WhatsApp: manual → al aceptar; rechazar avisa solo
//     dentro de la ventana de 24 h; automática → al cliente con historial
//     y, si pasó el captcha, también al teléfono nuevo;
//   · la ruta contesta IGUAL a bloqueado, tope por teléfono y conflicto (M4).
import {
  borrarTodo,
  crearTienda,
  prisma,
  skip,
  telefono,
  BASE_LOCAL,
  TZ,
  type Tienda,
} from "./_wa-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  createPublicBooking,
  listBookingRequests,
  resolveBookingGate,
  resolveBookingRequest,
  type BookingResult,
} from "../booking";
import {
  BARBER_PUBLIC_NEW_PHONE_DAILY_CAP,
  addIsoDays,
  barberTodayISO,
} from "../booking-core";
import { barberWaTemplate } from "../whatsapp-core";
import { POST as bookingPOST } from "@/app/api/barber/public/booking/[slug]/route";

const CONFIRMACION = barberWaTemplate("bookingConfirmed").name;
const HOY = barberTodayISO(TZ);
const dia = (n: number) => addIsoDays(HOY, n);

async function shopRow(t: Tienda) {
  const s = await prisma.barbershop.findUnique({ where: { id: t.id }, select: { slug: true } });
  const gate = await resolveBookingGate(s!.slug);
  assert.ok(gate.ok, "la barbería de prueba tiene que poder recibir reservas");
  return (gate as { ok: true; shop: any }).shop;
}

async function reservar(
  t: Tienda,
  args: {
    phone: string;
    dateISO: string;
    time: string;
    name?: string;
    barberId?: string | null;
    /** Pasó el captcha (lo pone la ruta con lo que dijo Cloudflare). */
    humanVerified?: boolean;
  },
): Promise<BookingResult> {
  return createPublicBooking({
    shop: await shopRow(t),
    serviceIds: [t.corteId],
    barberId: args.barberId === undefined ? "any" : args.barberId,
    dateISO: args.dateISO,
    time: args.time,
    clientName: args.name ?? "Luis Pérez",
    phone: args.phone,
    notes: null,
    humanVerified: args.humanVerified,
  });
}

/** Como agenda el bot (bot.ts): origen WHATSAPP y sin aviso al reservar. */
async function reservarBot(
  t: Tienda,
  args: { phone: string; dateISO: string; time: string; name?: string },
): Promise<BookingResult> {
  return createPublicBooking({
    shop: await shopRow(t),
    serviceIds: [t.corteId],
    barberId: "any",
    dateISO: args.dateISO,
    time: args.time,
    clientName: args.name ?? "Luis Pérez",
    phone: args.phone,
    notes: "Agendada por el bot de WhatsApp.",
    source: "WHATSAPP",
    skipNotify: true,
  });
}

/**
 * Siembra `n` solicitudes PÚBLICAS de hoy, de teléfonos sin historial, como
 * las dejaría un desconocido. Sin barbero (la constraint de no-empalme no
 * entra) y en días lejanos para no estorbar a las reservas de la prueba.
 */
async function sembrarSolicitudes(t: Tienda, n: number, status: "PENDING" | "CONFIRMED" = "PENDING") {
  for (let i = 0; i < n; i++) {
    const phone = telefono();
    const c = await prisma.barberClient.create({
      data: { barbershopId: t.id, name: "Fantasma", phone, portalEnabled: true },
    });
    const startAt = new Date(Date.now() + (40 + i) * 86_400_000);
    await prisma.barberAppointment.create({
      data: {
        barbershopId: t.id,
        clientId: c.id,
        clientName: "Fantasma",
        clientPhone: phone,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        status,
        source: "PUBLIC",
      },
    });
  }
}

/** Retiene los INSERT en citas (deja leer) durante `ms`: fuerza la carrera. */
async function retenerInserts(ms: number): Promise<{ soltado: Promise<void>; tomado: Promise<void> }> {
  let avisar!: () => void;
  const tomado = new Promise<void>((r) => (avisar = r));
  const soltado = prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE "barber_appointments" IN SHARE MODE`);
      avisar();
      await new Promise((r) => setTimeout(r, ms));
    },
    { timeout: ms + 10_000 },
  );
  return { soltado, tomado };
}

async function confirmacionesDe(t: Tienda, phone: string) {
  return prisma.barberMessage.count({
    where: { barbershopId: t.id, phone, templateName: CONFIRMACION },
  });
}

let A: Tienda;

before(async () => {
  if (!BASE_LOCAL) return;
  A = await crearTienda();
  // Un segundo barbero con el mismo horario: hace falta para la carrera de
  // la cita repetida con "cualquiera".
  const b2 = await prisma.barber.create({ data: { barbershopId: A.id, name: "Toño", isActive: true } });
  await prisma.barberSchedule.createMany({
    data: Array.from({ length: 7 }, (_, d) => ({
      barbershopId: A.id,
      barberId: b2.id,
      dayOfWeek: d,
      startMinute: 10 * 60,
      endMinute: 20 * 60,
      isActive: true,
    })),
  });
});

after(async () => {
  if (BASE_LOCAL) await borrarTodo();
});

/* ═══════════════ Forma: nombre y teléfono ═══════════════ */

test("1000000008 y un nombre con liga no reservan", { skip }, async () => {
  const r1 = await reservar(A, { phone: "1000000008", dateISO: dia(3), time: "10:00" });
  assert.deepEqual(r1, { ok: false, code: "badPhone" });
  const r2 = await reservar(A, {
    phone: telefono(),
    dateISO: dia(3),
    time: "10:00",
    name: "premio-en-bit.ly/x",
  });
  assert.deepEqual(r2, { ok: false, code: "badName" });
  const citas = await prisma.barberAppointment.count({ where: { barbershopId: A.id } });
  assert.equal(citas, 0);
});

/* ═══════════════ Confirmación diferida ═══════════════ */

test("manual: reservar NO encola confirmación; aceptar la encola", { skip }, async () => {
  const phone = telefono();
  const r = await reservar(A, { phone, dateISO: dia(4), time: "11:00" });
  assert.ok(r.ok && r.status === "PENDING");
  assert.equal(await confirmacionesDe(A, phone), 0, "al reservar no sale nada");

  const cita = await prisma.barberAppointment.findFirst({ where: { barbershopId: A.id, clientPhone: phone } });
  const ok = await resolveBookingRequest({ barbershopIds: [A.id], appointmentId: cita!.id, action: "aceptar" });
  assert.ok(ok.ok);
  assert.equal(await confirmacionesDe(A, phone), 1, "al aceptar sale la confirmación");
});

test("manual con cliente de siempre: tampoco sale al reservar", { skip }, async () => {
  const phone = telefono();
  await prisma.barberClient.create({
    data: { barbershopId: A.id, name: "Don Chema", phone, totalVisits: 7, lastVisitAt: new Date() },
  });
  const r = await reservar(A, { phone, dateISO: dia(4), time: "12:00", name: "Don Chema" });
  assert.ok(r.ok);
  assert.equal(await confirmacionesDe(A, phone), 0);
});

test("rechazar avisa por texto SOLO si el cliente escribió en las últimas 24 h", { skip }, async () => {
  // Sin conversación: nada.
  const p1 = telefono();
  await reservar(A, { phone: p1, dateISO: dia(5), time: "11:00" });
  const c1 = await prisma.barberAppointment.findFirst({ where: { barbershopId: A.id, clientPhone: p1 } });
  const r1 = await resolveBookingRequest({ barbershopIds: [A.id], appointmentId: c1!.id, action: "rechazar" });
  assert.equal(await prisma.barberMessage.count({ where: { barbershopId: A.id, phone: p1 } }), 0);
  assert.deepEqual(r1, { ok: true, status: "CANCELLED", notified: false }, "sin conversación no llegó nada: el dueño avisa");

  // Escribió hace 2 h: sale un texto (sin plantilla) que dice que no se pudo.
  const p2 = telefono();
  await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "INBOUND",
      phone: p2,
      body: "hola",
      status: "DELIVERED",
      createdAt: new Date(Date.now() - 2 * 3600_000),
    },
  });
  await reservar(A, { phone: p2, dateISO: dia(5), time: "12:00" });
  const c2 = await prisma.barberAppointment.findFirst({ where: { barbershopId: A.id, clientPhone: p2 } });
  const r2 = await resolveBookingRequest({ barbershopIds: [A.id], appointmentId: c2!.id, action: "rechazar" });
  assert.deepEqual(r2, { ok: true, status: "CANCELLED", notified: true });
  const salientes = await prisma.barberMessage.findMany({
    where: { barbershopId: A.id, phone: p2, direction: "OUTBOUND" },
  });
  assert.equal(salientes.length, 1);
  assert.equal(salientes[0].templateName, null);
  assert.match(salientes[0].body ?? "", /no pudimos apartar tu cita/);

  // Escribió hace 30 h: ventana cerrada, nada.
  const p3 = telefono();
  await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "INBOUND",
      phone: p3,
      body: "hola",
      status: "DELIVERED",
      createdAt: new Date(Date.now() - 30 * 3600_000),
    },
  });
  await reservar(A, { phone: p3, dateISO: dia(5), time: "13:00" });
  const c3 = await prisma.barberAppointment.findFirst({ where: { barbershopId: A.id, clientPhone: p3 } });
  const r3 = await resolveBookingRequest({ barbershopIds: [A.id], appointmentId: c3!.id, action: "rechazar" });
  assert.equal(
    await prisma.barberMessage.count({ where: { barbershopId: A.id, phone: p3, direction: "OUTBOUND" } }),
    0,
  );
  assert.deepEqual(r3, { ok: true, status: "CANCELLED", notified: false }, "fuera de las 24 h no llegó nada");
});

test("automática SIN captcha: confirma al reservar solo al cliente con historial", { skip }, async () => {
  const B = await crearTienda();
  await prisma.barbershop.update({ where: { id: B.id }, data: { bookingPolicy: "auto" } });

  const nuevo = telefono();
  const r1 = await reservar(B, { phone: nuevo, dateISO: dia(6), time: "10:00" });
  assert.ok(r1.ok && r1.status === "CONFIRMED");
  assert.equal(await confirmacionesDe(B, nuevo), 0, "a un teléfono nuevo no se le escribe");

  const deSiempre = telefono();
  await prisma.barberClient.create({
    data: { barbershopId: B.id, name: "Luis Pérez", phone: deSiempre, totalVisits: 3 },
  });
  const r2 = await reservar(B, { phone: deSiempre, dateISO: dia(6), time: "11:00" });
  assert.ok(r2.ok && r2.status === "CONFIRMED");
  assert.equal(await confirmacionesDe(B, deSiempre), 1);
});

/* ═══════════════ Solicitudes que agenda el bot ═══════════════ */

test("bot en manual: nace PENDIENTE, sale en Solicitudes «por WhatsApp» y aceptarla encola la confirmación", { skip }, async () => {
  const H = await crearTienda();
  const web = telefono();
  await reservar(H, { phone: web, dateISO: dia(3), time: "10:00" });
  const phone = telefono();
  const r = await reservarBot(H, { phone, dateISO: dia(3), time: "11:00" });
  assert.ok(r.ok && r.status === "PENDING", "en manual también espera a la barbería");
  assert.equal(await confirmacionesDe(H, phone), 0, "el bot ya contestó en el chat: nada en la cola");

  const pendientes = await listBookingRequests({ barbershopIds: [H.id], scope: "pendientes" });
  const porOrigen = Object.fromEntries(pendientes.map((p) => [p.clientPhone, p.source]));
  assert.deepEqual(porOrigen, { [web]: "PUBLIC", [phone]: "WHATSAPP" });

  const cita = pendientes.find((p) => p.clientPhone === phone)!;
  const ok = await resolveBookingRequest({ barbershopIds: [H.id], appointmentId: cita.id, action: "aceptar" });
  assert.deepEqual(ok, { ok: true, status: "CONFIRMED", notified: true });
  assert.equal(await confirmacionesDe(H, phone), 1, "al aceptar sale la confirmación, como la de la web");
  const resueltas = await listBookingRequests({ barbershopIds: [H.id], scope: "resueltas" });
  assert.equal(resueltas.find((p) => p.id === cita.id)?.source, "WHATSAPP");

  // Otra barbería no la ve ni la puede resolver.
  const otra = await crearTienda();
  assert.deepEqual(
    await resolveBookingRequest({ barbershopIds: [otra.id], appointmentId: cita.id, action: "rechazar" }),
    { ok: false, code: "notFound" },
  );
});

test("bot en manual: rechazarla avisa por texto (el cliente acaba de escribir)", { skip }, async () => {
  const phone = telefono();
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone, body: "quiero corte mañana", status: "DELIVERED" },
  });
  const r = await reservarBot(A, { phone, dateISO: dia(7), time: "11:00" });
  assert.ok(r.ok && r.status === "PENDING");
  const cita = await prisma.barberAppointment.findFirst({ where: { barbershopId: A.id, clientPhone: phone } });
  const res = await resolveBookingRequest({ barbershopIds: [A.id], appointmentId: cita!.id, action: "rechazar" });
  assert.deepEqual(res, { ok: true, status: "CANCELLED", notified: true });
  const salientes = await prisma.barberMessage.findMany({
    where: { barbershopId: A.id, phone, direction: "OUTBOUND" },
  });
  assert.equal(salientes.length, 1);
  assert.equal(salientes[0].templateName, null, "texto, sin plantilla");
  assert.match(salientes[0].body ?? "", /no pudimos apartar tu cita/);
});

test("sin WhatsApp conectado: aceptar y rechazar dicen notified=false (el dueño avisa)", { skip }, async () => {
  const S = await crearTienda({ conectada: false });
  const p1 = telefono();
  await reservar(S, { phone: p1, dateISO: dia(8), time: "10:00" });
  const c1 = await prisma.barberAppointment.findFirst({ where: { barbershopId: S.id, clientPhone: p1 } });
  assert.deepEqual(
    await resolveBookingRequest({ barbershopIds: [S.id], appointmentId: c1!.id, action: "aceptar" }),
    { ok: true, status: "CONFIRMED", notified: false },
  );
  assert.equal(await prisma.barberMessage.count({ where: { barbershopId: S.id } }), 0);

  // Aunque el cliente haya escrito hace 1 h: sin WhatsApp conectado no sale nada.
  const p2 = telefono();
  await prisma.barberMessage.create({
    data: {
      barbershopId: S.id,
      direction: "INBOUND",
      phone: p2,
      body: "hola",
      status: "DELIVERED",
      createdAt: new Date(Date.now() - 3600_000),
    },
  });
  await reservar(S, { phone: p2, dateISO: dia(8), time: "11:00" });
  const c2 = await prisma.barberAppointment.findFirst({ where: { barbershopId: S.id, clientPhone: p2 } });
  assert.deepEqual(
    await resolveBookingRequest({ barbershopIds: [S.id], appointmentId: c2!.id, action: "rechazar" }),
    { ok: true, status: "CANCELLED", notified: false },
  );
  assert.equal(
    await prisma.barberMessage.count({ where: { barbershopId: S.id, direction: "OUTBOUND" } }),
    0,
    "sin WhatsApp no se encola ningún mensaje",
  );
});

test("el bot NO entra al tope diario ni a la regla de nombre y teléfono de la web", { skip }, async () => {
  const J = await crearTienda();
  await sembrarSolicitudes(J, BARBER_PUBLIC_NEW_PHONE_DAILY_CAP);
  assert.deepEqual(
    await reservar(J, { phone: telefono(), dateISO: dia(2), time: "10:00" }),
    { ok: false, code: "dailyCap" },
    "la web ya llegó al tope",
  );
  const bot = await reservarBot(J, { phone: telefono(), dateISO: dia(2), time: "11:00", name: "Memo 💈 R." });
  assert.ok(bot.ok && bot.status === "PENDING", "el bot agenda aunque la web esté topada y con un nombre que la web no deja");

  // Y la solicitud del bot no gasta lugar del tope de la web.
  const K = await crearTienda();
  await sembrarSolicitudes(K, BARBER_PUBLIC_NEW_PHONE_DAILY_CAP - 1);
  assert.ok((await reservarBot(K, { phone: telefono(), dateISO: dia(2), time: "10:00" })).ok);
  assert.ok((await reservar(K, { phone: telefono(), dateISO: dia(2), time: "11:00" })).ok, "la 50.ª de la web sigue cabiendo");
});

test("bot en automático: confirma al momento y no es una solicitud", { skip }, async () => {
  const L = await crearTienda();
  await prisma.barbershop.update({ where: { id: L.id }, data: { bookingPolicy: "auto" } });
  const phone = telefono();
  const r = await reservarBot(L, { phone, dateISO: dia(3), time: "10:00" });
  assert.ok(r.ok && r.status === "CONFIRMED");
  assert.equal(await confirmacionesDe(L, phone), 0, "skipNotify: el bot ya lo dijo en el chat");
  assert.deepEqual(await listBookingRequests({ barbershopIds: [L.id], scope: "pendientes" }), []);
});

/* ═══════════════ Tope diario por barbería — SOLO SIN CAPTCHA (ronda 15, M3) ═══════════════ */

test("tope diario: la solicitud 50 entra, la 51 no; el cliente de siempre sí", { skip }, async () => {
  const C = await crearTienda();
  await sembrarSolicitudes(C, BARBER_PUBLIC_NEW_PHONE_DAILY_CAP - 1);

  const r50 = await reservar(C, { phone: telefono(), dateISO: dia(2), time: "10:00" });
  assert.ok(r50.ok, "la 50.ª todavía cabe");
  const r51 = await reservar(C, { phone: telefono(), dateISO: dia(2), time: "11:00" });
  assert.deepEqual(r51, { ok: false, code: "dailyCap" });

  // Un cliente que la barbería ya atendió no cuenta ni choca.
  const deSiempre = telefono();
  await prisma.barberClient.create({
    data: { barbershopId: C.id, name: "Luis Pérez", phone: deSiempre, totalVisits: 1, lastVisitAt: new Date() },
  });
  const rSiempre = await reservar(C, { phone: deSiempre, dateISO: dia(2), time: "12:00" });
  assert.ok(rSiempre.ok, "el cliente con historial reserva aunque el tope esté lleno");

  // Rechazar una solicitud libera un lugar (solo cuentan las vivas).
  const una = await prisma.barberAppointment.findFirst({
    where: { barbershopId: C.id, status: "PENDING", clientName: "Fantasma" },
  });
  await resolveBookingRequest({ barbershopIds: [C.id], appointmentId: una!.id, action: "rechazar" });
  const otra = await reservar(C, { phone: telefono(), dateISO: dia(2), time: "13:00" });
  assert.ok(otra.ok);
});

test("tope diario con política automática: cuentan también las CONFIRMED", { skip }, async () => {
  const D = await crearTienda();
  await prisma.barbershop.update({ where: { id: D.id }, data: { bookingPolicy: "auto" } });
  await sembrarSolicitudes(D, BARBER_PUBLIC_NEW_PHONE_DAILY_CAP, "CONFIRMED");
  const r = await reservar(D, { phone: telefono(), dateISO: dia(2), time: "10:00" });
  assert.deepEqual(r, { ok: false, code: "dailyCap" });
});

test("tope diario A LA VEZ y para días distintos: no se salta", { skip }, async () => {
  const E = await crearTienda();
  await sembrarSolicitudes(E, BARBER_PUBLIC_NEW_PHONE_DAILY_CAP - 2);

  // Mientras la tabla de citas no deja insertar, las 5 leen el conteo a la
  // vez. Sin el candado del tope, las 5 ven "48" y las 5 entran.
  const { soltado, tomado } = await retenerInserts(700);
  await tomado;
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((n) => reservar(E, { phone: telefono(), dateISO: dia(n), time: "15:00" })),
  );
  await soltado;

  const entraron = results.filter((r) => r.ok).length;
  const topadas = results.filter((r) => !r.ok && (r as { code: string }).code === "dailyCap").length;
  assert.equal(entraron, 2, "solo caben 2 hasta llegar a 50");
  assert.equal(topadas, 3);
  const vivas = await prisma.barberAppointment.count({
    where: { barbershopId: E.id, source: "PUBLIC", status: "PENDING" },
  });
  assert.equal(vivas, BARBER_PUBLIC_NEW_PHONE_DAILY_CAP);
});

/* ═══════════════ CON captcha verificado: sin tope (Rafael, 15-nov) ═══════════════ */

test("CON captcha: con 60 solicitudes nuevas de hoy, la siguiente entra (manual)", { skip }, async () => {
  const C = await crearTienda();
  await sembrarSolicitudes(C, 60);
  const nuevo = telefono();
  const r = await reservar(C, { phone: nuevo, dateISO: dia(2), time: "10:00", humanVerified: true });
  assert.ok(r.ok && r.status === "PENDING", JSON.stringify(r));
  assert.equal(await confirmacionesDe(C, nuevo), 0, "manual: la confirmación sale al ACEPTAR, no al reservar");
  // Y la que llega SIN captcha a esa misma barbería sí choca con el tope.
  assert.deepEqual(await reservar(C, { phone: telefono(), dateISO: dia(2), time: "11:00" }), { ok: false, code: "dailyCap" });
});

test("automática CON captcha: el teléfono nuevo queda agendado directo, no pasa por Solicitudes y SÍ recibe confirmación", { skip }, async () => {
  const D = await crearTienda();
  await prisma.barbershop.update({ where: { id: D.id }, data: { bookingPolicy: "auto" } });
  await sembrarSolicitudes(D, 60, "CONFIRMED");
  const nuevo = telefono();
  const r = await reservar(D, { phone: nuevo, dateISO: dia(2), time: "10:00", humanVerified: true });
  assert.ok(r.ok && r.status === "CONFIRMED", JSON.stringify(r));
  assert.equal(await confirmacionesDe(D, nuevo), 1);
  const solicitudes = await listBookingRequests({ barbershopIds: [D.id], scope: "pendientes" });
  assert.equal(solicitudes.length, 0, "en automático no hay nada que aceptar");
});

test("tope por teléfono SÍ se queda: la cuarta cita viva del mismo número no entra", { skip }, async () => {
  const P = await crearTienda();
  const phone = telefono();
  for (const [n, h] of [[2, "10:00"], [3, "10:00"], [4, "10:00"]] as const) {
    assert.ok((await reservar(P, { phone, dateISO: dia(n), time: h })).ok);
  }
  assert.deepEqual(await reservar(P, { phone, dateISO: dia(5), time: "10:00" }), { ok: false, code: "tooManyOpen" });
});

/* ═══════════════ Cita repetida, dentro del candado ═══════════════ */

test("dos envíos a la vez del mismo teléfono y hora, «cualquiera»: UNA cita", { skip }, async () => {
  const phone = telefono();
  const { soltado, tomado } = await retenerInserts(700);
  await tomado;
  const [r1, r2] = await Promise.all([
    reservar(A, { phone, dateISO: dia(8), time: "16:00" }),
    reservar(A, { phone, dateISO: dia(8), time: "16:00" }),
  ]);
  await soltado;

  const citas = await prisma.barberAppointment.count({
    where: { barbershopId: A.id, clientPhone: phone, status: { in: ["PENDING", "CONFIRMED"] } },
  });
  assert.equal(citas, 1, "con dos barberos libres nacían dos citas del mismo cliente");
  assert.ok(r1.ok && r2.ok);
  assert.equal([r1, r2].filter((r) => r.ok && r.duplicate).length, 1);
});

test("doble envío con OTRO nombre: no enseña la cita ajena", { skip }, async () => {
  const phone = telefono();
  const r1 = await reservar(A, { phone, dateISO: dia(9), time: "10:00", name: "Luis Pérez" });
  assert.ok(r1.ok && !r1.duplicate);

  const mismo = await reservar(A, { phone, dateISO: dia(9), time: "10:00", name: "luis perez" });
  assert.ok(mismo.ok && mismo.duplicate, "quien la hizo sí recibe su folio otra vez");

  const otro = await reservar(A, { phone, dateISO: dia(9), time: "10:00", name: "Desconocido" });
  assert.deepEqual(otro, { ok: false, code: "phoneConflict" });
});

/* ═══════════════ La ruta: misma respuesta para tres causas (M4) ═══════════════ */

async function postRuta(slug: string, body: Record<string, unknown>) {
  const req = new NextRequest(`http://localhost/api/barber/public/booking/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });
  const res = await bookingPOST(req, { params: Promise.resolve({ slug }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("ruta: bloqueado, tope por teléfono y otro nombre contestan IGUAL", { skip }, async () => {
  const F = await crearTienda();
  const slug = (await prisma.barbershop.findUnique({ where: { id: F.id }, select: { slug: true } }))!.slug;
  const base = { serviceIds: [F.corteId], barberId: "any" };

  // Bloqueado.
  const bloqueado = telefono();
  await prisma.barberClient.create({
    data: { barbershopId: F.id, name: "Luis Pérez", phone: bloqueado, blockedAt: new Date() },
  });
  const rB = await postRuta(slug, { ...base, date: dia(3), time: "10:00", name: "Luis Pérez", phone: bloqueado });

  // Tope de 3 citas vivas por teléfono.
  const lleno = telefono();
  for (const h of ["10:00", "11:00", "12:00"]) {
    const ok = await postRuta(slug, { ...base, date: dia(4), time: h, name: "Ana López", phone: lleno });
    assert.equal(ok.status, 200);
  }
  const rT = await postRuta(slug, { ...base, date: dia(4), time: "13:00", name: "Ana López", phone: lleno });

  // Misma hora, otro nombre.
  const rC = await postRuta(slug, { ...base, date: dia(4), time: "10:00", name: "Otro Señor", phone: lleno });

  for (const r of [rB, rT, rC]) {
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "phoneUnavailable");
  }
  assert.equal(rB.json.error, rT.json.error);
  assert.equal(rT.json.error, rC.json.error);
  assert.ok(!("reference" in rC.json), "no sale el folio de la cita ajena");
});

test("ruta: el tope del día lleva el teléfono de la barbería", { skip }, async () => {
  const G = await crearTienda();
  await prisma.barbershop.update({ where: { id: G.id }, data: { phone: "55 1111 2222" } });
  await sembrarSolicitudes(G, BARBER_PUBLIC_NEW_PHONE_DAILY_CAP);
  const slug = (await prisma.barbershop.findUnique({ where: { id: G.id }, select: { slug: true } }))!.slug;
  const r = await postRuta(slug, {
    serviceIds: [G.corteId],
    barberId: "any",
    date: dia(3),
    time: "10:00",
    name: "Luis Pérez",
    phone: telefono(),
  });
  assert.equal(r.status, 429);
  assert.equal(r.json.code, "dailyCap");
  assert.match(String(r.json.error), /WhatsApp o llámanos al 55 1111 2222/);
});
