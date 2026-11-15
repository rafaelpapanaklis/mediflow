/* ═══════════════════════════════════════════════════════════════════════
   Cómo se escribe un teléfono en las pantallas de barber.

     npx tsx --test src/lib/barber/__tests__/telefono-formato.test.ts

   15-nov-2026: en Conversaciones un cliente de Mérida salía «99 9260 2093».
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MX_TWO_DIGIT_LADAS, formatBarberPhone } from "../phone-format";

test("el caso de Rafael: 9992602093 → 999 260 2093", () => {
  assert.equal(formatBarberPhone("9992602093"), "999 260 2093");
});

test("lada de 3 dígitos → 3-3-4; CDMX, Guadalajara y Monterrey → 2-4-4", () => {
  assert.equal(formatBarberPhone("2221234567"), "222 123 4567"); // Puebla
  assert.equal(formatBarberPhone("6641234567"), "664 123 4567"); // Tijuana
  assert.deepEqual([...MX_TWO_DIGIT_LADAS], ["55", "33", "81"]);
  assert.equal(formatBarberPhone("5512345678"), "55 1234 5678");
  assert.equal(formatBarberPhone("3312345678"), "33 1234 5678");
  assert.equal(formatBarberPhone("8112345678"), "81 1234 5678");
});

test("limpia +52 / +521, espacios y guiones (la regla del dental)", () => {
  assert.equal(formatBarberPhone("+52 1 999 260 2093"), "999 260 2093");
  assert.equal(formatBarberPhone("529992602093"), "999 260 2093");
  assert.equal(formatBarberPhone("999-260-20-93"), "999 260 2093");
});

test("lo que no es un número mexicano de 10 dígitos se deja como viene", () => {
  assert.equal(formatBarberPhone("+1 415 555 0100"), "+1 415 555 0100");
  assert.equal(formatBarberPhone("+34600111222"), "+34600111222");
  assert.equal(formatBarberPhone("12345"), "12345");
  assert.equal(formatBarberPhone(""), "");
  assert.equal(formatBarberPhone(null), "");
  assert.equal(formatBarberPhone(undefined), "");
});

test("ya no queda ninguna copia que parta 2-4-4 a ciegas en el vertical", () => {
  for (const f of [
    "src/components/barber/whatsapp/ui.tsx",
    "src/components/barber/campanas/ui.tsx",
    "src/components/barber/clients/ui.tsx",
    "src/components/barber/bot/bot-screen.tsx",
  ]) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /d\.slice\(0, 2\)\} \$\{d\.slice\(2, 6\)/, f);
    assert.match(s, /formatBarberPhone/, f);
  }
});

test("Solicitudes, la fila del panel y la ficha de la visita escriben el teléfono bonito (QA A, 15-nov)", () => {
  // Antes pintaban «9995550177» tal cual; el href (tel:/wa.me) sigue con los dígitos.
  const casos: Array<[string, RegExp]> = [
    ["src/app/barber/(panel)/solicitudes/solicitudes-client.tsx", /<Phone size=\{14\} \/> \{formatBarberPhone\(r\.clientPhone\)\}/],
    ["src/components/barber/walkin/walkin-panel.tsx", /formatBarberPhone\(row\.phone\)/],
    ["src/components/barber/agenda/appointment-detail.tsx", /\{formatBarberPhone\(appt\.clientPhone\)\}/],
  ];
  for (const [archivo, re] of casos) {
    const s = readFileSync(archivo, "utf8");
    assert.match(s, re, archivo);
    // Ningún teléfono crudo como texto visible.
    assert.doesNotMatch(s, /\/> \{(r\.clientPhone|appt\.clientPhone|aviso\.telefono)\}/, archivo);
  }
});
