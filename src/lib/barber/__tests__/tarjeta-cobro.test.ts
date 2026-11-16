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
  STARS_CARD_TEMPLATE_NAME,
  absoluteCardUrl,
  decideStarsCardSend,
  isStarsCardRow,
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

test("la marca de la cola: una por ticket, y se lee de vuelta", () => {
  const m = starsCardMark("sale-123");
  assert.equal(m, "auto:tarjeta:sale-123");
  assert.equal(isStarsCardRow(m), true);
  assert.equal(saleIdOfStarsCardRow(m), "sale-123");
  assert.equal(isStarsCardRow("dc_barber_recordatorio_cita"), false);
  assert.equal(saleIdOfStarsCardRow("auto:acuse"), null);
});

test("caduca a las 12 h si no pudo salir", () => {
  const now = new Date("2026-11-16T20:00:00Z");
  const base = { kind: "starsCard" as const, now, appointment: null };
  assert.equal(barberOutboxStaleReason({ ...base, createdAt: new Date(now.getTime() - 11 * 3600_000) }), null);
  assert.match(barberOutboxStaleReason({ ...base, createdAt: new Date(now.getTime() - 13 * 3600_000) }) ?? "", /caducó/);
});

test("quién recibe: interruptor, estrellas, celular, baja, WhatsApp, una vez", () => {
  const ok = { enabled: true, hasStars: true, phone: "55 1234 5678", optedOut: false, connected: true, alreadyQueued: false };
  assert.deepEqual(decideStarsCardSend(ok), { send: true, phone: "5512345678" });
  assert.deepEqual(decideStarsCardSend({ ...ok, hasStars: false }), { send: false, skip: "noStars" });
  assert.deepEqual(decideStarsCardSend({ ...ok, enabled: false }), { send: false, skip: "off" });
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
    for (const k of ["cardSentWa", "cardQueuedWa", "sendCardManual", "sendCardManualHint"]) assert.ok(es.caja[k], `${k} en ${l}`);
  }
  const ajES = JSON.parse(readFileSync(join(RAIZ, "src/i18n/dictionaries/barber/ajustes.es.json"), "utf8"));
  assert.equal(ajES.configuracion.starsCard.enabled, "Mandar la tarjeta de estrellas después de cobrar");
});
