// ws6-t8 contra Postgres REAL: el chat de un cliente que todavía no tiene conversación.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/wa-chat-integration.test.ts
import { borrarTodo, crearCliente, crearTienda, prisma, skip, telefono, BASE_LOCAL, type Tienda } from "./_wa-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { listBarberThreadMessages } from "../whatsapp";

let A: Tienda;
let B: Tienda;

before(async () => {
  if (!BASE_LOCAL) return;
  A = await crearTienda({ name: "Barbería Ñ" });
  B = await crearTienda({ name: "Otra Barbería" });
});

after(async () => {
  if (!BASE_LOCAL) return;
  await borrarTodo();
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
