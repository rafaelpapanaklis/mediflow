// ═══════════════════════════════════════════════════════════════════════
// Captcha de las puertas públicas con Postgres REAL: con las dos llaves
// puestas, NADA se crea sin un token que Cloudflare dé por bueno.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local
// (127.0.0.1 / localhost). Ver _wa-arnes.ts.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/captcha-integration.test.ts
//
// Cloudflare va simulado (como Meta en el arnés): nada sale a la red.
// ═══════════════════════════════════════════════════════════════════════
import {
  borrarTodo,
  crearCliente,
  crearTienda,
  instalarFetch,
  limpiar,
  prisma,
  restaurarFetch,
  skip,
  telefono,
  BASE_LOCAL,
  TZ,
  type Tienda,
} from "./_wa-arnes";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { addIsoDays, barberTodayISO } from "../booking-core";
import { TURNSTILE_SITEVERIFY_URL } from "../captcha-core";
import { barberWaTemplate } from "../whatsapp-core";
import { POST as bookingPOST } from "@/app/api/barber/public/booking/[slug]/route";
import { POST as walkinPOST } from "@/app/api/barber/walkins/public/route";
import { POST as portalCodePOST } from "@/app/api/barber/portal/[slug]/code/route";

const SITE = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const SECRET = "TURNSTILE_SECRET_KEY";
const DIA = addIsoDays(barberTodayISO(TZ), 3);

/** Lo que contesta Cloudflare, y cuántas veces se le preguntó. */
let cf: { success: boolean; "error-codes"?: string[]; action?: string } | "caido" = { success: true };
let cfCalls = 0;
let ipSeq = 0;

function llaves(on: boolean) {
  if (on) {
    process.env[SITE] = "1x00000000000000000000AA";
    process.env[SECRET] = "1x0000000000000000000000000000000AA";
  } else {
    delete process.env[SITE];
    delete process.env[SECRET];
  }
}

function req(url: string, body: unknown): NextRequest {
  // Una IP distinta por petición: el freno por IP no es lo que se prueba aquí.
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${++ipSeq % 250}.${ipSeq % 200}` },
    body: JSON.stringify(body),
  });
}

async function slugDe(t: Tienda): Promise<string> {
  return (await prisma.barbershop.findUnique({ where: { id: t.id }, select: { slug: true } }))!.slug;
}

let T: Tienda;

before(async () => {
  if (!BASE_LOCAL) return;
  instalarFetch();
  const arnes = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url) === TURNSTILE_SITEVERIFY_URL) {
      cfCalls++;
      if (cf === "caido") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(cf), { status: 200, headers: { "content-type": "application/json" } });
    }
    return arnes(url, init);
  }) as typeof fetch;
  T = await crearTienda();
});

after(async () => {
  llaves(false);
  restaurarFetch();
  if (BASE_LOCAL) await borrarTodo();
});

beforeEach(() => {
  cf = { success: true };
  cfCalls = 0;
  limpiar();
});

test("reserva: con llaves y sin token NO nace la cita; con token bueno sí", { skip }, async () => {
  llaves(true);
  const slug = await slugDe(T);
  const phone = telefono();
  const body = { serviceIds: [T.corteId], barberId: "any", date: DIA, time: "11:00", name: "Ana López", phone };
  const ctx = { params: Promise.resolve({ slug }) };

  const sin = await bookingPOST(req(`http://x/api/barber/public/booking/${slug}`, body), ctx);
  assert.equal(sin.status, 400);
  assert.equal(((await sin.json()) as any).code, "captchaRequired");

  cf = { success: false, "error-codes": ["invalid-input-response"] };
  const malo = await bookingPOST(req(`http://x/api/barber/public/booking/${slug}`, { ...body, captchaToken: "x" }), ctx);
  assert.equal(malo.status, 400);
  assert.equal(((await malo.json()) as any).code, "captchaFailed");

  assert.equal(await prisma.barberAppointment.count({ where: { barbershopId: T.id, clientPhone: phone } }), 0);
  assert.equal(await prisma.barberClient.count({ where: { barbershopId: T.id, phone } }), 0);

  cf = { success: true, action: "barber-booking" };
  const bueno = await bookingPOST(
    req(`http://x/api/barber/public/booking/${slug}`, { ...body, captchaToken: "tok" }),
    { params: Promise.resolve({ slug }) },
  );
  const json = (await bueno.json()) as any;
  assert.equal(bueno.status, 200, JSON.stringify(json));
  assert.equal(json.ok, true);
  assert.equal(await prisma.barberAppointment.count({ where: { barbershopId: T.id, clientPhone: phone } }), 1);
});

