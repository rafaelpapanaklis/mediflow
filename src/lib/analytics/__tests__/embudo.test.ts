/**
 * Embudo de captación (ws1-t9). Run: npm run test:embudo
 * `window`, gtag y storage simulados: ni red ni base.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registrarPaso, agregarDestinoPaso, extraerPrimeraVisita, capturarPrimeraVisita,
  leerPrimeraVisita, parametrosGa4, PASOS_EMBUDO, CLAVE_PRIMERA_VISITA,
} from "../embudo";
import { GA4_MEASUREMENT_ID } from "../ga4";

class Store {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
let llamadas: unknown[][] = [];
function navegador(pathname: string, search = "") {
  llamadas = [];
  (globalThis as any).window = {
    location: { pathname, search, origin: "https://dalecontrol.com" },
    localStorage: new Store(),
    sessionStorage: new Store(),
    gtag: (...a: unknown[]) => llamadas.push(a),
  };
}
beforeEach(() => navegador("/", ""));

test("nombres estables y en orden", () => {
  assert.deepEqual([...PASOS_EMBUDO], [
    "landing_vista", "clic_empezar", "registro_vista", "registro_enviado",
    "registro_ok", "onboarding_completo", "checkout_iniciado", "pago_ok",
  ]);
});

test("extrae solo utm_source/utm_campaign/gclid/fbclid, limpios", () => {
  assert.deepEqual(
    extraerPrimeraVisita("?utm_source=meta&utm_medium=cpc&utm_campaign=oct%0A&gclid=abc&x=1&fbclid=fb1"),
    { utm_source: "meta", utm_campaign: "oct", gclid: "abc", fbclid: "fb1" },
  );
});

test("la primera visita se guarda una vez y no se pisa", () => {
  navegador("/", "?utm_source=google&gclid=g1");
  capturarPrimeraVisita();
  navegador("/", "");
  const w = (globalThis as any).window;
  w.localStorage.setItem(CLAVE_PRIMERA_VISITA, JSON.stringify({ utm_source: "google", gclid: "g1" }));
  w.location.search = "?utm_source=meta&fbclid=zz";
  assert.deepEqual(capturarPrimeraVisita(), { utm_source: "google", gclid: "g1" });
  assert.deepEqual(leerPrimeraVisita(), { utm_source: "google", gclid: "g1" });
});

test("registro_ok y pago_ok llevan la primera visita; clic_empezar no", () => {
  navegador("/signup", "?utm_source=google&utm_campaign=oct&gclid=g1");
  registrarPaso("clic_empezar", { origen: "hero" });
  registrarPaso("registro_ok", { id: "clin1" });
  registrarPaso("pago_ok", { id: "cs_1", valueMxn: 799, currency: "mxn" });
  const [clic, reg, pago] = llamadas.map((l) => ({ nombre: l[1], p: l[2] as Record<string, unknown> }));
  assert.equal(clic.nombre, "clic_empezar");
  assert.equal(clic.p.origen, "hero");
  assert.equal(clic.p.utm_source, undefined);
  assert.equal(reg.p.utm_source, "google");
  assert.equal(reg.p.gclid, "g1");
  assert.equal(pago.p.utm_campaign, "oct");
  assert.equal(pago.p.value, 799);
  assert.equal(pago.p.currency, "MXN");
  assert.equal(pago.p.transaction_id, "cs_1");
  for (const l of llamadas) assert.equal((l[2] as any).send_to, GA4_MEASUREMENT_ID);
});

test("cada paso sale UNA vez: por sesión y por id", () => {
  assert.equal(registrarPaso("landing_vista"), "enviado");
  assert.equal(registrarPaso("landing_vista"), "ya-enviado");
  assert.equal(registrarPaso("registro_ok", { id: "a" }), "enviado");
  assert.equal(registrarPaso("registro_ok", { id: "a" }), "ya-enviado");
  assert.equal(registrarPaso("registro_ok", { id: "b" }), "enviado");
  assert.equal(registrarPaso("pago_ok", { id: "cs_9", valueMxn: 1 }), "enviado");
  assert.equal(registrarPaso("pago_ok", { id: "cs_9", valueMxn: 1 }), "ya-enviado");
  assert.equal(llamadas.length, 4);
});

test("rutas privadas: nada sale", () => {
  for (const p of ["/dashboard", "/admin/clinics", "/paciente/citas", "/portal/x", "/onboarding"]) {
    navegador(p, "?utm_source=x");
    assert.equal(registrarPaso("clic_empezar"), "privada", p);
    assert.equal(llamadas.length, 0, p);
    assert.equal((globalThis as any).window.localStorage.getItem(CLAVE_PRIMERA_VISITA), null, p);
  }
});

test("whatsapp_clic con origen avisa a los destinos extra; uno roto no tumba", () => {
  const vistos: string[] = [];
  const quita1 = agregarDestinoPaso(() => { throw new Error("roto"); });
  const quita2 = agregarDestinoPaso((paso, d) => vistos.push(`${paso}:${d.origen}`));
  registrarPaso("whatsapp_clic", { origen: "barra_movil" });
  quita1(); quita2();
  assert.deepEqual(vistos, ["whatsapp_clic:barra_movil"]);
  assert.equal(llamadas[0][1], "whatsapp_clic");
});

test("sin gtag (bloqueador) no lanza y los destinos extra igual avisan", () => {
  navegador("/", "");
  delete (globalThis as any).window.gtag;
  assert.equal(registrarPaso("landing_vista"), "enviado");
});

test("sin datos personales en los parámetros", () => {
  const p = parametrosGa4("registro_ok", { id: "c1", origen: "hero", plan: "PRO" }, { utm_source: "a" });
  assert.deepEqual(Object.keys(p).sort(), ["origen", "plan", "send_to", "utm_source"]);
});
