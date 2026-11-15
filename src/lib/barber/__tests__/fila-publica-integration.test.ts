// FILA PÚBLICA (el QR del mostrador) con la ruta REAL y Postgres local:
// G5 y M9 de la auditoría ws6-t8.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local. Ver _wa-arnes.ts.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/fila-publica-integration.test.ts
import "./_sin-server-only";
import fs from "node:fs";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { borrarTodo, crearTienda, prisma, skip, telefono, BASE_LOCAL, type Tienda } from "./_wa-arnes";
import { GET, POST } from "@/app/api/barber/walkins/public/route";
import { PUBLIC_WALKIN_WAITING_CAP } from "@/app/api/barber/walkins/_server";

after(async () => {
  if (BASE_LOCAL) await borrarTodo();
});

let ipSeq = 0;
/** Cada petición desde una IP distinta, salvo que se pida una. */
function ip(fija?: string): string {
  return fija ?? `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
}

async function anotar(slug: string, body: Record<string, unknown>, desde?: string) {
  const res = await POST(
    new Request("http://localhost/api/barber/walkins/public", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip(desde) },
      body: JSON.stringify({ slug, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function slugDe(t: Tienda): Promise<string> {
  return (await prisma.barbershop.findUnique({ where: { id: t.id }, select: { slug: true } }))!.slug;
}

test("un teléfono ya formado: «ya estás en la fila» sin ticket ni nombre", { skip }, async () => {
  const t = await crearTienda({ conectada: false });
  const slug = await slugDe(t);
  const phone = telefono();

  const primero = await anotar(slug, { name: "Luis Pérez", phone });
  assert.equal(primero.status, 201);
  assert.ok(typeof primero.json.ticketId === "string", "quien se anota sí recibe SU ticket");

  // Un desconocido manda el mismo teléfono con otro nombre.
  const otro = await anotar(slug, { name: "Desconocido", phone });
  assert.equal(otro.status, 409);
  assert.equal(otro.json.alreadyInQueue, true);
  for (const k of ["ticketId", "clientName", "rank", "ahead", "etaMinutes", "status", "barberId"]) {
    assert.ok(!(k in otro.json), `no puede salir «${k}» de la entrada ajena`);
  }
  assert.ok(!JSON.stringify(otro.json).includes("Luis"));
  assert.match(String(otro.json.error), /Ya estás en la fila/);

  // Y no se duplicó.
  const filas = await prisma.barberWalkIn.count({ where: { barbershopId: t.id, phone } });
  assert.equal(filas, 1);
});

test(`tope de gente en espera para anotarse desde la calle (${PUBLIC_WALKIN_WAITING_CAP})`, { skip }, async () => {
  const t = await crearTienda({ conectada: false });
  const slug = await slugDe(t);
  await prisma.barberWalkIn.createMany({
    data: Array.from({ length: PUBLIC_WALKIN_WAITING_CAP - 1 }, (_, i) => ({
      barbershopId: t.id,
      clientName: `Fantasma ${i}`,
      phone: telefono(),
      position: i + 1,
    })),
  });
  const ultimo = await anotar(slug, { name: "Ana López", phone: telefono() });
  assert.equal(ultimo.status, 201, "el lugar 30 todavía entra");
  const sobra = await anotar(slug, { name: "Juan Ruiz", phone: telefono() });
  assert.equal(sobra.status, 409);
  assert.match(String(sobra.json.error), /llena/);
  const enEspera = await prisma.barberWalkIn.count({ where: { barbershopId: t.id, status: "WAITING" } });
  assert.equal(enEspera, PUBLIC_WALKIN_WAITING_CAP);
});

test("freno por IP: el quinto intento desde la misma IP en 10 min se corta", { skip }, async () => {
  const t = await crearTienda({ conectada: false });
  const slug = await slugDe(t);
  const misma = "10.66.66.66";
  for (let i = 0; i < 4; i++) {
    const r = await anotar(slug, { name: "Ana López", phone: telefono() }, misma);
    assert.equal(r.status, 201);
  }
  const quinto = await anotar(slug, { name: "Ana López", phone: telefono() }, misma);
  assert.equal(quinto.status, 429);
});

test("el freno es el persistente del dental, no un Map por instancia", () => {
  const server = fs.readFileSync(
    path.resolve(__dirname, "../../../app/api/barber/walkins/_server.ts"),
    "utf8",
  );
  assert.match(server, /persistentRateLimitKey/);
  assert.ok(!/new Map</.test(server), "nada de contadores en memoria propios");
});

test("cerrada por pago o por plan: misma respuesta, sin decir por qué (M9)", { skip }, async () => {
  const impaga = await crearTienda({ conectada: false });
  await prisma.barbershop.update({ where: { id: impaga.id }, data: { subscriptionStatus: "past_due" } });
  const sinFuncion = await crearTienda({ conectada: false, plan: "BASICO" });

  const respuestas = [];
  for (const t of [impaga, sinFuncion]) {
    const slug = await slugDe(t);
    const get = await GET(
      new Request(`http://localhost/api/barber/walkins/public?slug=${slug}`, {
        headers: { "x-forwarded-for": ip() },
      }),
    );
    const post = await anotar(slug, { name: "Ana López", phone: telefono() });
    respuestas.push({ get: { status: get.status, json: await get.json() }, post });
  }
  for (const r of respuestas) {
    assert.equal(r.get.status, 404);
    assert.equal(r.post.status, 404);
    assert.ok(!("code" in r.get.json), "sin code CLOSED / NO_FEATURE");
    assert.ok(!("code" in r.post.json));
  }
  assert.deepEqual(respuestas[0].get.json, respuestas[1].get.json);
  assert.deepEqual(respuestas[0].post.json, respuestas[1].post.json);
});
