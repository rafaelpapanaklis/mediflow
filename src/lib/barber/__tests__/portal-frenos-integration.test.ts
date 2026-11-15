// «Mi cuenta» del cliente con Postgres REAL: M3 (los 5 intentos del código,
// de forma atómica) y M10 (pedir cambio de hora no se come las notas).
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local. Ver _wa-arnes.ts.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/portal-frenos-integration.test.ts
import "./_sin-server-only";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { borrarTodo, crearCita, crearTienda, prisma, skip, telefono, BASE_LOCAL } from "./_wa-arnes";
import { requestPortalReschedule, verifyPortalCode } from "../client-portal";
import { PORTAL_CODE_MAX_ATTEMPTS, PORTAL_RESCHEDULE_NOTES_MAX } from "../portal-core";

after(async () => {
  if (BASE_LOCAL) await borrarTodo();
});

async function clienteConCodigo(codigo: string) {
  const t = await crearTienda({ conectada: false });
  const phone = telefono();
  const client = await prisma.barberClient.create({
    data: { barbershopId: t.id, name: "Luis Pérez", phone, portalEnabled: true },
  });
  const token = await prisma.barberClientAuthToken.create({
    data: {
      barbershopId: t.id,
      clientId: client.id,
      codeHash: await bcrypt.hash(codigo, 10),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  return { t, phone, client, token };
}

test("M3: 20 códigos equivocados A LA VEZ gastan los 5 intentos y queman el código", { skip }, async () => {
  const { t, phone, token } = await clienteConCodigo("123456");

  const malos = Array.from({ length: 20 }, (_, i) => String(200000 + i));
  const res = await Promise.all(
    malos.map((code) => verifyPortalCode({ barbershopId: t.id, phone, code })),
  );
  assert.ok(res.every((r) => !r.ok));

  const fila = await prisma.barberClientAuthToken.findUnique({ where: { id: token.id } });
  assert.ok(fila!.attempts <= PORTAL_CODE_MAX_ATTEMPTS, `attempts=${fila!.attempts}`);
  assert.ok(fila!.usedAt, "el código quedó quemado");

  // Y el bueno ya no entra: los intentos de verdad fueron 5, no 1.
  const bueno = await verifyPortalCode({ barbershopId: t.id, phone, code: "123456" });
  assert.equal(bueno.ok, false);
});

test("M3: el código correcto al primer intento sigue entrando (y se quema)", { skip }, async () => {
  const { t, phone, token } = await clienteConCodigo("654321");
  const r = await verifyPortalCode({ barbershopId: t.id, phone, code: "654321" });
  assert.equal(r.ok, true);
  const fila = await prisma.barberClientAuthToken.findUnique({ where: { id: token.id } });
  assert.ok(fila!.usedAt);
  const otraVez = await verifyPortalCode({ barbershopId: t.id, phone, code: "654321" });
  assert.equal(otraVez.ok, false, "un solo uso");
});

test("M3: 4 fallos y luego el bueno → entra; 5 fallos y luego el bueno → no", { skip }, async () => {
  const a = await clienteConCodigo("111111");
  for (let i = 0; i < PORTAL_CODE_MAX_ATTEMPTS - 1; i++) {
    await verifyPortalCode({ barbershopId: a.t.id, phone: a.phone, code: "999999" });
  }
  assert.equal((await verifyPortalCode({ barbershopId: a.t.id, phone: a.phone, code: "111111" })).ok, true);

  const b = await clienteConCodigo("222222");
  for (let i = 0; i < PORTAL_CODE_MAX_ATTEMPTS; i++) {
    await verifyPortalCode({ barbershopId: b.t.id, phone: b.phone, code: "999999" });
  }
  assert.equal((await verifyPortalCode({ barbershopId: b.t.id, phone: b.phone, code: "222222" })).ok, false);
});

test("M10: 30 peticiones de cambio de hora no tocan la nota del personal", { skip }, async () => {
  const t = await crearTienda({ conectada: false });
  const phone = telefono();
  const client = await prisma.barberClient.create({
    data: { barbershopId: t.id, name: "Luis Pérez", phone, portalEnabled: true },
  });
  const cita = await crearCita(t, { phone, enMinutos: 3 * 24 * 60, clientId: client.id, status: "CONFIRMED" });
  const personal = "Trae su propia navaja. Pidió no usar talco.";
  await prisma.barberAppointment.update({ where: { id: cita.id }, data: { notes: personal } });

  for (let i = 0; i < 30; i++) {
    const r = await requestPortalReschedule({
      barbershopId: t.id,
      clientId: client.id,
      appointmentId: cita.id,
      message: "y".repeat(400),
      now: new Date(Date.now() + i * 60_000),
    });
    assert.equal(r.ok, true);
  }
  const fila = await prisma.barberAppointment.findUnique({ where: { id: cita.id }, select: { notes: true } });
  assert.ok(fila!.notes!.startsWith(personal), "lo del personal sigue ahí");
  const peticiones = fila!.notes!.split("\n").filter((l) => l.includes("El cliente pidió reagendar"));
  assert.equal(peticiones.length, PORTAL_RESCHEDULE_NOTES_MAX);
});
