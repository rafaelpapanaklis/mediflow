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

test("Socios sin permiso: ya no dice el texto de Suscripción («contratar, cambiar o cancelar el plan»)", () => {
  const page = readFileSync("src/app/barber/(panel)/afiliados/page.tsx", "utf8");
  assert.doesNotMatch(page, /barber\.suscripcion\.hero\.onlyOwner/);
  assert.match(page, /barber\.afiliados\.blocker\.onlyOwner/);
  assert.match(dict("afiliados", "es").blocker.onlyOwner, /programa de socios/);
  assert.ok(dict("afiliados", "en").blocker.onlyOwner);
});

test("Campañas › Plantillas: ya no dice «Plantilla aprobada por Meta» (nadie lo comprobó) ni enseña {{1}}/{{2}}/{premio}", () => {
  const panel = readFileSync("src/components/barber/campanas/templates-panel.tsx", "utf8");
  assert.doesNotMatch(panel, /templates\.approved/);
  assert.match(panel, /templates\.sentWith/);
  for (const l of ["es", "en"] as const) {
    const d = dict("campanas", l).templates;
    assert.equal(d.approved, undefined, "la llave engañosa se fue");
    assert.doesNotMatch(d.sentWith, /aprobada por Meta\b(?! la)|approved by Meta$/);
    for (const k of ["label", "name", "shop", "reward"]) assert.ok(d.sample[k], `${l} sample.${k}`);
  }
  // El ejemplo sustituye las tres variables y {premio}.
  for (const v of ['"{{1}}"', '"{{2}}"', '"{{3}}"', '"{premio}"']) assert.ok(panel.includes(`.split(${v})`), v);
  // y el nombre real de la barbería llega desde la página
  assert.match(readFileSync("src/app/barber/(panel)/campanas/page.tsx", "utf8"), /shopName=\{ctx\.barbershop\.name\}/);
});

test("WhatsApp › Conexión: el aviso de llave ilegible no promete un botón que puede no estar, y el id de Meta no se llama «número»", () => {
  for (const l of ["es", "en"] as const) {
    const c = dict("whatsapp", l).connection;
    assert.doesNotMatch(c.tokenUnreadable, /botón de abajo|button below/);
    assert.ok(c.metaId);
  }
  const panel = readFileSync("src/components/barber/whatsapp/connection-panel.tsx", "utf8");
  assert.doesNotMatch(panel, /connection\.displayPhone \?\? connection\.phoneNumberId/);
  assert.match(panel, /connection\.metaId/);
});
