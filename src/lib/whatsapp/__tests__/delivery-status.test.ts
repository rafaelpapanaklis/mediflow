// Estado de entrega de WhatsApp — reglas puras, sin BD ni red.
//   npm run test:wa-delivery
//
// Lo que se prueba es exactamente lo que la auditoría exige del webhook: que un
// status repetido no cambie nada, que el estado NUNCA retroceda y que un
// `failed` guarde el código real de Meta.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDeliveryStatus,
  parseDeliveryStatus,
  metaTimestampToDate,
} from "../delivery-status";

const AT = new Date("2026-08-11T10:00:00.000Z");
const LATER = new Date("2026-08-11T10:05:00.000Z");

/* ─────────────── parseDeliveryStatus ─────────────── */

test("parseDeliveryStatus normaliza lo que manda Meta en minúsculas", () => {
  assert.equal(parseDeliveryStatus("sent"), "SENT");
  assert.equal(parseDeliveryStatus("delivered"), "DELIVERED");
  assert.equal(parseDeliveryStatus("read"), "READ");
  assert.equal(parseDeliveryStatus("failed"), "FAILED");
  assert.equal(parseDeliveryStatus(" Read "), "READ");
});

test("parseDeliveryStatus devuelve null ante algo desconocido", () => {
  // Meta ha añadido status nuevos antes (p. ej. "deleted"): que caigan a null
  // y no se escriba nada es preferible a inventar un estado.
  assert.equal(parseDeliveryStatus("deleted"), null);
  assert.equal(parseDeliveryStatus(""), null);
  assert.equal(parseDeliveryStatus(null), null);
  assert.equal(parseDeliveryStatus(undefined), null);
});

/* ─────────────── avance normal ─────────────── */

test("un mensaje sin estado acepta el primer status", () => {
  const patch = applyDeliveryStatus(null, { raw: "sent", at: AT });
  assert.equal(patch?.deliveryStatus, "SENT");
  // `sent` no sella ninguna fecha: la de envío ya es `sentAt`.
  assert.equal(patch?.deliveredAt, undefined);
  assert.equal(patch?.readAt, undefined);
});

test("sent → delivered sella deliveredAt", () => {
  const patch = applyDeliveryStatus("SENT", { raw: "delivered", at: AT });
  assert.equal(patch?.deliveryStatus, "DELIVERED");
  assert.deepEqual(patch?.deliveredAt, AT);
});

test("delivered → read sella readAt y respeta el deliveredAt que ya había", () => {
  const patch = applyDeliveryStatus("DELIVERED", { raw: "read", at: LATER });
  assert.equal(patch?.deliveryStatus, "READ");
  assert.deepEqual(patch?.readAt, LATER);
  // No se toca deliveredAt: ya estaba sellado con su hora real.
  assert.equal(patch?.deliveredAt, undefined);
});

test("un read que llega sin su delivered sella también deliveredAt", () => {
  // Webhooks fuera de orden: leído implica entregado, y dejar la entrega en
  // blanco pintaría "leído" sin fecha de entrega en la UI.
  const patch = applyDeliveryStatus("SENT", { raw: "read", at: LATER });
  assert.equal(patch?.deliveryStatus, "READ");
  assert.deepEqual(patch?.readAt, LATER);
  assert.deepEqual(patch?.deliveredAt, LATER);
});

/* ─────────────── idempotencia ─────────────── */

test("el mismo status dos veces no escribe la segunda", () => {
  assert.equal(applyDeliveryStatus("DELIVERED", { raw: "delivered", at: LATER }), null);
  assert.equal(applyDeliveryStatus("READ", { raw: "read", at: LATER }), null);
  assert.equal(applyDeliveryStatus("SENT", { raw: "sent", at: LATER }), null);
  assert.equal(applyDeliveryStatus("FAILED", { raw: "failed", at: LATER }), null);
});

/* ─────────────── sin retroceso ─────────────── */

test("READ no vuelve a DELIVERED", () => {
  assert.equal(applyDeliveryStatus("READ", { raw: "delivered", at: LATER }), null);
});

test("DELIVERED no vuelve a SENT", () => {
  assert.equal(applyDeliveryStatus("DELIVERED", { raw: "sent", at: LATER }), null);
});

test("un sent que aterriza tarde no borra un READ", () => {
  assert.equal(applyDeliveryStatus("READ", { raw: "sent", at: LATER }), null);
});

/* ─────────────── fallos ─────────────── */

test("failed guarda el código y el título reales de Meta", () => {
  const patch = applyDeliveryStatus("SENT", {
    raw: "failed",
    at: AT,
    errorCode: 131047,
    errorTitle: "Re-engagement message",
  });
  assert.equal(patch?.deliveryStatus, "FAILED");
  assert.equal(patch?.errorCode, 131047);
  assert.equal(patch?.errorTitle, "Re-engagement message");
});

test("failed sin errors[] deja código y título en null, no undefined", () => {
  // Importa: `undefined` haría que Prisma NO escribiera la columna y quedaría
  // el código de un fallo anterior pegado a este.
  const patch = applyDeliveryStatus("SENT", { raw: "failed", at: AT });
  assert.equal(patch?.errorCode, null);
  assert.equal(patch?.errorTitle, null);
});

test("un failed tardío NO tumba un mensaje ya entregado ni leído", () => {
  // Decisión deliberada: Meta no manda `failed` después de `delivered`, así que
  // esto solo pasa con eventos duplicados fuera de orden.
  assert.equal(applyDeliveryStatus("DELIVERED", { raw: "failed", at: LATER }), null);
  assert.equal(applyDeliveryStatus("READ", { raw: "failed", at: LATER }), null);
});

test("un failed sí corrige un mensaje que solo constaba como enviado", () => {
  // Este es el caso REAL del P0: Meta acepta el mensaje (SENT) y lo rechaza
  // segundos después con 131047 por estar fuera de la ventana de 24 h.
  const patch = applyDeliveryStatus("SENT", { raw: "failed", at: LATER, errorCode: 131047 });
  assert.equal(patch?.deliveryStatus, "FAILED");
});

test("un status desconocido no escribe nada", () => {
  assert.equal(applyDeliveryStatus("SENT", { raw: "deleted", at: AT }), null);
  assert.equal(applyDeliveryStatus(null, { raw: "", at: AT }), null);
});

test("un deliveryStatus corrupto en la fila se trata como si no hubiera nada", () => {
  const patch = applyDeliveryStatus("BASURA", { raw: "delivered", at: AT });
  assert.equal(patch?.deliveryStatus, "DELIVERED");
});

/* ─────────────── timestamp de Meta ─────────────── */

test("metaTimestampToDate convierte segundos UNIX en string", () => {
  assert.deepEqual(metaTimestampToDate("1770804000", AT), new Date(1770804000 * 1000));
  assert.deepEqual(metaTimestampToDate(1770804000, AT), new Date(1770804000 * 1000));
});

test("metaTimestampToDate cae al fallback ante basura", () => {
  // Vale más el momento en que llegó el webhook que un Invalid Date o 1970.
  assert.deepEqual(metaTimestampToDate(undefined, AT), AT);
  assert.deepEqual(metaTimestampToDate("", AT), AT);
  assert.deepEqual(metaTimestampToDate("no-soy-un-numero", AT), AT);
  assert.deepEqual(metaTimestampToDate(0, AT), AT);
  assert.deepEqual(metaTimestampToDate(-5, AT), AT);
});
