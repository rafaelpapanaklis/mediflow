/**
 * Verificación de Google — la sección «Datos de Google Calendar» de /privacidad
 * y el enlace a /privacidad en la página de inicio.
 *
 * `npx tsx --test src/app/privacidad/__tests__/seccion-google.test.ts`
 *
 * Google revisa a mano que la política (1) esté en el dominio de la página de
 * inicio y se enlace desde ella, (2) diga qué datos de Google se usan y para
 * qué, (3) lleve la declaración de Uso Limitado TEXTUAL. Si alguien reescribe
 * la sección y pierde algo de eso, la verificación se cae: por eso se prueba.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { FOOTER } from "@/components/public/landing/sales/v2/landing-data";

const raiz = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
const pagina = leer("src/app/privacidad/page.tsx");
const inicio = pagina.indexOf('id="google-calendar"');
const fin = pagina.indexOf('title="10. Cambios al aviso de privacidad"');
const seccion = pagina.slice(inicio, fin).replace(/\s+/g, " ");
// Lo que se LEE en pantalla: sin etiquetas ni los {" "} de JSX, y con las entidades que usamos resueltas.
const visible = seccion
  .replace(/\{" "\}/g, " ")
  .replace(/<[^>]+>/g, "")
  .replace(/&apos;/g, "'")
  .replace(/\s+/g, " ")
  .replace(/ ,/g, ",");

test("la sección existe, tiene ancla y está entre la 8 y la 10", () => {
  assert.ok(inicio > 0 && fin > inicio);
  assert.match(pagina, /<Section id="google-calendar" title="9\. Datos de Google Calendar/);
});

test("lleva la declaración de Uso Limitado TEXTUAL, en español y en inglés", () => {
  assert.ok(
    visible.includes(
      "El uso que DaleControl haga de la información recibida de las API de Google, y su transferencia a cualquier otra aplicación, cumplirá la Política de datos de usuario de los servicios de las API de Google, incluidos los requisitos de Uso Limitado.",
    ),
  );
  assert.ok(
    visible.includes(
      "DaleControl's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.",
    ),
  );
});

test("nombra el permiso estrecho y NO los que se quitaron", () => {
  assert.match(seccion, /https:\/\/www\.googleapis\.com\/auth\/calendar\.app\.created/);
  assert.doesNotMatch(seccion, /auth\/calendar<\/code>/);
  assert.doesNotMatch(seccion, /calendar\.events/);
  assert.match(seccion, /openid/);
});

test("dice qué se escribe, que las notas y datos clínicos no viajan, para qué se usa y que no hay IA/venta/publicidad", () => {
  assert.match(seccion, /nunca se envían a Google/);
  assert.match(seccion, /notas internas de la cita/);
  assert.match(seccion, /no los vendemos/);
  assert.match(seccion, /no los usamos para entrenar modelos de inteligencia artificial/);
  assert.match(seccion, /ni para crear perfiles/);
  assert.match(seccion, /Internal appointment notes and clinical data are never sent/);
});

test("dice cómo retirar los datos: Desconectar (revoca), eventos que se quedan, permisos de Google y correo de contacto", () => {
  assert.match(seccion, /revocamos el permiso ante Google/);
  assert.match(seccion, /se quedan/);
  assert.match(seccion, /myaccount\.google\.com\/permissions/);
  assert.match(seccion, /contacto@dalecontrol\.com|SUPPORT_EMAIL/);
  assert.match(pagina, /const SUPPORT_EMAIL = "contacto@dalecontrol\.com";/);
  assert.match(pagina, /const PRIVACY_EMAIL = "privacidad@dalecontrol\.com";/);
});

test("no promete lo que no hacemos: nada de «cifrado en reposo»", () => {
  assert.doesNotMatch(seccion, /cifrad/i);
});

test("la página de inicio enlaza visiblemente a /privacidad (footer Legal) y monta ese footer", () => {
  assert.ok(FOOTER.legal.some((l) => l.href === "/privacidad"));
  assert.match(leer("src/app/page.tsx"), /<SalesFooter portada \/>/);
  const footer = leer("src/components/public/landing/sales/footer.tsx");
  assert.match(footer, /FOOTER\.legal\.map/);
  // «portada» solo recorta la columna de Producto; Legal se pinta siempre.
  assert.doesNotMatch(footer.slice(footer.indexOf('aria-label="Legal"') - 200, footer.indexOf('aria-label="Legal"')), /portada &&/);
});

test("el aviso de /privacidad en Transferencias menciona a Google Calendar y remite a la sección 9", () => {
  const s5 = pagina.slice(pagina.indexOf('title="5. Transferencias"'), pagina.indexOf('title="6. Derechos ARCO"'));
  assert.match(s5, /Google LLC \(Google Calendar\)/);
  assert.match(s5, /sección 9/);
});
