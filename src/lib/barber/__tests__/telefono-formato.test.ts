/* ═══════════════════════════════════════════════════════════════════════
   Cómo se escribe un teléfono en las pantallas de barber.

     npx tsx --test src/lib/barber/__tests__/telefono-formato.test.ts

   15-nov-2026: en Conversaciones un cliente de Mérida salía «99 9260 2093»,
   y luego Mensajes y el resto del panel escribían distinto el mismo número
   («555 000 0004» contra «55 5000 0004»). Un solo formateador, y estas
   pruebas vigilan que cada pantalla lo use.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MX_TWO_DIGIT_LADAS, formatBarberPhone } from "../phone-format";

// ── Los tres casos ───────────────────────────────────────────────────────

test("1 · lada de 2 dígitos (CDMX 55, Guadalajara 33, Monterrey 81) → 55 1234 5678", () => {
  assert.deepEqual([...MX_TWO_DIGIT_LADAS], ["55", "33", "81"]);
  assert.equal(formatBarberPhone("5512345678"), "55 1234 5678");
  assert.equal(formatBarberPhone("5550000004"), "55 5000 0004");
  assert.equal(formatBarberPhone("3312345678"), "33 1234 5678");
  assert.equal(formatBarberPhone("8112345678"), "81 1234 5678");
});

test("2 · cualquier otra lada (de 3) → 999 260 2093 (el caso de Rafael, Mérida)", () => {
  assert.equal(formatBarberPhone("9992602093"), "999 260 2093");
  assert.equal(formatBarberPhone("2221234567"), "222 123 4567"); // Puebla
  assert.equal(formatBarberPhone("6641234567"), "664 123 4567"); // Tijuana
});

test("3 · otro país → +lada y el número en grupos", () => {
  assert.equal(formatBarberPhone("+1 415 555 0100"), "+1 415 555 0100");
  assert.equal(formatBarberPhone("+14155550100"), "+1 415 555 0100");
  assert.equal(formatBarberPhone("+34600111222"), "+34 600 111 222");
  assert.equal(formatBarberPhone("+44 7700 900123"), "+44 770 090 0123");
  assert.equal(formatBarberPhone("+5491123456789"), "+54 911 2345 6789");
  // Guardado sin el +: más de 10 dígitos que no son de México.
  assert.equal(formatBarberPhone("14155550100"), "+1 415 555 0100");
});

// ── Lo que limpia y lo que deja ──────────────────────────────────────────

test("limpia +52 / +521, espacios y guiones (la regla del dental)", () => {
  assert.equal(formatBarberPhone("+52 1 999 260 2093"), "999 260 2093");
  assert.equal(formatBarberPhone("+52 55 1234 5678"), "55 1234 5678");
  assert.equal(formatBarberPhone("529992602093"), "999 260 2093");
  assert.equal(formatBarberPhone("999-260-20-93"), "999 260 2093");
});

test("lo incompleto se deja como viene", () => {
  assert.equal(formatBarberPhone("12345"), "12345");
  assert.equal(formatBarberPhone("+123"), "+123");
  assert.equal(formatBarberPhone(""), "");
  assert.equal(formatBarberPhone(null), "");
  assert.equal(formatBarberPhone(undefined), "");
});

// ── Cada pantalla usa el mismo ───────────────────────────────────────────

test("Mensajes, clientes, agenda, caja, fila y demás escriben con formatBarberPhone", () => {
  for (const f of [
    "src/components/barber/mensajes/mensajes-screen.tsx",
    "src/components/barber/whatsapp/ui.tsx",
    "src/components/barber/campanas/ui.tsx",
    "src/components/barber/clients/ui.tsx", // lista y ficha (prettyPhone → formatBarberPhone)
    "src/components/barber/bot/bot-screen.tsx",
    "src/components/barber/agenda/cita-piezas.tsx", // la ventana de la cita (B) pinta el teléfono aquí
    "src/components/barber/agenda/appointment-dialog.tsx",
    "src/components/barber/cash/ticket-modal.tsx",
    "src/components/barber/walkin/walkin-panel.tsx",
    "src/components/barber/memberships/subscriptions-tab.tsx",
    "src/components/barber/memberships/sell-membership-modal.tsx",
    "src/app/barber/(panel)/solicitudes/solicitudes-client.tsx",
  ]) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /formatBarberPhone/, f);
    // Ninguna copia que parta a ciegas 2-4-4 o 3-3-4.
    assert.doesNotMatch(s, /d\.slice\(0, 2\)\} \$\{d\.slice\(2, 6\)/, f);
    assert.doesNotMatch(s, /function (prettyPhone|telefonoLegible)[\s\S]{0,120}slice\(/, f);
  }
});

test("Solicitudes, la fila del panel y la ficha de la visita escriben el teléfono bonito (QA A, 15-nov)", () => {
  // Antes pintaban «9995550177» tal cual; el href (tel:/wa.me) sigue con los dígitos.
  const casos: Array<[string, RegExp]> = [
    ["src/app/barber/(panel)/solicitudes/solicitudes-client.tsx", /<Phone size=\{14\} \/> \{formatBarberPhone\(r\.clientPhone\)\}/],
    ["src/components/barber/walkin/walkin-panel.tsx", /formatBarberPhone\(row\.phone\)/],
    ["src/components/barber/agenda/cita-piezas.tsx", /\{formatBarberPhone\(appt\.clientPhone\)\}/],
  ];
  for (const [archivo, re] of casos) {
    const s = readFileSync(archivo, "utf8");
    assert.match(s, re, archivo);
    // Ningún teléfono crudo como texto visible.
    assert.doesNotMatch(s, /\/> \{(r\.clientPhone|appt\.clientPhone|aviso\.telefono)\}/, archivo);
  }
});
