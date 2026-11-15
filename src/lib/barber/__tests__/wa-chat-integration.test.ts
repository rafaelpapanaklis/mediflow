// ws6-t8 contra Postgres REAL: el acceso que resuelve el layout del panel y
// el chat de un cliente que todavía no tiene conversación.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/wa-chat-integration.test.ts
import { borrarTodo, crearCliente, crearTienda, prisma, skip, telefono, BASE_LOCAL, type Tienda } from "./_wa-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { listBarberThreadMessages } from "../whatsapp";
import { getBarberWaChatAcceso } from "../wa-chat";
import { barberWaChatDestino } from "../wa-chat-core";
import type { BarberContext } from "@/lib/barber-auth";

let A: Tienda;
let B: Tienda;
let SinWa: Tienda;

before(async () => {
  if (!BASE_LOCAL) return;
  A = await crearTienda({ name: "Barbería Ñ" });
  B = await crearTienda({ name: "Otra Barbería" });
  SinWa = await crearTienda({ name: "Sin WhatsApp", conectada: false });
});

after(async () => {
  if (!BASE_LOCAL) return;
  await borrarTodo();
});

function ctx(t: Tienda, role: BarberContext["role"], permissionsOverride: string[] | null = null): BarberContext {
  return { barbershopId: t.id, role, user: { permissionsOverride } } as unknown as BarberContext;
}
const PLAN_CON_BANDEJA = { features: { whatsappInbox: true } };
const PLAN_SIN_BANDEJA = { features: { whatsappInbox: false } };

test("acceso del layout: conectado + permiso → Mensajes; si no → wa.me", { skip }, async () => {
  const tel = "9992602093";
  const dueño = await getBarberWaChatAcceso(ctx(A, "OWNER"), PLAN_CON_BANDEJA, true);
  assert.deepEqual(dueño, { inbox: true, send: true });
  assert.equal(barberWaChatDestino({ acceso: dueño, phone: tel }).href, "/barber/mensajes?tel=9992602093");

  const casos: Array<[string, Awaited<ReturnType<typeof getBarberWaChatAcceso>>]> = [
    ["barbería sin WhatsApp", await getBarberWaChatAcceso(ctx(SinWa, "OWNER"), PLAN_CON_BANDEJA, true)],
    ["barbero (sin whatsapp.view)", await getBarberWaChatAcceso(ctx(A, "BARBER"), PLAN_CON_BANDEJA, true)],
    ["plan sin bandeja", await getBarberWaChatAcceso(ctx(A, "OWNER"), PLAN_SIN_BANDEJA, true)],
    ["sin pagar", await getBarberWaChatAcceso(ctx(A, "OWNER"), PLAN_CON_BANDEJA, false)],
  ];
  for (const [nombre, acceso] of casos) {
    assert.deepEqual(acceso, { inbox: false, send: false }, nombre);
    assert.equal(barberWaChatDestino({ acceso, phone: tel }).href, "https://wa.me/529992602093", nombre);
  }

  // Un barbero al que le dieron «Ver WhatsApp» (override) sí entra a leer.
  const conPermiso = await getBarberWaChatAcceso(ctx(A, "BARBER", ["agenda.view", "whatsapp.view"]), PLAN_CON_BANDEJA, true);
  assert.deepEqual(conPermiso, { inbox: true, send: false });
});

test("cliente SIN conversación: el chat abre con su nombre y la ventana cerrada (plantilla)", { skip }, async () => {
  const tel = telefono();
  const cli = await crearCliente(A, tel, "QA-D Cliente Dos Ñ");
  // El mismo teléfono en OTRA barbería, con otro nombre: no se cuela.
  await crearCliente(B, tel, "Alguien De Otra Barbería");

  const hilo = await listBarberThreadMessages(A.id, `+52 ${tel.slice(0, 3)} ${tel.slice(3, 6)} ${tel.slice(6)}`);
  assert.deepEqual(hilo.messages, []);
  assert.equal(hilo.windowOpen, false, "sin mensajes del cliente no hay ventana de 24 h");
  assert.equal(hilo.clientName, "QA-D Cliente Dos Ñ");
  assert.equal(hilo.clientId, cli.id);

  // Un teléfono que nadie tiene: sin nombre, sin tronar.
  const nadie = await listBarberThreadMessages(A.id, telefono());
  assert.deepEqual(nadie, { messages: [], windowOpen: false, clientId: null, clientName: null });
});

test("con conversación ligada a un cliente, manda el del hilo (como antes)", { skip }, async () => {
  const tel = telefono();
  const ficha = await crearCliente(A, tel, "Nombre Viejo");
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone: tel, body: "hola", status: "READ", clientId: ficha.id },
  });
  const hilo = await listBarberThreadMessages(A.id, tel);
  assert.equal(hilo.clientId, ficha.id);
  assert.equal(hilo.clientName, "Nombre Viejo");
  assert.equal(hilo.windowOpen, true);
});
