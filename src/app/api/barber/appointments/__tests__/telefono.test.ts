/* ═══════════════════════════════════════════════════════════════════════
   UN TELÉFONO MAL ESCRITO NO SE GUARDA EN SILENCIO.

     npx tsx --test "src/app/api/barber/appointments/__tests__/telefono.test.ts"

   Antes: nombre + teléfono de 7 dígitos → la visita se guardaba SIN ligar
   cliente y sin aviso. Ahora el servidor responde 400 con un texto claro.
   Estas rutas salen antes de tocar la base: no hace falta Postgres.
   ═══════════════════════════════════════════════════════════════════════ */
import "../../../../../lib/barber/__tests__/_sin-server-only";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BarberContext } from "@/lib/barber-auth";
import { PHONE_INVALID_MESSAGE, resolveAppointmentClient } from "../_server";

const ctx = { role: "OWNER", user: { permissionsOverride: null } } as unknown as BarberContext;

test("teléfono de 7 dígitos → 400 con mensaje, no se guarda suelto", async () => {
  const r = await resolveAppointmentClient({ clientName: "Beto", clientPhone: "555 1234" }, "shop1", ctx);
  assert.equal(r.client, null);
  assert.equal(r.error?.status, 400);
  const body = await r.error!.json();
  assert.equal(body.error, PHONE_INVALID_MESSAGE);
  assert.equal(body.code, "PHONE_INVALID");
});

test("letras en el teléfono → 400", async () => {
  const r = await resolveAppointmentClient({ clientName: "Beto", clientPhone: "abc" }, "shop1", ctx);
  assert.equal(r.error?.status, 400);
});

test("sin teléfono sigue guardando la visita suelta (no es un error)", async () => {
  const r = await resolveAppointmentClient({ clientName: "Beto", clientPhone: "" }, "shop1", ctx);
  // Sin teléfono no hay a quién ligar: queda como cliente suelto, sin tocar la base.
  assert.equal(r.error, null);
  assert.deepEqual(r.client, { clientId: null, clientName: "Beto", clientPhone: null });
});

test("sin nombre sigue pidiendo el nombre", async () => {
  const r = await resolveAppointmentClient({ clientPhone: "5551234567" }, "shop1", ctx);
  assert.equal(r.error?.status, 400);
  assert.match((await r.error!.json()).error, /nombre/i);
});
