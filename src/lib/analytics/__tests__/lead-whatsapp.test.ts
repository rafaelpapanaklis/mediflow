// Lead de Meta y conversión secundaria «Clic en WhatsApp» de Google Ads (ws1-t5).
// `window` simulado; sin red.
import test from "node:test";
import assert from "node:assert/strict";
import { eventIdLeadWhatsapp, trackMetaLeadWhatsapp } from "../meta-pixel-eventos";
import { whatsappClickSendTo } from "../../gtag";
import { trackWhatsappClickConversion } from "../whatsapp-clic";

function conWindow(pathname: string, ext: Record<string, unknown>, fn: () => void) {
  const g = globalThis as unknown as { window?: unknown };
  const antes = g.window;
  g.window = { location: { pathname }, ...ext };
  try { fn(); } finally { g.window = antes; }
}

test("Lead: fbq('track','Lead') con eventID y solo el origen, sin datos personales", () => {
  const llamadas: unknown[][] = [];
  conWindow("/", { fbq: (...a: unknown[]) => llamadas.push(a) }, () => {
    const id = trackMetaLeadWhatsapp("hero");
    assert.match(id!, /^wa\.hero\./);
    assert.deepEqual(llamadas[0], ["track", "Lead", { content_name: "whatsapp_hero" }, { eventID: id }]);
  });
});

test("Lead: dos clics = dos event_id distintos", () => {
  assert.notEqual(eventIdLeadWhatsapp("precio", 1000, 0.1), eventIdLeadWhatsapp("precio", 1001, 0.1));
});

test("Lead: no sale en rutas privadas, sin fbq ni con origen fuera de la lista", () => {
  const llamadas: unknown[][] = [];
  const fbq = (...a: unknown[]) => llamadas.push(a);
  for (const ruta of ["/dashboard/pacientes", "/paciente/citas", "/portal/x", "/admin"]) {
    conWindow(ruta, { fbq }, () => assert.equal(trackMetaLeadWhatsapp("hero"), null));
  }
  conWindow("/", {}, () => assert.equal(trackMetaLeadWhatsapp("hero"), null));
  conWindow("/", { fbq }, () => assert.equal(trackMetaLeadWhatsapp("juan@x.com" as never), null));
  assert.equal(llamadas.length, 0);
});

test("Ads «Clic en WhatsApp»: etiqueta vacía no manda nada; con etiqueta manda send_to sin valor", () => {
  assert.equal(whatsappClickSendTo("  "), null);
  assert.equal(whatsappClickSendTo("abc"), "AW-18276007996/abc");
  const llamadas: unknown[][] = [];
  const gtag = (...a: unknown[]) => llamadas.push(a);
  conWindow("/", { gtag }, () => {
    assert.equal(trackWhatsappClickConversion(""), false);
    assert.equal(trackWhatsappClickConversion("abc"), true);
  });
  assert.deepEqual(llamadas, [["event", "conversion", { send_to: "AW-18276007996/abc" }]]);
});

test("Ads «Clic en WhatsApp»: nada en rutas privadas ni sin gtag", () => {
  const llamadas: unknown[][] = [];
  conWindow("/dashboard", { gtag: (...a: unknown[]) => llamadas.push(a) }, () =>
    assert.equal(trackWhatsappClickConversion("abc"), false));
  conWindow("/", {}, () => assert.equal(trackWhatsappClickConversion("abc"), false));
  assert.equal(llamadas.length, 0);
});

test("medirClicWhatsapp: un clic = un Lead de Meta y (con etiqueta) un ping de Ads", async () => {
  const { medirClicWhatsapp } = await import("../whatsapp-clic");
  const fb: unknown[][] = [];
  conWindow("/", { fbq: (...a: unknown[]) => fb.push(a), gtag: () => {} }, () => {
    const r = medirClicWhatsapp("precio");
    assert.match(r.metaEventId!, /^wa\.precio\./);
    assert.equal(r.ads, false); // etiqueta de Rafael aún vacía
  });
  assert.equal(fb.length, 1);
});
