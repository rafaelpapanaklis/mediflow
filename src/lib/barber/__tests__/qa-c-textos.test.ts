/* ═══════════════════════════════════════════════════════════════════════
   QA C en navegador (15-nov-2026): textos que la pantalla decía mal.

     npx tsx --test src/lib/barber/__tests__/qa-c-textos.test.ts

   Cada prueba es un hallazgo del recorrido con su arreglo.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dict = (area: string, l: "es" | "en") =>
  JSON.parse(readFileSync(`src/i18n/dictionaries/barber/${area}.${l}.json`, "utf8"));

test("Suscripción: la cabecera dice Plan / Vigencia / Tarjeta, no «Planes / Fecha / Actualizar tarjeta»", () => {
  const panel = readFileSync("src/components/barber/billing/subscription-panel.tsx", "utf8");
  // Antes reusaba el título de la sección, la columna de facturas y un botón.
  assert.doesNotMatch(panel, /dcbb-kicker">\{t\("barber\.suscripcion\.plans\.title"\)\}/);
  assert.doesNotMatch(panel, /dcbb-kicker">\{t\("barber\.suscripcion\.invoices\.date"\)\}/);
  for (const k of ["planLabel", "dateLabel", "cardLabel"]) {
    assert.match(panel, new RegExp(`barber\\.suscripcion\\.hero\\.${k}`));
    for (const l of ["es", "en"] as const) assert.ok(dict("suscripcion", l).hero[k], `${l} hero.${k}`);
  }
  assert.equal(dict("suscripcion", "es").hero.cardLabel, "Tarjeta");
});

test("WhatsApp a soporte desde el error del cobro: sin nombre ya no dice «Hola, soy y necesito…»", async () => {
  const { barberSupportWhatsappUrl } = await import("../marketing");
  const texto = (u: string) => decodeURIComponent(u.split("text=")[1]);
  assert.equal(texto(barberSupportWhatsappUrl()), "Hola, necesito ayuda con mi suscripción de DaleControl Barber.");
  assert.equal(texto(barberSupportWhatsappUrl("   ")), "Hola, necesito ayuda con mi suscripción de DaleControl Barber.");
  assert.match(texto(barberSupportWhatsappUrl("Barbería Prueba")), /^Hola, soy de la barbería Barbería Prueba y necesito ayuda/);
});
