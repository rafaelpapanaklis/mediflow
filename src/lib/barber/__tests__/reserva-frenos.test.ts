/**
 * Frenos de la reserva pública — la parte PURA (sin base).
 *
 * Correr:
 *   npx tsx --test src/lib/barber/__tests__/reserva-frenos.test.ts
 *
 * La parte con Postgres (tope diario, candados, avisos de WhatsApp) está en
 * reserva-frenos-integration.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_PUBLIC_NEW_PHONE_DAILY_CAP,
  bookingRejectedText,
  cleanBarberClientName,
  realMxPhone,
  sameTypedName,
  shouldConfirmOnBooking,
} from "../booking-core";

test("el tope diario es el que decidió Rafael (50) y vive en UNA constante", () => {
  assert.equal(BARBER_PUBLIC_NEW_PHONE_DAILY_CAP, 50);
});

test("nombre: letras con acentos, ñ, diéresis, espacios, apóstrofo y guion", () => {
  for (const ok of [
    "Luis",
    "José Ángel",
    "Begoña Muñoz",
    "Güero",
    "María de la Luz",
    "O'Brien",
    "D’Artagnan",
    "Ana-Sofía Pérez",
    "Zoë",
  ]) {
    assert.ok(cleanBarberClientName(ok), `debería aceptar «${ok}»`);
  }
  assert.equal(cleanBarberClientName("  Luis    Pérez  "), "Luis Pérez");
  // Acento escrito como letra + marca combinante (NFD): se acepta y sale en NFC.
  assert.equal(cleanBarberClientName("José"), "José");
});

test("nombre: nada que sirva para meter una liga o un número en el mensaje", () => {
  for (const malo of [
    "PRUEBA-T8",
    "premio-en-bit.ly/x",
    "bit.ly/x",
    "https://x.co",
    "Luis 5512345678",
    "Juan.",
    "gana: aquí",
    "Luis 🔥",
    "<b>Luis</b>",
    "-Luis",
    "'Ana",
    "A",
    "A-",
    "J'",
    "",
    "   ",
    "x".repeat(81),
  ]) {
    assert.equal(cleanBarberClientName(malo), null, `debería rechazar «${malo}»`);
  }
  assert.equal(cleanBarberClientName(42 as unknown), null);
  assert.equal(cleanBarberClientName(null), null);
});

test("teléfono: 10 dígitos de México que pueden existir (lada del 2 al 9)", () => {
  assert.equal(realMxPhone("5512345678"), "5512345678");
  assert.equal(realMxPhone("55 1234 5678"), "5512345678");
  assert.equal(realMxPhone("(33) 1234-5678"), "3312345678");
  assert.equal(realMxPhone("+52 81 1234 5678"), "8112345678");
  assert.equal(realMxPhone("+521 999 123 4567"), "9991234567");
  assert.equal(realMxPhone("2221234567"), "2221234567");
});

test("teléfono: el de la auditoría (1000000008) y otros imposibles no pasan", () => {
  for (const malo of [
    "1000000008", // el número con el que se reservó en la auditoría
    "0123456789",
    "1234567890",
    "+52 1000000008",
    "551234567", // 9 dígitos
    "55123456789", // 11 dígitos
    "",
    "abcdefghij",
  ]) {
    assert.equal(realMxPhone(malo), null, `debería rechazar «${malo}»`);
  }
  assert.equal(realMxPhone(5512345678 as unknown), null);
});

test("confirmación al reservar: manual nunca; automática solo con historial", () => {
  assert.equal(shouldConfirmOnBooking({ policy: "manual", hasHistory: true }), false);
  assert.equal(shouldConfirmOnBooking({ policy: "manual", hasHistory: false }), false);
  assert.equal(shouldConfirmOnBooking({ policy: "auto", hasHistory: true }), true);
  assert.equal(shouldConfirmOnBooking({ policy: "auto", hasHistory: false }), false);
});

test("misma persona en el doble envío: sin acentos, mayúsculas ni espacios de más", () => {
  assert.ok(sameTypedName("José  Pérez", "jose perez"));
  assert.ok(sameTypedName("ANA", "Ana"));
  assert.ok(!sameTypedName("Ana", "Luis"));
  assert.ok(!sameTypedName("", ""));
  assert.ok(!sameTypedName(null, "Ana"));
});

test("aviso de rechazo: nombra la barbería y la hora en su zona, sin liga", () => {
  const text = bookingRejectedText({
    shopName: "El Corte",
    // 17:00 en CDMX = 23:00 UTC
    startAt: new Date("2026-11-21T23:00:00.000Z"),
    timezone: "America/Mexico_City",
  });
  assert.match(text, /^El Corte: no pudimos apartar tu cita del sábado, 21 de noviembre/);
  assert.match(text, /5:00/);
  assert.ok(!/https?:|www\./.test(text));
});
