/**
 * GA4 `sign_up` y `purchase` junto a las conversiones de Google Ads (WS1-T6).
 *
 * Run: npx tsx --test src/app/dashboard/suspended/success/__tests__/medicion-pago.test.ts
 * (sin script en package.json: añadirlo queda fuera del alcance de la tarea).
 *
 * Fija, sin navegador ni Stripe, con un `window` simulado:
 *   1. sign_up: UNA vez, method email (google en OAuth), send_to GA4, y la
 *      conversión de registro de Ads intacta y con su callback/redirección.
 *   2. purchase: UNA vez, con el MISMO value y transaction_id que «Pago
 *      completado», junto a ella; al recargar (marca local) ninguno de los dos.
 *   3. /dashboard/suspended/success manda el purchase SIN `config` de GA4 (un
 *      config vive toda la pestaña y activaría la medición mejorada en el panel:
 *      page_view por navegación, clics a wa.me/<teléfono>…), y sin session_id
 *      en page_location.
 *   4. Cableado: signup-form, layout y page.tsx.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidirConversionPago, type SesionCheckoutMinima } from "../conversion-pago";
import { medirPagoCompletado } from "../medicion-pago";
import { trackSignupConversionAndRedirect } from "@/lib/gtag";
import { GA4_MEASUREMENT_ID, ga4PurchaseParams, trackGa4Purchase, trackGa4SignUp } from "@/lib/analytics/ga4";

const SESSION_ID = "cs_test_a1B2c3D4e5F6g7H8i9J0";
const CLINICA = "clinic_abc";
type Llamada = unknown[];

function sesion(over: Partial<SesionCheckoutMinima> = {}, meta: Record<string, string> = {}): SesionCheckoutMinima {
  return {
    id: SESSION_ID,
    payment_status: "paid",
    amount_total: 2204,
    total_details: { amount_tax: 304 },
    currency: "mxn",
    metadata: { clinicId: CLINICA, kind: "platform-subscription", firstContract: "1", plan: "PRO", billing: "monthly", ...meta },
    ...over,
  };
}

/** window simulado con gtag que graba llamadas y un localStorage en memoria. */
function conVentana(
  opciones: { pathname?: string; gtag?: boolean; storage?: "ok" | "lanza"; search?: string },
  fn: (ctx: { llamadas: Llamada[]; store: Map<string, string>; win: Record<string, unknown> }) => void,
) {
  const llamadas: Llamada[] = [];
  const store = new Map<string, string>();
  const win: Record<string, unknown> = {
    location: {
      origin: "https://www.dalecontrol.com",
      pathname: opciones.pathname ?? "/dashboard/suspended/success",
      search: opciones.search ?? `?session_id=${SESSION_ID}`,
      href: "",
    },
    localStorage:
      opciones.storage === "lanza"
        ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }
        : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    // Los temporizadores no corren: el tope de 800 ms del registro no debe
    // disparar después de que el test devolvió `window`.
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  if (opciones.gtag !== false) win.gtag = (...a: unknown[]) => llamadas.push(a);
  const g = globalThis as unknown as { window?: unknown };
  const antes = g.window;
  g.window = win;
  const info = console.info;
  console.info = () => {};
  try { fn({ llamadas, store, win }); } finally { g.window = antes; console.info = info; }
}

const eventos = (llamadas: Llamada[], nombre: string) => llamadas.filter((l) => l[0] === "event" && l[1] === nombre);

// ── sign_up ──────────────────────────────────────────────────────────────────

test("sign_up: UN evento a GA4 con method email y send_to acotado", () => {
  conVentana({ pathname: "/signup", search: "" }, ({ llamadas }) => {
    assert.equal(trackGa4SignUp(), true);
    assert.deepEqual(llamadas, [["event", "sign_up", { send_to: GA4_MEASUREMENT_ID, method: "email" }]]);
  });
});

test("sign_up sin gtag (bloqueador): false y sin error", () => {
  conVentana({ pathname: "/signup", gtag: false }, () => {
    assert.equal(trackGa4SignUp(), false);
  });
});

test("registro: sale sign_up ANTES de la conversión de Ads, cada uno una vez, y la conversión sigue igual", () => {
  conVentana({ pathname: "/signup", search: "" }, ({ llamadas, win }) => {
    // Lo mismo que hace signup-form.tsx, en ese orden.
    trackGa4SignUp("email");
    trackSignupConversionAndRedirect("/dashboard/suspended");
    assert.equal(llamadas.length, 2);
    assert.deepEqual(llamadas[0], ["event", "sign_up", { send_to: GA4_MEASUREMENT_ID, method: "email" }]);
    const conversion = llamadas[1] as [string, string, Record<string, unknown>];
    assert.equal(conversion[1], "conversion");
    assert.equal(conversion[2].send_to, "AW-18276007996/YXdlCM-xtMccELyA14pE");
    assert.equal(conversion[2].value, 1.0);
    assert.equal(conversion[2].currency, "MXN");
    assert.equal(typeof conversion[2].event_callback, "function");
    // La redirección sigue colgando del callback de Ads: al llegar, navega a la misma URL.
    (conversion[2].event_callback as () => void)();
    assert.equal((win.location as { href: string }).href, "/dashboard/suspended");
  });
});

