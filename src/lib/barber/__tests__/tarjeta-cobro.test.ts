// La tarjeta de estrellas tras el cobro (ws6-t1, 16-nov, punto 2): la parte pura.
//
//   npx tsx --test src/lib/barber/__tests__/tarjeta-cobro.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BARBER_WA_TEMPLATES,
  barberOutboxStaleReason,
  barberWaTemplate,
  checkBarberWaTemplate,
} from "@/lib/barber/whatsapp-core";
import {
  STARS_CARD_MODE_DEFAULT,
  STARS_CARD_TEMPLATE_NAME,
  absoluteCardUrl,
  decideStarsCardSend,
  isStarsCardRow,
  parseStarsCardRow,
  readStarsCardMode,
  starsCardMarks,
  starsCardRowMayUseTemplate,
  manualStarsCardResult,
  originOfFirstLink,
  renderStarsCardText,
  saleIdOfStarsCardRow,
  starsCardChargeMoves,
  starsCardMark,
  starsCardParams,
  starsCardTotal,
} from "@/lib/barber/tarjeta-cobro-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

test("la plantilla está en el catálogo que la barbería manda a revisión: UTILITY, 4 variables, reglas de Meta", () => {
  const tpl = barberWaTemplate("starsCard");
  assert.equal(tpl.name, STARS_CARD_TEMPLATE_NAME);
  assert.equal(tpl.category, "UTILITY");
  assert.equal(tpl.optional, false, "se da de alta con «Dar de alta las que falten», sin activarla aparte");
  assert.deepEqual(tpl.variables, ["cliente", "estrellas", "total", "enlace de la tarjeta"]);
  assert.equal(checkBarberWaTemplate(tpl), null);
  assert.equal(BARBER_WA_TEMPLATES.filter((t) => t.name === STARS_CARD_TEMPLATE_NAME).length, 1);
  for (const l of ["es", "en"]) {
    const d = JSON.parse(readFileSync(join(RAIZ, `src/i18n/dictionaries/barber/whatsapp.${l}.json`), "utf8"));
    assert.ok(JSON.stringify(d).includes('"starsCard"'), `etiqueta de la plantilla en ${l}`);
  }
});

test("el texto (ventana abierta y botón manual) dice EXACTAMENTE lo mismo que la plantilla", () => {
  const params = starsCardParams({ firstName: "Luis", stars: 4, total: 6, url: "https://x.test/b/el-corte/tarjeta/abc" });
  assert.deepEqual(params, ["Luis", "4", "6", "https://x.test/b/el-corte/tarjeta/abc"]);
  const desdePlantilla = barberWaTemplate("starsCard").body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1]);
  assert.equal(renderStarsCardText(params), desdePlantilla);
  assert.match(renderStarsCardText(params), /Llevas 4 de 6 estrellas/);
});

test("de cuántas: las del siguiente bono; sin bono pendiente, las que lleva", () => {
  assert.equal(starsCardTotal(4, { cost: 6 }), 6);
  assert.equal(starsCardTotal(9, null), 9);
  assert.equal(starsCardTotal(0, null), 1);
});

test("¿el cobro movió la tarjeta?: gana una estrella o usa un bono; solo productos, no", () => {
  assert.equal(starsCardChargeMoves({ gained: 1, used: null }), true);
  assert.equal(starsCardChargeMoves({ gained: 0, used: { name: "Barba", stars: 5 } }), true);
  assert.equal(starsCardChargeMoves({ gained: 0, used: null }), false);
  assert.equal(starsCardChargeMoves(null), false);
});

