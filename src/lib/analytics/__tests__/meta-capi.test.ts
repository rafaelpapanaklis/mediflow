/**
 * Píxel de Meta + API de Conversiones (WS1-T4).
 *
 * Run: npm run test:meta-capi
 *
 * Todo con Meta y Stripe FALSOS (fetch inyectado, puertos de base falsos y un
 * `window` simulado): ninguna prueba sale a la red ni toca la base.
 *   1. Hash y normalización de correo / teléfono como los pide Meta.
 *   2. Evento: website con user agent, system_generated sin él; fbp/fbc solo
 *      con forma válida; Purchase con value y MXN.
 *   3. Envío: sin token se apaga; el token va en el CUERPO (nunca en la URL) y
 *      jamás en el log; test_event_code solo si está configurado.
 *   4. CompleteRegistration: event_id alta.<clinicId>, señales de la petición.
 *   5. Purchase del webhook: solo primera contratación pagada, event_id = cs_…,
 *      value sin IVA con cupón, señales de la metadata y respaldo de la base.
 *   6. SPEI directo: primera contratación leída antes de confirmar.
 *   7. Navegador: CompleteRegistration y Purchase con eventID, UNA vez.
 *   8. Cableado: alta, checkout, webhook, SPEI, página de éxito, signup.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  _reiniciarAvisoSinToken,
  construirEventoCapi,
  enviarEventosCapi,
  eventIdRegistro,
  META_GRAPH_VERSION,
  normalizarCorreo,
  normalizarTelefono,
  sha256,
  type EventoCapi,
} from "../meta-capi";
import {
  enviarCompraMetaDeSesion,
  enviarCompraMetaSpei,
  enviarRegistroMeta,
  esCompraMeta,
  metadataMetaDePeticion,
  prepararCompraMetaSpei,
  senalesDePeticion,
  type PuertosMeta,
  type PuertosSpei,
  type SesionCompraMeta,
} from "../meta-capi.server";
import { claveMarcaMeta, medirCompraMeta, trackMetaCompleteRegistration } from "../meta-pixel-eventos";
import { META_PIXEL_ID } from "../meta-pixel";

const TOKEN = "TOKEN-FALSO-de-prueba-123";
const SESION = "cs_test_a1B2c3D4e5F6g7H8i9J0";
const CLINICA = "clinic_abc";
const FBP = "fb.1.1759300000000.1234567890";
const FBC = "fb.1.1759300000000.IwAR0abcdefghijKLMNOP";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

function capturarConsola<T>(fn: () => Promise<T>): Promise<{ r: T; log: string }> {
  const orig = { warn: console.warn, info: console.info, error: console.error };
  let log = "";
  const tomar = (...a: unknown[]) => { log += a.map(String).join(" ") + "\n"; };
  console.warn = tomar; console.info = tomar; console.error = tomar;
  return fn().then(
    (r) => { Object.assign(console, orig); return { r, log }; },
    (e) => { Object.assign(console, orig); throw e; },
  );
}

function puertosFalsos(over: Partial<PuertosMeta> = {}) {
  const enviados: EventoCapi[][] = [];
  const p: PuertosMeta = {
    enviar: async (ev) => { enviados.push(ev); return "enviado"; },
    contactoClinica: async () => ({ email: "Dra.Ana@Clinica.MX ", phone: "525512345678" }),
    clickMetaGuardado: async () => ({ fbc: FBC, fbp: FBP }),
    ahora: () => 1_759_300_123_456,
    ...over,
  };
  return { p, enviados };
}

function cabeceras(h: Record<string, string>) {
  return { headers: { get: (n: string) => h[n.toLowerCase()] ?? null } };
}

// ── 1. Normalización ────────────────────────────────────────────────────────

test("correo: minúsculas y sin espacios; basura → null", () => {
  assert.equal(normalizarCorreo("  Dra.Ana@Clinica.MX "), "dra.ana@clinica.mx");
  assert.equal(normalizarCorreo("no-es-correo"), null);
  assert.equal(normalizarCorreo(null), null);
});

test("teléfono: dígitos con lada 52; 10 dígitos → 52…; 521… → 52…", () => {
  assert.equal(normalizarTelefono("55 1234 5678"), "525512345678");
  assert.equal(normalizarTelefono("+52 55-1234-5678"), "525512345678");
  assert.equal(normalizarTelefono("5215512345678"), "525512345678");
  assert.equal(normalizarTelefono("123"), null);
});

test("sha256 en hex minúsculas (vector conocido)", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

// ── 2. Evento ───────────────────────────────────────────────────────────────

test("evento web: correo/teléfono en hash, IP/UA/fbp/fbc en claro, nunca el correo en claro", () => {
  const e = construirEventoCapi({
    eventName: "CompleteRegistration", eventId: "alta.x", eventTime: 1759300123.9,
    eventSourceUrl: "https://www.dalecontrol.com/signup",
    email: "Dra.Ana@Clinica.MX", phone: "5512345678", ip: "201.1.2.3", userAgent: UA, fbp: FBP, fbc: FBC,
  });
  assert.equal(e.action_source, "website");
  assert.equal(e.event_time, 1759300123);
  assert.deepEqual(e.user_data.em, [sha256("dra.ana@clinica.mx")]);
  assert.deepEqual(e.user_data.ph, [sha256("525512345678")]);
  assert.equal(e.user_data.client_ip_address, "201.1.2.3");
  assert.equal(e.user_data.client_user_agent, UA);
  assert.equal(e.user_data.fbp, FBP);
  assert.equal(e.user_data.fbc, FBC);
  assert.equal(e.custom_data, undefined);
  assert.ok(!JSON.stringify(e).includes("clinica.mx"));
});

test("sin user agent → system_generated y sin event_source_url; fbp/fbc con mala forma se descartan", () => {
  const e = construirEventoCapi({
    eventName: "Purchase", eventId: SESION, eventTime: 1, eventSourceUrl: "https://x", fbp: "basura", fbc: "fb.1.x.y", value: 419, currency: "mxn",
  });
  assert.equal(e.action_source, "system_generated");
  assert.equal(e.event_source_url, undefined);
  assert.equal(e.user_data.fbp, undefined);
  assert.equal(e.user_data.fbc, undefined);
  assert.deepEqual(e.custom_data, { value: 419, currency: "MXN" });
});

// ── 3. Envío ────────────────────────────────────────────────────────────────

test("sin META_CAPI_TOKEN: no hay red, 'sin-token' y el aviso no trae token", async () => {
  _reiniciarAvisoSinToken();
  let llamadas = 0;
  const { r, log } = await capturarConsola(() =>
    enviarEventosCapi([construirEventoCapi({ eventName: "Purchase", eventId: SESION, eventTime: 1 })], { token: "" }, async () => {
      llamadas++;
      return { ok: true, status: 200, text: async () => "" };
    }),
  );
  assert.equal(r, "sin-token");
  assert.equal(llamadas, 0);
  assert.match(log, /META_CAPI_TOKEN no está configurada/);
});

test("con token: POST al píxel correcto, token en el CUERPO y no en la URL; test_event_code solo si hay", async () => {
  const vistas: { url: string; body: any }[] = [];
  const fakeFetch = async (url: string, init: { body: string }) => {
    vistas.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => '{"events_received":1}' };
  };
  const ev = [construirEventoCapi({ eventName: "Purchase", eventId: SESION, eventTime: 1, value: 10 })];
  assert.equal(await enviarEventosCapi(ev, { token: TOKEN }, fakeFetch), "enviado");
  assert.equal(await enviarEventosCapi(ev, { token: TOKEN, testEventCode: "TEST12345" }, fakeFetch), "enviado");
  assert.equal(vistas[0].url, `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PIXEL_ID}/events`);
  assert.ok(!vistas[0].url.includes(TOKEN));
  assert.equal(vistas[0].body.access_token, TOKEN);
  assert.equal(vistas[0].body.data[0].event_id, SESION);
  assert.equal(vistas[0].body.test_event_code, undefined);
  assert.equal(vistas[1].body.test_event_code, "TEST12345");
});

test("Meta responde error o la red truena: 'error', nunca lanza y el log no trae el token", async () => {
  const ev = [construirEventoCapi({ eventName: "Purchase", eventId: SESION, eventTime: 1 })];
  const a = await capturarConsola(() =>
    enviarEventosCapi(ev, { token: TOKEN }, async () => ({ ok: false, status: 400, text: async () => `{"error":{"message":"Invalid token ${TOKEN}"}}` })),
  );
  assert.equal(a.r, "error");
  assert.match(a.log, /400/);
  assert.ok(!a.log.includes(TOKEN));
  const b = await capturarConsola(() =>
    enviarEventosCapi(ev, { token: TOKEN }, async () => { throw new Error(`fallo con ${TOKEN}`); }),
  );
  assert.equal(b.r, "error");
  assert.ok(!b.log.includes(TOKEN));
});

// ── 4. CompleteRegistration ─────────────────────────────────────────────────

test("señales de la petición: IP del primer x-forwarded-for, UA, fbp de _fbp y fbc de dc_meta (respaldo _fbc)", () => {
  const req = cabeceras({ "x-forwarded-for": "201.1.2.3, 10.0.0.1", "user-agent": UA });
  // La cookie del clic vale 90 días: el fbc de prueba tiene que ser reciente.
  const fbcReciente = `fb.1.${Date.now() - 86_400_000}.IwAR0abcdefghijKLMNOP`;
  const cookies: Record<string, string> = { _fbp: FBP, _fbc: fbcReciente };
  const s = senalesDePeticion(req, (n) => cookies[n]);
  assert.equal(s.ip, "201.1.2.3");
  assert.equal(s.userAgent, UA);
  assert.equal(s.fbp, FBP);
  assert.equal(s.fbc, fbcReciente);
  const sin = senalesDePeticion(cabeceras({}), () => undefined);
  assert.equal(sin.ip, null);
  assert.equal(sin.fbp, null);
  assert.equal(sin.fbc, null);
});

test("CompleteRegistration: event_id alta.<clinicId> (el mismo que vuelve al navegador)", async () => {
  const { p, enviados } = puertosFalsos();
  const r = await enviarRegistroMeta(
    { clinicId: CLINICA, email: "a@b.mx", phone: "5512345678", senales: { ip: "1.2.3.4", userAgent: UA, fbp: FBP, fbc: FBC } },
    p,
  );
  assert.equal(r, "enviado");
  const e = enviados[0][0];
  assert.equal(e.event_name, "CompleteRegistration");
  assert.equal(e.event_id, eventIdRegistro(CLINICA));
  assert.equal(e.event_id, `alta.${CLINICA}`);
  assert.equal(e.event_time, 1_759_300_123);
  assert.equal(e.event_source_url, "https://www.dalecontrol.com/signup");
  assert.equal(e.user_data.fbc, FBC);
});

// ── 5. Purchase desde el webhook ────────────────────────────────────────────

function sesion(over: Partial<SesionCompraMeta> = {}, meta: Record<string, string> = {}): SesionCompraMeta {
  return {
    id: SESION,
    payment_status: "paid",
    // $19 de la promo con IVA dentro: 1638 + 262 de IVA. El cupón ya está en amount_total.
    amount_total: 1900,
    total_details: { amount_tax: 262 },
    currency: "mxn",
    metadata: { clinicId: CLINICA, kind: "platform-subscription", firstContract: "1", plan: "PRO", ...meta },
    ...over,
  };
}

test("Purchase: solo primera contratación de la plataforma, pagada y con sesión cs_", () => {
  assert.equal(esCompraMeta(sesion()), true);
  assert.equal(esCompraMeta(sesion({}, { firstContract: "0" })), false);
  assert.equal(esCompraMeta(sesion({}, { kind: "module-subscription" })), false);
  assert.equal(esCompraMeta(sesion({ payment_status: "unpaid" })), false);
  assert.equal(esCompraMeta(sesion({ metadata: null })), false);
});

test("Purchase del webhook: event_id = cs_…, value SIN IVA con cupón, MXN, señales de la metadata del checkout", async () => {
  const { p, enviados } = puertosFalsos({ clickMetaGuardado: async () => { throw new Error("no debería leer la base"); } });
  const r = await enviarCompraMetaDeSesion(
    sesion({}, { meta_ip: "201.1.2.3", meta_ua: UA, meta_fbp: FBP, meta_fbc: FBC }),
    p,
  );
  assert.equal(r, "enviado");
  const e = enviados[0][0];
  assert.equal(e.event_name, "Purchase");
  assert.equal(e.event_id, SESION);
  assert.deepEqual(e.custom_data, { value: 16.38, currency: "MXN" });
  assert.equal(e.action_source, "website");
  assert.equal(e.user_data.client_ip_address, "201.1.2.3");
  assert.equal(e.user_data.fbp, FBP);
  assert.equal(e.user_data.fbc, FBC);
  assert.deepEqual(e.user_data.em, [sha256("dra.ana@clinica.mx")]);
  assert.deepEqual(e.user_data.ph, [sha256("525512345678")]);
});

test("Purchase sin señales en la metadata (sesión vieja): fbc/fbp del alta guardada, system_generated", async () => {
  const { p, enviados } = puertosFalsos();
  assert.equal(await enviarCompraMetaDeSesion(sesion(), p), "enviado");
  const e = enviados[0][0];
  assert.equal(e.action_source, "system_generated");
  assert.equal(e.user_data.fbc, FBC);
  assert.equal(e.user_data.fbp, FBP);
});

test("Purchase: renovación → no-aplica sin red; base caída → igual sale con lo que haya; nunca lanza", async () => {
  const { p, enviados } = puertosFalsos();
  assert.equal(await enviarCompraMetaDeSesion(sesion({}, { firstContract: "0" }), p), "no-aplica");
  assert.equal(enviados.length, 0);
  const caida = puertosFalsos({
    contactoClinica: async () => { throw new Error("db"); },
    clickMetaGuardado: async () => { throw new Error("db"); },
  });
  assert.equal(await enviarCompraMetaDeSesion(sesion({ customer_details: { email: "pago@x.mx" } }), caida.p), "enviado");
  assert.deepEqual(caida.enviados[0][0].user_data.em, [sha256("pago@x.mx")]);
  const rota = puertosFalsos({ enviar: async () => { throw new Error("red"); } });
  assert.equal(await enviarCompraMetaDeSesion(sesion(), rota.p), "error");
});

test("metadata del checkout: solo las señales que existen, recortadas a 500", () => {
  const largo = "x".repeat(800);
  const m = metadataMetaDePeticion(cabeceras({ "x-forwarded-for": "201.1.2.3", "user-agent": largo }), (n) => (n === "_fbp" ? FBP : undefined));
  assert.deepEqual(Object.keys(m).sort(), ["meta_fbp", "meta_ip", "meta_ua"]);
  assert.equal(m.meta_ua.length, 500);
  assert.deepEqual(metadataMetaDePeticion(cabeceras({}), () => undefined), {});
});

// ── 6. SPEI directo ─────────────────────────────────────────────────────────

function puertosSpei(clinica: { stripeSubscriptionId: string | null; subscriptionId: string | null; nextBillingDate: Date | null } | null, status = "pending") {
  const base = puertosFalsos();
  const p: PuertosSpei = {
    ...base.p,
    leerSolicitud: async () => ({ clinicId: CLINICA, subtotalCents: 41900, status, clinica }),
    senalesDeSolicitud: async () => ({ ip: "201.9.9.9", userAgent: UA }),
  };
  return { p, enviados: base.enviados };
}

test("SPEI directo, primera contratación: Purchase spei.<id>, value = subtotal sin IVA, señales de la bitácora", async () => {
  const { p, enviados } = puertosSpei({ stripeSubscriptionId: null, subscriptionId: null, nextBillingDate: null });
  const previa = await prepararCompraMetaSpei("sol_1", p);
  assert.deepEqual(previa, { solicitudId: "sol_1", clinicId: CLINICA, subtotalCents: 41900, primeraContratacion: true });
  assert.equal(await enviarCompraMetaSpei(previa, p), "enviado");
  const e = enviados[0][0];
  assert.equal(e.event_id, "spei.sol_1");
  assert.deepEqual(e.custom_data, { value: 419, currency: "MXN" });
  assert.equal(e.user_data.client_ip_address, "201.9.9.9");
  assert.equal(e.user_data.fbc, FBC);
});

test("SPEI directo de renovación o ya resuelta → no se manda nada", async () => {
  const renov = puertosSpei({ stripeSubscriptionId: null, subscriptionId: null, nextBillingDate: new Date() });
  assert.equal(await enviarCompraMetaSpei(await prepararCompraMetaSpei("sol_1", renov.p), renov.p), "no-aplica");
  const resuelta = puertosSpei({ stripeSubscriptionId: null, subscriptionId: null, nextBillingDate: null }, "confirmed");
  assert.equal(await prepararCompraMetaSpei("sol_1", resuelta.p), null);
  assert.equal(await enviarCompraMetaSpei(null, resuelta.p), "no-aplica");
  assert.equal(renov.enviados.length + resuelta.enviados.length, 0);
});

// ── 7. Navegador ────────────────────────────────────────────────────────────

function ventanaFalsa(conFbq: boolean) {
  const llamadas: unknown[][] = [];
  const storage = new Map<string, string>();
  const scripts: string[] = [];
  const w: any = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
    },
  };
  if (conFbq) w.fbq = (...a: unknown[]) => { llamadas.push(a); };
  (globalThis as any).window = w;
  (globalThis as any).document = {
    createElement: () => ({}),
    head: { appendChild: (s: { src: string }) => { scripts.push(s.src); } },
  };
  return { w, llamadas, storage, scripts };
}

function limpiarVentana() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
}

test("CompleteRegistration del píxel con eventID; sin fbq o sin id no hace nada", () => {
  const { llamadas } = ventanaFalsa(true);
  assert.equal(trackMetaCompleteRegistration(`alta.${CLINICA}`), true);
  assert.deepEqual(llamadas[0], ["track", "CompleteRegistration", {}, { eventID: `alta.${CLINICA}` }]);
  assert.equal(trackMetaCompleteRegistration(undefined), false);
  ventanaFalsa(false);
  assert.equal(trackMetaCompleteRegistration("alta.x"), false);
  limpiarVentana();
});

test("Purchase del píxel en la página de éxito: arranca el píxel (autoConfig apagado), eventID = cs_… y UNA sola vez", () => {
  const { w, scripts, storage } = ventanaFalsa(false);
  const compra = { transactionId: SESION, valueMxn: 16.38, currency: "MXN" };
  assert.equal(medirCompraMeta(compra), "enviada");
  assert.deepEqual(scripts, ["https://connect.facebook.net/en_US/fbevents.js"]);
  const cola = w.fbq.queue as unknown[][];
  assert.deepEqual(cola[0], ["set", "autoConfig", false, META_PIXEL_ID]);
  assert.deepEqual(cola[1], ["init", META_PIXEL_ID]);
  assert.deepEqual(cola[2], ["track", "Purchase", { value: 16.38, currency: "MXN" }, { eventID: SESION }]);
  assert.ok(storage.get(claveMarcaMeta(SESION)));
  assert.equal(medirCompraMeta(compra), "ya-enviada");
  assert.equal(cola.length, 3);
  limpiarVentana();
});

test("Purchase con el píxel ya cargado: no se vuelve a cargar ni a hacer init", () => {
  const { llamadas, scripts } = ventanaFalsa(true);
  assert.equal(medirCompraMeta({ transactionId: SESION, valueMxn: 419, currency: "mxn" }), "enviada");
  assert.deepEqual(scripts, []);
  assert.deepEqual(llamadas, [["track", "Purchase", { value: 419, currency: "MXN" }, { eventID: SESION }]]);
  limpiarVentana();
});

// ── 8. Cableado ─────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");

test("cableado: alta (2 rutas), checkout, webhook (tarjeta y SPEI/OXXO), SPEI directo, página de éxito y signup", () => {
  for (const r of ["src/app/api/auth/register/route.ts", "src/app/api/auth/register-oauth/route.ts"]) {
    const s = leer(r);
    assert.match(s, /enviarRegistroMetaEnSegundoPlano\(/, r);
    assert.match(s, /metaEventId/, r);
    // Después de crear la clínica y del guardado del clic de Ads.
    assert.ok(s.indexOf("enviarRegistroMetaEnSegundoPlano(") > s.indexOf("await guardarClickAdsDeLaAlta("), r);
  }
  const checkout = leer("src/app/api/billing/checkout/route.ts");
  assert.equal((checkout.match(/metadata: sessionMeta,/g) ?? []).length, 2);
  assert.match(checkout, /subscription_data: \{ metadata: meta \}/);
  assert.match(checkout, /payment_intent_data: \{ metadata: meta \}/);
  const webhook = leer("src/app/api/webhooks/stripe/route.ts");
  assert.equal((webhook.match(/await enviarCompraMetaDeSesion\(session\);/g) ?? []).length, 2);
  const spei = leer("src/app/api/admin/spei-transferencias/[id]/confirmar/route.ts");
  assert.ok(spei.indexOf("prepararCompraMetaSpei(") < spei.indexOf("confirmarSolicitudSpei(params.id"));
  assert.match(spei, /enviarCompraMetaSpei\(/);
  const pagina = leer("src/app/dashboard/suspended/success/page.tsx");
  assert.match(pagina, /<ConversionPagoCompletadoMeta \{\.\.\.conversion\} \/>/);
  const signup = leer("src/components/public/auth/signup/signup-form.tsx");
  assert.match(signup, /trackMetaCompleteRegistration\(data\.metaEventId\)/);
  assert.ok(signup.indexOf("trackMetaCompleteRegistration(") < signup.indexOf('trackSignupConversionAndRedirect("/dashboard/suspended")'));
});

test("ningún token en el código: solo se lee de process.env.META_CAPI_TOKEN", () => {
  const server = leer("src/lib/analytics/meta-capi.server.ts");
  assert.match(server, /process\.env\.META_CAPI_TOKEN/);
  assert.match(server, /process\.env\.META_CAPI_TEST_EVENT_CODE/);
  for (const r of ["src/lib/analytics/meta-capi.ts", "src/lib/analytics/meta-capi.server.ts", "src/lib/analytics/meta-pixel-eventos.ts"]) {
    assert.doesNotMatch(leer(r), /EAA[A-Za-z0-9]{20,}/, r); // forma de un token de Meta
  }
});