test("registro por OAuth (Google): method google", () => {
  conVentana({ pathname: "/signup", search: "" }, ({ llamadas }) => {
    trackGa4SignUp("google");
    assert.equal((eventos(llamadas, "sign_up")[0][2] as { method: string }).method, "google");
  });
});

test("registro sin gtag: navega igual y no lanza", () => {
  conVentana({ pathname: "/signup", gtag: false }, ({ win }) => {
    trackGa4SignUp("email");
    trackSignupConversionAndRedirect("/dashboard/suspended");
    assert.equal((win.location as { href: string }).href, "/dashboard/suspended");
  });
});

// ── purchase ─────────────────────────────────────────────────────────────────

test("purchase: value/currency/transaction_id (+items del plan) con send_to GA4", () => {
  const p = ga4PurchaseParams({
    transactionId: SESSION_ID,
    valueMxn: 19,
    item: { id: "PRO", name: "DaleControl Profesional", variant: "monthly" },
  });
  assert.deepEqual(p, {
    send_to: GA4_MEASUREMENT_ID,
    transaction_id: SESSION_ID,
    value: 19,
    currency: "MXN",
    items: [{ item_id: "PRO", item_name: "DaleControl Profesional", item_variant: "monthly", price: 19, quantity: 1 }],
  });
  assert.equal("items" in ga4PurchaseParams({ transactionId: SESSION_ID, valueMxn: 19 }), false);
});

test("primer pago: UNA conversión de Ads y UN purchase con el MISMO value y transaction_id", () => {
  const conversion = decidirConversionPago({ clinicId: CLINICA, sessionId: SESSION_ID, activada: true, sesion: sesion() });
  assert.ok(conversion);
  assert.equal(conversion.valueMxn, 19, "sin IVA: 2204 − 304 = 1900 centavos");
  assert.deepEqual(conversion.plan, { id: "PRO", name: "DaleControl Profesional", billing: "monthly" });

  conVentana({}, ({ llamadas, store }) => {
    assert.equal(medirPagoCompletado(conversion), "enviada");
    const ads = eventos(llamadas, "conversion");
    const ga4 = eventos(llamadas, "purchase");
    assert.equal(ads.length, 1);
    assert.equal(ga4.length, 1);
    const a = ads[0][2] as Record<string, unknown>;
    const g = ga4[0][2] as Record<string, unknown>;
    assert.equal(a.send_to, "AW-18276007996/tujfCLaJlIUdELyA14pE");
    assert.equal(g.send_to, GA4_MEASUREMENT_ID);
    assert.equal(g.value, a.value);
    assert.equal(g.currency, a.currency);
    assert.equal(g.transaction_id, a.transaction_id);
    assert.equal(g.transaction_id, SESSION_ID);
    assert.equal(g.value, 19);
    assert.ok(store.has(`dc.gads.pago-completado.${SESSION_ID}`));
  });
});

test("al recargar (marca local) no sale ni la conversión ni el purchase", () => {
  const conversion = decidirConversionPago({ clinicId: CLINICA, sessionId: SESSION_ID, activada: true, sesion: sesion() })!;
  conVentana({}, ({ llamadas, store }) => {
    assert.equal(medirPagoCompletado(conversion), "enviada");
    const antes = llamadas.length;
    assert.equal(medirPagoCompletado(conversion), "ya-enviada");
    assert.equal(medirPagoCompletado(conversion), "ya-enviada");
    assert.equal(llamadas.length, antes);
    assert.equal(store.size, 1);
  });
});

test("gtag aún no existe: no envía, no marca, y al aparecer envía una sola vez", () => {
  const conversion = decidirConversionPago({ clinicId: CLINICA, sessionId: SESSION_ID, activada: true, sesion: sesion() })!;
  conVentana({ gtag: false }, ({ llamadas, store, win }) => {
    assert.equal(medirPagoCompletado(conversion), "sin-gtag");
    assert.equal(store.size, 0);
    win.gtag = (...a: unknown[]) => llamadas.push(a);
    assert.equal(medirPagoCompletado(conversion), "enviada");
    assert.equal(eventos(llamadas, "conversion").length, 1);
    assert.equal(eventos(llamadas, "purchase").length, 1);
  });
});

test("sin localStorage (Safari privado): envía igual y no lanza", () => {
  const conversion = decidirConversionPago({ clinicId: CLINICA, sessionId: SESSION_ID, activada: true, sesion: sesion() })!;
  conVentana({ storage: "lanza" }, ({ llamadas }) => {
    assert.equal(medirPagoCompletado(conversion), "enviada");
    assert.equal(eventos(llamadas, "purchase").length, 1);
  });
});