test("la marca de la cola: «Siempre» y «Solo gratis» se leen de vuelta; solo «Siempre» puede usar plantilla", () => {
  const siempre = starsCardMark("sale-123", false);
  const gratis = starsCardMark("sale-123", true);
  assert.equal(siempre, "auto:tarjeta:sale-123");
  assert.equal(gratis, "auto:tarjeta-gratis:sale-123");
  assert.deepEqual(starsCardMarks("sale-123"), [siempre, gratis], "una vez por ticket mira las dos");
  assert.deepEqual(parseStarsCardRow(siempre), { saleId: "sale-123", freeOnly: false });
  assert.deepEqual(parseStarsCardRow(gratis), { saleId: "sale-123", freeOnly: true });
  assert.equal(starsCardRowMayUseTemplate(siempre), true);
  assert.equal(starsCardRowMayUseTemplate(gratis), false, "una fila «gratis» NUNCA sale con plantilla (de pago)");
  assert.equal(isStarsCardRow(gratis), true);
  assert.equal(saleIdOfStarsCardRow(gratis), "sale-123");
  assert.equal(isStarsCardRow("dc_barber_recordatorio_cita"), false);
  assert.equal(saleIdOfStarsCardRow("auto:acuse"), null);
  assert.equal(starsCardRowMayUseTemplate(null), false);
});

test("el modo de fábrica es «Solo cuando sea gratis»; un valor raro vuelve a él", () => {
  assert.equal(STARS_CARD_MODE_DEFAULT, "free");
  assert.equal(readStarsCardMode(null), "free");
  assert.equal(readStarsCardMode("gratis"), "free");
  assert.equal(readStarsCardMode("always"), "always");
  assert.equal(readStarsCardMode("off"), "off");
});

test("caduca a las 12 h si no pudo salir", () => {
  const now = new Date("2026-11-16T20:00:00Z");
  const base = { kind: "starsCard" as const, now, appointment: null };
  assert.equal(barberOutboxStaleReason({ ...base, createdAt: new Date(now.getTime() - 11 * 3600_000) }), null);
  assert.match(barberOutboxStaleReason({ ...base, createdAt: new Date(now.getTime() - 13 * 3600_000) }) ?? "", /caducó/);
});

test("los tres modos y la ventana de 24 h", () => {
  const base = { hasStars: true, phone: "55 1234 5678", optedOut: false, connected: true, alreadyQueued: false };
  // «Solo cuando sea gratis»: con la ventana abierta sí (sin plantilla); cerrada, no.
  assert.deepEqual(decideStarsCardSend({ ...base, mode: "free", windowOpen: true }), { send: true, phone: "5512345678", freeOnly: true });
  assert.deepEqual(decideStarsCardSend({ ...base, mode: "free", windowOpen: false }), { send: false, skip: "outsideWindow" });
  // «Siempre»: con o sin ventana (fuera, con plantilla).
  assert.deepEqual(decideStarsCardSend({ ...base, mode: "always", windowOpen: true }), { send: true, phone: "5512345678", freeOnly: false });
  assert.deepEqual(decideStarsCardSend({ ...base, mode: "always", windowOpen: false }), { send: true, phone: "5512345678", freeOnly: false });
  // «No mandar»: nunca.
  assert.deepEqual(decideStarsCardSend({ ...base, mode: "off", windowOpen: true }), { send: false, skip: "off" });
});

test("quién recibe: estrellas, celular, baja, WhatsApp, una vez", () => {
  const ok = { mode: "always" as const, windowOpen: false, hasStars: true, phone: "55 1234 5678", optedOut: false, connected: true, alreadyQueued: false };
  assert.deepEqual(decideStarsCardSend(ok), { send: true, phone: "5512345678", freeOnly: false });
  assert.deepEqual(decideStarsCardSend({ ...ok, hasStars: false }), { send: false, skip: "noStars" });
  assert.deepEqual(decideStarsCardSend({ ...ok, phone: "123" }), { send: false, skip: "noPhone" });
  assert.deepEqual(decideStarsCardSend({ ...ok, optedOut: true }), { send: false, skip: "optedOut" });
  assert.deepEqual(decideStarsCardSend({ ...ok, connected: false }), { send: false, skip: "notConnected" });
  assert.deepEqual(decideStarsCardSend({ ...ok, alreadyQueued: true }), { send: false, skip: "already" });
});