test("fila: con llaves y sin token nadie se forma; con token sí", { skip }, async () => {
  llaves(true);
  const slug = await slugDe(T);
  const phone = telefono();
  const sin = await walkinPOST(req("http://x/api/barber/walkins/public", { slug, name: "Ana", phone }));
  assert.equal(sin.status, 400);
  assert.equal(((await sin.json()) as any).code, "captchaRequired");
  assert.equal(await prisma.barberWalkIn.count({ where: { barbershopId: T.id, phone } }), 0);

  cf = { success: true, action: "barber-walkin" };
  const bueno = await walkinPOST(req("http://x/api/barber/walkins/public", { slug, name: "Ana", phone, captchaToken: "t" }));
  assert.equal(bueno.status, 201, JSON.stringify(await bueno.clone().json()));
  assert.equal(await prisma.barberWalkIn.count({ where: { barbershopId: T.id, phone } }), 1);
});

test("mi cuenta: sin token no se genera ni se manda código, y la respuesta no delata si el cliente existe", { skip }, async () => {
  llaves(true);
  const slug = await slugDe(T);
  const cliente = telefono();
  const c = await crearCliente(T, cliente);
  await prisma.barberClient.update({ where: { id: c.id }, data: { portalEnabled: true } });
  const desconocido = telefono();
  const ctx = { params: Promise.resolve({ slug }) };

  const a = await portalCodePOST(req(`http://x/api/barber/portal/${slug}/code`, { phone: cliente }), ctx);
  const b = await portalCodePOST(req(`http://x/api/barber/portal/${slug}/code`, { phone: desconocido }), ctx);
  assert.equal(a.status, 400);
  assert.equal(b.status, 400);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(await prisma.barberClientAuthToken.count({ where: { client: { barbershopId: T.id, phone: cliente } } }), 0);

  cf = { success: true, action: "barber-portal-code" };
  const ok = await portalCodePOST(req(`http://x/api/barber/portal/${slug}/code`, { phone: cliente, captchaToken: "t" }), ctx);
  assert.equal(ok.status, 200);
  assert.equal(await prisma.barberClientAuthToken.count({ where: { client: { barbershopId: T.id, phone: cliente } } }), 1);
});

test("un token de la FILA no sirve para reservar", { skip }, async () => {
  llaves(true);
  const slug = await slugDe(T);
  const phone = telefono();
  cf = { success: true, action: "barber-walkin" };
  const res = await bookingPOST(
    req(`http://x/api/barber/public/booking/${slug}`, {
      serviceIds: [T.corteId], barberId: "any", date: DIA, time: "12:00", name: "Ana López", phone, captchaToken: "t",
    }),
    { params: Promise.resolve({ slug }) },
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).code, "captchaFailed");
  assert.equal(await prisma.barberAppointment.count({ where: { barbershopId: T.id, clientPhone: phone } }), 0);
});

test("SIN llaves todo sigue como hoy: se reserva sin token y no se pregunta a Cloudflare", { skip }, async () => {
  llaves(false);
  const slug = await slugDe(T);
  const phone = telefono();
  const res = await bookingPOST(
    req(`http://x/api/barber/public/booking/${slug}`, {
      serviceIds: [T.corteId], barberId: "any", date: DIA, time: "13:00", name: "Ana López", phone,
    }),
    { params: Promise.resolve({ slug }) },
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(cfCalls, 0);
});

/* ═══════ Punto 2: en automático, el teléfono nuevo con captcha SÍ recibe su confirmación ═══════ */

const CONFIRMACION = barberWaTemplate("bookingConfirmed").name;

async function reservarPorRuta(t: Tienda, phone: string, time: string, captchaToken?: string) {
  const slug = await slugDe(t);
  const res = await bookingPOST(
    req(`http://x/api/barber/public/booking/${slug}`, {
      serviceIds: [t.corteId], barberId: "any", date: DIA, time, name: "Ana López", phone,
      ...(captchaToken ? { captchaToken } : {}),
    }),
    { params: Promise.resolve({ slug }) },
  );
  return { status: res.status, json: (await res.json()) as any };
}

async function confirmaciones(t: Tienda, phone: string) {
  return prisma.barberMessage.count({ where: { barbershopId: t.id, phone, templateName: CONFIRMACION } });
}

test("automática + captcha pasado: el teléfono NUEVO queda CONFIRMADO y se le manda la confirmación", { skip }, async () => {
  const A = await crearTienda();
  await prisma.barbershop.update({ where: { id: A.id }, data: { bookingPolicy: "auto" } });
  llaves(true);
  cf = { success: true, action: "barber-booking" };
  const nuevo = telefono();
  const r = await reservarPorRuta(A, nuevo, "15:00", "tok");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "CONFIRMED");
  assert.equal(await confirmaciones(A, nuevo), 1);
});