test("un plan desconocido en la metadata no viaja a GA4 (nada de texto libre)", () => {
  const c = decidirConversionPago({ clinicId: CLINICA, sessionId: SESSION_ID, activada: true, sesion: sesion({}, { plan: "<script>" }) })!;
  assert.equal(c.plan, undefined);
  const sinPlan = decidirConversionPago({ clinicId: CLINICA, sessionId: SESSION_ID, activada: true, sesion: sesion({}, { plan: "constructor" }) })!;
  assert.equal(sinPlan.plan, undefined);
  conVentana({}, ({ llamadas }) => {
    medirPagoCompletado(c);
    assert.equal("items" in (eventos(llamadas, "purchase")[0][2] as object), false);
  });
});

// ── GA4 en la pantalla privada, sin page_view ────────────────────────────────

test("en /dashboard/suspended/success: el purchase sale SIN config de GA4, sin page_view y sin session_id en page_location", () => {
  conVentana({}, ({ llamadas }) => {
    assert.equal(trackGa4Purchase({ transactionId: SESSION_ID, valueMxn: 19 }), true);
    assert.equal(llamadas.length, 1, "un solo gtag(): el purchase");
    assert.equal(llamadas.filter((l) => l[0] === "config").length, 0, "GA4 no se configura en el panel");
    assert.equal(llamadas[0][1], "purchase");
    const p = llamadas[0][2] as Record<string, unknown>;
    assert.equal(p.send_to, GA4_MEASUREMENT_ID);
    assert.equal(p.page_location, "https://www.dalecontrol.com/dashboard/suspended/success");
    assert.ok(!JSON.stringify(p).includes("session_id="), "el session_id de Stripe no viaja como URL");
    assert.equal(eventos(llamadas, "page_view").length, 0, "cero page_view del panel");
  });
});

test("disparar dos purchase distintos en la misma carga tampoco configura GA4", () => {
  conVentana({}, ({ llamadas }) => {
    trackGa4Purchase({ transactionId: SESSION_ID, valueMxn: 19 });
    trackGa4Purchase({ transactionId: "cs_test_otraSesion123456", valueMxn: 19 });
    assert.equal(llamadas.filter((l) => l[0] === "config").length, 0);
  });
});

test("en una ruta pública el purchase tampoco toca el config (lo hace solo el layout)", () => {
  conVentana({ pathname: "/pricing", search: "" }, ({ llamadas }) => {
    trackGa4Purchase({ transactionId: SESSION_ID, valueMxn: 19 });
    assert.equal(llamadas.filter((l) => l[0] === "config").length, 0);
  });
});

// ── Cableado ─────────────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("signup-form: sign_up justo antes de la conversión de registro, que se llama igual que siempre", () => {
  const form = leer("components/public/auth/signup/signup-form.tsx");
  assert.match(form, /trackGa4SignUp\(isOAuthFlow \? "google" : "email"\);\s*trackSignupConversionAndRedirect\("\/dashboard\/suspended"\);/);
  assert.equal((form.match(/trackGa4SignUp\(/g) ?? []).length, 1, "una sola vez");
  assert.equal((form.match(/trackSignupConversionAndRedirect\(/g) ?? []).length, 1);
  // gtag.ts (la conversión de registro) no se toca en WS1-T6: sin import de GA4.
  assert.ok(!leer("lib/gtag.ts").includes("analytics/ga4"));
});

test("layout: GA4 sigue sin configurarse en rutas privadas (el panel no se activa)", () => {
  const layout = leer("app/layout.tsx");
  assert.ok(layout.includes("if (!new RegExp(${JSON.stringify(PRIVATE_PATH_PATTERN)}).test(location.pathname)) {\n              gtag('config', ${JSON.stringify(GA4_MEASUREMENT_ID)}, { send_page_view: false });"));
});

test("ga4.ts no configura GA4 ni manda page_view: solo events sign_up y purchase", () => {
  const ga4 = leer("lib/analytics/ga4.ts");
  assert.equal((ga4.match(/gtag\("config"/g) ?? []).length, 0);
  assert.equal((ga4.match(/"page_view"/g) ?? []).length, 0);
  assert.equal((ga4.match(/gtag\("event", "(sign_up|purchase)"/g) ?? []).length, 2);
});

test("el componente cliente delega en medirPagoCompletado y reintenta solo mientras falta gtag", () => {
  const cliente = leer("app/dashboard/suspended/success/conversion-pago-cliente.tsx");
  assert.ok(cliente.startsWith('"use client";'));
  assert.match(cliente, /medirPagoCompletado\(/);
  assert.match(cliente, /if \(resultado !== "sin-gtag"\) return;/);
});