test("botón manual: wa.me con el texto ya escrito; sin celular, sin botón", () => {
  const r = manualStarsCardResult("5512345678", "Hola Luis", "templatePending");
  assert.equal(r.status, "manual");
  assert.equal(r.manualHref, "https://wa.me/525512345678?text=Hola%20Luis");
  assert.equal(manualStarsCardResult(null, "x", "noPhone").manualHref, null);
});

test("enlace absoluto y dominio del primer enlace del texto", () => {
  assert.equal(absoluteCardUrl("https://a.test/", "/b/x/tarjeta/t"), "https://a.test/b/x/tarjeta/t");
  assert.equal(originOfFirstLink("Ve tu tarjeta aquí: https://a.test/b/x/tarjeta/t\n\nGuárdala"), "https://a.test");
  assert.equal(originOfFirstLink("sin enlace"), null);
});

test("cableado: el cobro manda la tarjeta; Caja enseña el aviso o el botón; Configuración tiene el interruptor", () => {
  const ruta = readFileSync(join(RAIZ, "src/app/api/barber/sales/route.ts"), "utf8");
  assert.match(ruta, /sendStarsCardAfterCharge\(\{/);
  const modal = readFileSync(join(RAIZ, "src/components/barber/cash/ticket-modal.tsx"), "utf8");
  assert.match(modal, /data-accion="mandar-su-tarjeta"/);
  assert.ok(!modal.includes("https://wa.me"), "el wa.me lo arma el servidor, no la pantalla");
  const conf = readFileSync(join(RAIZ, "src/components/barber/configuracion/configuracion-screen.tsx"), "utf8");
  assert.match(conf, /<StarsCardAfterChargeCard/);
  for (const l of ["es", "en"]) {
    const aj = JSON.parse(readFileSync(join(RAIZ, `src/i18n/dictionaries/barber/ajustes.${l}.json`), "utf8"));
    assert.ok(aj.configuracion.starsCard.enabled, `interruptor en ${l}`);
    const es = JSON.parse(readFileSync(join(RAIZ, `src/i18n/dictionaries/barber/estrellas.${l}.json`), "utf8"));
    for (const k of ["cardSentWa", "cardQueuedWa", "sendCardManual", "sendCardManualHint", "sendCardManualHintFree"]) assert.ok(es.caja[k], `${k} en ${l}`);
  }
  const ajES = JSON.parse(readFileSync(join(RAIZ, "src/i18n/dictionaries/barber/ajustes.es.json"), "utf8"));
  assert.equal(ajES.configuracion.starsCard.enabled, "Mandar la tarjeta de estrellas después de cobrar");
  assert.equal(ajES.configuracion.starsCard.free, "Solo cuando sea gratis");
  assert.equal(ajES.configuracion.starsCard.always, "Siempre");
  assert.equal(ajES.configuracion.starsCard.off, "No mandar");
  assert.equal(ajES.configuracion.starsCard.alwaysCost, "Meta te cobra cada aviso fuera de las 24 h (lo paga tu cuenta de WhatsApp Business).");
  for (const l of ["en"]) {
    const aj = JSON.parse(readFileSync(join(RAIZ, `src/i18n/dictionaries/barber/ajustes.${l}.json`), "utf8"));
    for (const k of ["free", "freeHint", "always", "alwaysHint", "alwaysCost", "off", "offHint"]) assert.ok(aj.configuracion.starsCard[k], `${k} en ${l}`);
  }
  // El aviso de cobro va DEBAJO de «Siempre» y el de fábrica es el primero.
  assert.match(conf, /id: "always", title: t\("configuracion\.starsCard\.always"\), hint: t\("configuracion\.starsCard\.alwaysHint"\), warn: t\("configuracion\.starsCard\.alwaysCost"\)/);
  assert.match(conf, /json: \{ section: "starsCard", mode \}/);
});
