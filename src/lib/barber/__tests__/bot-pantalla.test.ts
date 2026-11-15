/* ═══════════════════════════════════════════════════════════════════════
   LA PANTALLA DEL BOT NO MIENTE Y HABLA EN CRISTIANO.

     npx tsx --test src/lib/barber/__tests__/bot-pantalla.test.ts

   Pulido · punto 6 (M13 de la revisión de ws6-t3).
     · «El bot está atendiendo todos los chats» solo con el bot encendido y
       con WhatsApp conectado.
     · «Tope de gasto de IA» → «Gasto máximo del bot por día»; el nombre del
       modelo («claude-…») no se le enseña al dueño.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { botEmptyKey } from "@/components/barber/bot/bot-empty";
import { getBarberT } from "@/i18n/dictionaries/barber";

test("«atendiendo todos los chats» solo si está encendido, conectado y sin bloqueo", () => {
  assert.equal(botEmptyKey({ connected: true, enabled: true, blocked: false }), "pauses.empty");
  assert.equal(botEmptyKey({ connected: true, enabled: false, blocked: false }), "pauses.emptyOff");
  assert.equal(botEmptyKey({ connected: false, enabled: true, blocked: true }), "pauses.emptyNotConnected");
  assert.equal(botEmptyKey({ connected: false, enabled: false, blocked: true }), "pauses.emptyNotConnected");
  assert.equal(botEmptyKey({ connected: true, enabled: true, blocked: true }), "pauses.emptyBlocked");
});

test("los textos están en es y en, y solo el caso bueno dice que atiende todos los chats", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  for (const k of ["empty", "emptyOff", "emptyNotConnected", "emptyBlocked"]) {
    assert.notEqual(es(`barber.bot.pauses.${k}`), `barber.bot.pauses.${k}`, `es ${k}`);
    assert.notEqual(en(`barber.bot.pauses.${k}`), `barber.bot.pauses.${k}`, `en ${k}`);
  }
  for (const k of ["emptyOff", "emptyNotConnected", "emptyBlocked"]) {
    assert.doesNotMatch(es(`barber.bot.pauses.${k}`), /atendiendo todos/);
    assert.doesNotMatch(en(`barber.bot.pauses.${k}`), /handling every chat/);
  }
  assert.equal(es("barber.bot.spend.title"), "Gasto máximo del bot por día");
  assert.doesNotMatch(es("barber.bot.spend.title") + es("barber.bot.spend.hint") + es("barber.bot.spend.capLabel"), /[Tt]ope|IA\b/);
});

test("la pantalla no enseña el nombre del modelo y escoge el texto del vacío con botEmptyKey", () => {
  const src = readFileSync(path.resolve(__dirname, "../../../components/barber/bot/bot-screen.tsx"), "utf8");
  assert.doesNotMatch(src, /spend\.model/);
  assert.doesNotMatch(src, /initial\.aiModel/);
  assert.match(src, /botEmptyKey\(\{ connected, enabled: settings\.enabled/);
  // Encendido pero bloqueado: el interruptor no dice «está contestando».
  assert.match(src, /settings\.enabled \? \(blocked \?\? t\("power\.hintOn"\)\)/);
});
