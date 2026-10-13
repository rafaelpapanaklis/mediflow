// Píxel + Events API de TikTok (ws1-t5, tanda ws7). `window` simulado y fetch
// falso: sin red ni base.
import test from "node:test";
import assert from "node:assert/strict";
import { TIKTOK_PIXEL_ID } from "../tiktok-pixel";
import {
  construirEventoTiktok,
  enviarEventosTiktok,
  telefonoE164,
  _reiniciarAvisoSinTokenTiktok,
  TIKTOK_EVENTS_URL,
} from "../tiktok-capi";
import { sha256 } from "../meta-capi";
import { cargarPixelTiktok, trackTiktokCompleteRegistration, trackTiktokContactWhatsapp, medirCompraTiktok, claveMarcaTiktok } from "../tiktok-events";
import { cookieParaTiktok, extraerTtclid, ttclidDeCookies, ttpDeCookies } from "../../ads/tiktok-click";
import { enviarCompraTiktokDeSesion, enviarCompraTiktokSpei, enviarRegistroTiktok, metadataTiktokDePeticion, type PuertosTiktok } from "../tiktok-capi.server";
import type { EventoTiktok } from "../tiktok-capi";

function conWindow(pathname: string, ext: Record<string, unknown>, fn: () => void) {
  const g = globalThis as unknown as { window?: unknown };
  const antes = g.window;
  g.window = { location: { pathname }, ...ext };
  try { fn(); } finally { g.window = antes; }
}

const TTCLID = "E.C.P.AbCdEf123456";

test("el Pixel ID es el de «DaleControl Pixel»", () => {
  assert.equal(TIKTOK_PIXEL_ID, "DB6NHKJC77UDJT303SAG");
});

test("Contact: ttq.track con event_id y solo el origen; ni en rutas privadas ni sin ttq", () => {
  const llamadas: unknown[][] = [];
  const ttq = { track: (...a: unknown[]) => llamadas.push(a) };
  conWindow("/", { ttq }, () => assert.equal(trackTiktokContactWhatsapp("hero", "wa.hero.x"), true));
  assert.deepEqual(llamadas[0], ["Contact", { content_name: "whatsapp_hero" }, { event_id: "wa.hero.x" }]);
  for (const ruta of ["/dashboard/pacientes", "/paciente/citas", "/portal/x", "/admin"]) {
    conWindow(ruta, { ttq }, () => assert.equal(trackTiktokContactWhatsapp("hero", "a"), false));
  }
  conWindow("/", {}, () => assert.equal(trackTiktokContactWhatsapp("hero", "a"), false));
  assert.equal(llamadas.length, 1);
});

test("CompleteRegistration: con event_id manda; sin id no", () => {
  const llamadas: unknown[][] = [];
  const ttq = { track: (...a: unknown[]) => llamadas.push(a) };
  conWindow("/signup", { ttq }, () => {
    assert.equal(trackTiktokCompleteRegistration("alta.c1"), true);
    assert.equal(trackTiktokCompleteRegistration(null), false);
  });
  assert.deepEqual(llamadas, [["CompleteRegistration", {}, { event_id: "alta.c1" }]]);
});

test("CompletePayment: valor sin IVA, event_id = sesión, una sola vez por navegador", () => {
  const llamadas: unknown[][] = [];
  const guardado = new Map<string, string>();
  const ext = {
    ttq: { track: (...a: unknown[]) => llamadas.push(a) },
    localStorage: { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) },
  };
  conWindow("/dashboard/suspended/success", ext, () => {
    assert.equal(medirCompraTiktok({ transactionId: "cs_live_1", valueMxn: 449.14, currency: "mxn" }), "enviada");
    assert.equal(medirCompraTiktok({ transactionId: "cs_live_1", valueMxn: 449.14, currency: "mxn" }), "ya-enviada");
  });
  assert.deepEqual(llamadas, [["CompletePayment", { value: 449.14, currency: "MXN" }, { event_id: "cs_live_1" }]]);
  assert.ok(guardado.has(claveMarcaTiktok("cs_live_1")));
});

test("ttclid: valida la forma, último gana, cookie propia", () => {
  assert.equal(extraerTtclid(new URLSearchParams(`ttclid=${TTCLID}`)), TTCLID);
  assert.equal(extraerTtclid(new URLSearchParams("ttclid=<script>")), undefined);
  assert.equal(cookieParaTiktok(TTCLID, null), TTCLID);
  assert.equal(cookieParaTiktok(TTCLID, TTCLID), null); // mismo: no se renueva
  assert.equal(cookieParaTiktok(undefined, null), null);
  const leer = (n: string) => ({ dc_tt: TTCLID, _ttp: "abcDEF123_ttp-xyz" } as Record<string, string>)[n];
  assert.equal(ttclidDeCookies(leer), TTCLID);
  assert.equal(ttpDeCookies(leer), "abcDEF123_ttp-xyz");
  assert.deepEqual(metadataTiktokDePeticion(leer), { tt_ttclid: TTCLID, tt_ttp: "abcDEF123_ttp-xyz" });
  assert.deepEqual(metadataTiktokDePeticion(() => null), {});
});