test("automática SIN llaves (como hoy): el teléfono nuevo queda CONFIRMADO pero NO se le escribe", { skip }, async () => {
  const B = await crearTienda();
  await prisma.barbershop.update({ where: { id: B.id }, data: { bookingPolicy: "auto" } });
  llaves(false);
  const nuevo = telefono();
  const r = await reservarPorRuta(B, nuevo, "16:00");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "CONFIRMED");
  assert.equal(await confirmaciones(B, nuevo), 0);
});

test("manual + captcha pasado: nace PENDIENTE y la confirmación espera a que la barbería acepte", { skip }, async () => {
  const M = await crearTienda();
  llaves(true);
  cf = { success: true, action: "barber-booking" };
  const nuevo = telefono();
  const r = await reservarPorRuta(M, nuevo, "17:00", "tok");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "PENDING");
  assert.equal(await confirmaciones(M, nuevo), 0);
});

/* ═══════ M1 (ronda 15): Cloudflare caído NO cierra la reserva ═══════ */

test("Cloudflare caído: la reserva ENTRA (sin captcha), y en automático no se le escribe al teléfono nuevo", { skip }, async () => {
  const A = await crearTienda();
  await prisma.barbershop.update({ where: { id: A.id }, data: { bookingPolicy: "auto" } });
  llaves(true);
  cf = "caido";
  const nuevo = telefono();
  const r = await reservarPorRuta(A, nuevo, "18:00", "tok");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "CONFIRMED");
  assert.equal(cfCalls, 1);
  assert.equal(await confirmaciones(A, nuevo), 0, "no quedó verificada: sin confirmación al teléfono nuevo");
});

test("Cloudflare caído: la fila y «mi cuenta» también siguen funcionando", { skip }, async () => {
  llaves(true);
  cf = "caido";
  const slug = await slugDe(T);
  const phone = telefono();
  const fila = await walkinPOST(req("http://x/api/barber/walkins/public", { slug, name: "Ana", phone, captchaToken: "t" }));
  assert.equal(fila.status, 201);
  const cuenta = await portalCodePOST(
    req(`http://x/api/barber/portal/${slug}/code`, { phone: telefono(), captchaToken: "t" }),
    { params: Promise.resolve({ slug }) },
  );
  assert.equal(cuenta.status, 200);
});

/* ═══════ M3 (ronda 15): el tope diario solo cuando NO hubo captcha ═══════ */

async function sembrarNuevasDeHoy(t: Tienda, n: number) {
  for (let i = 0; i < n; i++) {
    const phone = telefono();
    const cl = await prisma.barberClient.create({ data: { barbershopId: t.id, name: "Fantasma", phone, portalEnabled: true } });
    const startAt = new Date(Date.now() + (40 + i) * 86_400_000);
    await prisma.barberAppointment.create({
      data: {
        barbershopId: t.id, clientId: cl.id, clientName: "Fantasma", clientPhone: phone,
        startAt, endAt: new Date(startAt.getTime() + 30 * 60_000), status: "PENDING", source: "PUBLIC",
      },
    });
  }
}

test("con llaves y captcha pasado: 60 solicitudes nuevas de hoy y la siguiente ENTRA (sin tope)", { skip }, async () => {
  const S = await crearTienda();
  await sembrarNuevasDeHoy(S, 60);
  llaves(true);
  cf = { success: true, action: "barber-booking" };
  const r = await reservarPorRuta(S, telefono(), "10:00", "tok");
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test("SIN llaves (despliegue sin variables): con 50 de hoy, la 51.ª se topa con el teléfono de la barbería", { skip }, async () => {
  const S = await crearTienda();
  await sembrarNuevasDeHoy(S, 50);
  llaves(false);
  const r = await reservarPorRuta(S, telefono(), "10:30");
  assert.equal(r.status, 429, JSON.stringify(r.json));
  assert.equal(r.json.code, "dailyCap");
  assert.match(String(r.json.error), /llámanos al 55 1234 5678/);
});

test("con llaves pero Cloudflare CAÍDO (pasa sin captcha, M1): el tope diario vuelve a frenar", { skip }, async () => {
  const S = await crearTienda();
  await sembrarNuevasDeHoy(S, 50);
  llaves(true);
  cf = "caido";
  const r = await reservarPorRuta(S, telefono(), "11:30", "tok");
  assert.equal(r.status, 429, JSON.stringify(r.json));
  assert.equal(r.json.code, "dailyCap");
});
