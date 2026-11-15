// MENSAJES — la bandeja de WhatsApp con entrada propia (15-nov, Rafael:
// «saca "Conversaciones" al menú principal abajo de Clientes y ponlo como
// "Mensajes"»).
//
//   npx tsx --test src/lib/barber/__tests__/mensajes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\{\s*\}/g, "");

// ── La mudanza ───────────────────────────────────────────────────────────

test("WhatsApp ya no tiene la pestaña «Conversaciones»: Conexión, Plantillas, Campañas y Bot", () => {
  const pantalla = sinComentarios(leer("src/components/barber/whatsapp/whatsapp-screen.tsx"));
  assert.doesNotMatch(pantalla, /InboxPanel/);
  assert.doesNotMatch(pantalla, /tabs\.inbox/);
  for (const llave of ["tabs.conexion", "tabs.plantillas", "tabs.campanas", "tabs.bot"]) {
    assert.match(pantalla, new RegExp(llave.replace(".", "\\.")), llave);
  }
});

test("la liga vieja de la pestaña lleva a /barber/mensajes, después del candado de pago", () => {
  const pagina = sinComentarios(leer("src/app/barber/(panel)/whatsapp/page.tsx"));
  assert.match(pagina, /redirect\("\/barber\/mensajes"\)/);
  for (const nombre of ["inbox", "conversaciones"]) assert.match(pagina, new RegExp(`"${nombre}"`));
  const cuerpo = pagina.slice(pagina.indexOf("export default async function"));
  const awaits = Array.from(cuerpo.matchAll(/await\s+([A-Za-z_$][\w$.]*)/g)).map((m) => m[1]);
  assert.deepEqual(awaits.slice(0, 3), ["getBarberContext", "requireBarberPaidAccess", "props.searchParams"]);
});

test("el bot: cada chat que atiende una persona abre su conversación en Mensajes", () => {
  const bot = leer("src/components/barber/bot/bot-screen.tsx");
  assert.match(bot, /\/barber\/mensajes\?tel=\$\{encodeURIComponent\(p\.phone\)\}/);
  for (const loc of ["es", "en"]) {
    const dict = JSON.parse(leer(`src/i18n/dictionaries/barber/bot.${loc}.json`));
    assert.ok(dict.pauses.openChat, `falta pauses.openChat en ${loc}`);
  }
});

test("/barber/mensajes tiene su página, con el candado de la bandeja", () => {
  const pagina = sinComentarios(leer("src/app/barber/(panel)/mensajes/page.tsx"));
  assert.match(pagina, /hasBarberPermission\(permUser, "whatsapp\.view"\)/);
  assert.match(pagina, /barberPlanHasFeature\(plan, "whatsappInbox"\)/);
});