test("evento CompleteRegistration: correo y teléfono solo en SHA-256, sin datos en claro", () => {
  const ev = construirEventoTiktok({
    eventName: "CompleteRegistration",
    eventId: "alta.c1",
    eventTime: 1760000000.9,
    eventSourceUrl: "https://dalecontrol.com/signup",
    email: "  Juan@Clinica.MX ",
    phone: "55 1234 5678",
    ip: "200.1.2.3",
    userAgent: "Mozilla/5.0",
    ttclid: TTCLID,
    ttp: "abcDEF123_ttp-xyz",
  });
  assert.equal(ev.event, "CompleteRegistration");
  assert.equal(ev.event_time, 1760000000);
  assert.equal(ev.user.email, sha256("juan@clinica.mx"));
  assert.equal(ev.user.phone_number, sha256("+525512345678"));
  assert.equal(ev.user.ttclid, TTCLID);
  assert.equal(ev.properties, undefined);
  assert.ok(!JSON.stringify(ev).includes("juan@clinica.mx"));
  assert.ok(!JSON.stringify(ev).includes("5512345678"));
});

test("evento CompletePayment: valor redondeado a centavos, MXN; inválidos se descartan", () => {
  const ev = construirEventoTiktok({
    eventName: "CompletePayment",
    eventId: "cs_live_1",
    eventTime: 1,
    value: 449.1399,
    email: "no-es-correo",
    phone: "123",
    ttclid: "<x>",
  });
  assert.deepEqual(ev.properties, { value: 449.14, currency: "MXN", content_type: "product" });
  assert.deepEqual(ev.user, {});
  assert.equal(telefonoE164("5215512345678"), "+525512345678");
});

test("Events API: token en cabecera (no en URL ni en cuerpo), pixel como event_source_id", async () => {
  let visto: { url: string; init: { headers: Record<string, string>; body: string } } | null = null;
  const r = await enviarEventosTiktok(
    [construirEventoTiktok({ eventName: "CompletePayment", eventId: "cs_1", eventTime: 1, value: 10 })],
    { token: "SECRETO", testEventCode: "TEST1" },
    async (url, init) => { visto = { url, init }; return { ok: true, status: 200, text: async () => '{"code":0,"message":"OK"}' }; },
  );
  assert.equal(r, "enviado");
  assert.equal(visto!.url, TIKTOK_EVENTS_URL);
  assert.ok(!visto!.url.includes("SECRETO"));
  assert.equal(visto!.init.headers["Access-Token"], "SECRETO");
  const cuerpo = JSON.parse(visto!.init.body);
  assert.ok(!visto!.init.body.includes("SECRETO"));
  assert.equal(cuerpo.event_source, "web");
  assert.equal(cuerpo.event_source_id, TIKTOK_PIXEL_ID);
  assert.equal(cuerpo.test_event_code, "TEST1");
  assert.equal(cuerpo.data[0].event_id, "cs_1");
});

test("Events API: sin token no llama a la red; code≠0 y HTTP 500 son error; el token no sale en el log", async () => {
  _reiniciarAvisoSinTokenTiktok();
  const ev = [construirEventoTiktok({ eventName: "CompleteRegistration", eventId: "a", eventTime: 1 })];
  let llamado = false;
  const f = async () => { llamado = true; return { ok: true, status: 200, text: async () => "{}" }; };
  assert.equal(await enviarEventosTiktok(ev, { token: "" }, f), "sin-token");
  assert.equal(llamado, false);
  const avisos: string[] = [];
  const w = console.warn;
  console.warn = (...a: unknown[]) => void avisos.push(a.join(" "));
  try {
    assert.equal(await enviarEventosTiktok(ev, { token: "SECRETO" }, async () => ({ ok: true, status: 200, text: async () => '{"code":40001,"message":"bad SECRETO"}' })), "error");
    assert.equal(await enviarEventosTiktok(ev, { token: "SECRETO" }, async () => ({ ok: false, status: 500, text: async () => "boom" })), "error");
    assert.equal(await enviarEventosTiktok(ev, { token: "SECRETO" }, async () => { throw new Error("red SECRETO"); }), "error");
  } finally { console.warn = w; }
  assert.equal(avisos.length, 3);
  assert.ok(avisos.every((a) => !a.includes("SECRETO")));
});

function puertosFalsos(enviados: EventoTiktok[]): PuertosTiktok {
  return {
    enviar: async (e) => { enviados.push(...e); return "enviado"; },
    contactoClinica: async () => ({ email: "dr@clinica.mx", phone: "5512345678" }),
    ahora: () => 1_760_000_000_000,
  };
}

test("servidor: registro usa alta.<clinicId>; sin clínica no manda", async () => {
  const out: EventoTiktok[] = [];
  const p = puertosFalsos(out);
  assert.equal(await enviarRegistroTiktok({ clinicId: "", email: null, phone: null, senales: {} }, p), "sin-datos");
  await enviarRegistroTiktok({ clinicId: "c1", email: "dr@clinica.mx", phone: null, senales: { ttclid: TTCLID } }, p);
  assert.equal(out[0].event_id, "alta.c1");
  assert.equal(out[0].event, "CompleteRegistration");
  assert.equal(out[0].user.ttclid, TTCLID);
});

test("servidor: CompletePayment solo de la primera contratación pagada; valor sin IVA", async () => {
  const out: EventoTiktok[] = [];
  const p = puertosFalsos(out);
  const sesion = {
    id: "cs_live_abc",
    payment_status: "paid",
    amount_total: 52100,
    total_details: { amount_tax: 7186 },
    currency: "mxn",
    metadata: { clinicId: "c1", kind: "platform-subscription", firstContract: "1", meta_ip: "1.2.3.4", meta_ua: "UA", tt_ttclid: TTCLID },
  };
  assert.equal(await enviarCompraTiktokDeSesion(sesion, p), "enviado");
  assert.equal(out[0].event, "CompletePayment");
  assert.equal(out[0].event_id, "cs_live_abc");
  assert.equal(out[0].properties?.value, 449.14);
  assert.equal(out[0].user.ttclid, TTCLID);
  assert.equal(out[0].user.ip, "1.2.3.4");
  // renovación: no cuenta
  out.length = 0;
  assert.equal(await enviarCompraTiktokDeSesion({ ...sesion, metadata: { ...sesion.metadata, firstContract: "0" } }, p), "no-aplica");
  assert.equal(await enviarCompraTiktokDeSesion({ ...sesion, payment_status: "unpaid" }, p), "no-aplica");
  assert.equal(out.length, 0);
});

test("servidor: SPEI directo → event_id spei.<id>; renovación no cuenta", async () => {
  const out: EventoTiktok[] = [];
  const p = puertosFalsos(out);
  const sp = { senalesDeSolicitud: async () => ({ ip: "9.9.9.9", userAgent: "UA" }) };
  const previa = { solicitudId: "s1", clinicId: "c1", subtotalCents: 38800, primeraContratacion: true };
  assert.equal(await enviarCompraTiktokSpei(previa, p, sp), "enviado");
  assert.equal(out[0].event_id, "spei.s1");
  assert.equal(out[0].properties?.value, 388);
  assert.equal(await enviarCompraTiktokSpei({ ...previa, primeraContratacion: false }, p, sp), "no-aplica");
  assert.equal(await enviarCompraTiktokSpei(null, p, sp), "no-aplica");
});

test("arranque: solo en rutas públicas, una vez, con el SDK async y el pixel id", () => {
  const scripts: { src: string; async: boolean }[] = [];
  const g = globalThis as unknown as { document?: unknown };
  const docAntes = g.document;
  g.document = { createElement: () => ({}), head: { appendChild: (s: { src: string; async: boolean }) => scripts.push(s) } };
  try {
    conWindow("/dashboard", {}, () => assert.equal(cargarPixelTiktok(), false));
    assert.equal(scripts.length, 0);
    const w: Record<string, unknown> = {};
    const gg = globalThis as unknown as { window?: unknown };
    const antes = gg.window;
    gg.window = { location: { pathname: "/" }, ...w };
    try {
      assert.equal(cargarPixelTiktok(), true);
      assert.equal(cargarPixelTiktok(), true); // idempotente
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].async, true);
      assert.match(scripts[0].src, /^https:\/\/analytics\.tiktok\.com\/i18n\/pixel\/events\.js\?sdkid=DB6NHKJC77UDJT303SAG&lib=ttq$/);
      const ttq = (gg.window as { ttq: unknown[] & { track: (...a: unknown[]) => void } }).ttq;
      ttq.track("Contact", {}, { event_id: "x" });
      assert.deepEqual(ttq.at(-1), ["track", "Contact", {}, { event_id: "x" }]);
    } finally { gg.window = antes; }
  } finally { g.document = docAntes; }
});
