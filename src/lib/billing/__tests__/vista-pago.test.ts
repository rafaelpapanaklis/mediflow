/**
 * LO QUE LA PANTALLA DICE del pago, del registro y de la suscripción (ajuste 2 de la integración).
 *
 * Run: npm run test:vista-pago
 *
 * Núcleo puro (`metodos-de-pago`, `prueba-vista`, `miles`) y candados de cableado (leyendo el código, como
 * `cuenta-rediseno.test.ts`): que cada texto diga lo que de verdad se cobra y que no mande a un método
 * que no existe.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoTarjetaOxxoNoDisponible, frasePagoSeguro, subtituloDePago, CORREO_SOPORTE } from "../metodos-de-pago";
import { DIAS_PRUEBA_SIN_VENCIMIENTO, miles, pruebaVista } from "../prueba-vista";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ── (#1) el aviso ofrece solo lo que existe ───────────────────────────── */

test("tarjeta/OXXO disponibles → no hay aviso", () => {
  assert.equal(avisoTarjetaOxxoNoDisponible({ tarjetaOxxo: true, spei: true }), null);
  assert.equal(avisoTarjetaOxxoNoDisponible({ tarjetaOxxo: true, spei: false }), null);
});

test("tarjeta/OXXO no disponibles + SPEI configurado → manda a SPEI o a soporte", () => {
  const a = avisoTarjetaOxxoNoDisponible({ tarjetaOxxo: false, spei: true })!;
  assert.match(a.texto, /transferencia SPEI/);
  assert.ok(a.texto.includes(CORREO_SOPORTE));
});

test("tarjeta/OXXO no disponibles + SPEI SIN configurar → NO nombra SPEI: solo soporte, con mensaje claro", () => {
  const a = avisoTarjetaOxxoNoDisponible({ tarjetaOxxo: false, spei: false })!;
  assert.doesNotMatch(a.texto, /SPEI|transferencia/i);
  assert.match(a.texto, /ningún método de pago disponible/);
  assert.ok(a.texto.includes(CORREO_SOPORTE));
});

test("la cabecera dice solo lo que existe, con SPEI como transferencia DIRECTA (no «en la página de Stripe»)", () => {
  assert.equal(frasePagoSeguro({ tarjetaOxxo: true, spei: true }), "Tarjeta u OXXO con Stripe, o transferencia SPEI directa.");
  assert.equal(frasePagoSeguro({ tarjetaOxxo: true, spei: false }), "Tarjeta u OXXO con Stripe.");
  assert.equal(frasePagoSeguro({ tarjetaOxxo: false, spei: true }), "Transferencia SPEI directa.");
  assert.equal(frasePagoSeguro({ tarjetaOxxo: false, spei: false }), "");
  assert.match(subtituloDePago({ tarjetaOxxo: true, spei: true }), /Pago seguro: tarjeta u OXXO con Stripe, o transferencia SPEI directa\./);
  assert.match(subtituloDePago({ tarjetaOxxo: false, spei: false }), /soporte@dalecontrol\.com/);
});

test("la pantalla de pago usa el helper: sin el texto fijo que mandaba a SPEI y con el botón atado a lo disponible", () => {
  const v = sinComentarios(leer("src/components/dashboard/cuenta-rediseno/planes-suspendida.tsx"));
  assert.match(v, /avisoTarjetaOxxoNoDisponible\(\{ tarjetaOxxo: tarjetaOxxoOk, spei: v\.cuentaSpei !== null \}\)/);
  assert.doesNotMatch(v, /Puedes pagar por transferencia SPEI/);
  assert.match(v, /disabled=\{v\.isRedirecting \|\| !tarjetaOxxoOk\}/);
  const p = sinComentarios(leer("src/app/dashboard/suspended/page.tsx"));
  assert.match(p, /subtituloDePago\(\{ tarjetaOxxo: cobroConIvaListo \|\| exencionIva !== null, spei: cuentaSpei !== null \}\)/);
});

test("ningún texto manda a «SPEI de abajo» ni a SPEI en el mensaje de IVA no configurado", () => {
  assert.doesNotMatch(leer("src/lib/billing/iva-cobro.ts").match(/MENSAJE_IVA_NO_CONFIGURADO =\s*"[^"]*"/)![0], /SPEI/);
  for (const f of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${f}.json`));
    assert.doesNotMatch(d.pages.suspended.paymentsUnavailable, /SPEI/);
  }
});

/* ── (#2) OXXO + anual ────────────────────────────────────────────────── */

test("OXXO anual dice «Pago único del año»; mensual, «de 1 mes» (las dos pantallas y los dos idiomas)", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).pages.suspended;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).pages.suspended;
  assert.equal(es.asyncMethodNote, "Pago único de 1 mes; no se renueva solo.");
  assert.equal(es.asyncMethodNoteAnnual, "Pago único del año; no se renueva solo.");
  assert.match(en.asyncMethodNoteAnnual, /for the year/);
  for (const f of ["src/components/dashboard/cuenta-rediseno/planes-suspendida.tsx", "src/app/dashboard/suspended/suspended-client.tsx"]) {
    assert.match(sinComentarios(leer(f)), /asyncMethodNoteAnnual/, f);
  }
});

/* ── (#3) textos del registro ─────────────────────────────────────────── */

test("registro (panel izquierdo y paso 3): sin «SPEI u OXXO en la página segura de Stripe»", () => {
  for (const f of ["src/components/public/auth/signup/signup-visual.tsx", "src/components/public/auth/signup/step-3-plan-payment.tsx", "src/app/dashboard/suspended/page.tsx"]) {
    const t = leer(f);
    assert.doesNotMatch(t, /con tarjeta, SPEI u OXXO|Tarjeta, SPEI u OXXO|página segura de Stripe/, f);
  }
  assert.match(leer("src/components/public/auth/signup/signup-visual.tsx"), /Tarjeta u OXXO con Stripe, o transferencia SPEI directa\./);
  assert.match(leer("src/components/public/auth/signup/step-3-plan-payment.tsx"), /tarjeta u OXXO con\s+Stripe, o transferencia SPEI directa\./);
});

/* ── (#8) portada ─────────────────────────────────────────────────────── */

test("«Incluido en todos»: sin la frase «Las tarjetas muestran solo lo que cambia»", () => {
  assert.doesNotMatch(leer("src/components/public/landing/sales/v2/pricing-section.tsx"), /muestran solo lo que cambia/);
});

/* ── (#11) Select del paso 2 ──────────────────────────────────────────── */

test("el Select del paso 2 es SIEMPRE controlado (sin `value || undefined`)", () => {
  const t = sinComentarios(leer("src/components/public/auth/signup/step-2-clinic.tsx"));
  assert.doesNotMatch(t, /value=\{value \|\| undefined\}/);
  assert.match(t, /<Select\.Root value=\{value \|\| ""\}/);
});

/* ── (#12) registro en 390 ────────────────────────────────────────────── */

test("registro móvil: la columna del formulario aprieta su padding vertical (paso 1 sin scroll en 390×844)", () => {
  const css = leer("src/components/public/auth/auth-v4.css");
  const bloque = css.slice(css.lastIndexOf("@media (max-width: 480px)"));
  assert.match(bloque, /\.dca-form \{ padding: 8px 16px 10px; \}/);
});

/* ── (#5) Facturas en 390 ─────────────────────────────────────────────── */

test("Caja → Facturas: el segmentado tiene scroll PROPIO (no empuja la página) y sus botones no se encogen", () => {
  const t = sinComentarios(leer("src/app/dashboard/billing/billing-client.tsx"));
  assert.match(t, /className="segment-new"\s+style=\{\{ maxWidth: "100%", minWidth: 0, overflowX: "auto"/);
  assert.match(t, /style=\{\{ flexShrink: 0, whiteSpace: "nowrap" \}\}/);
});

/* ── (#7) Suscripción ─────────────────────────────────────────────────── */

test("miles: separador de miles es-MX, sin decimales", () => {
  assert.equal(miles(1719), "1,719");
  assert.equal(miles(13404), "13,404");
  assert.equal(miles(419), "419");
  assert.equal(miles(1300), "1,300");
});

test("prueba normal (≤ 14 días): como siempre, con «de 14» y barra", () => {
  assert.deepEqual(pruebaVista(9, 14), { tipo: "normal", barra: true, fecha: true });
  assert.equal(pruebaVista(0, 14).tipo, "hoy");
  assert.equal(pruebaVista(1, 14).tipo, "uno");
  assert.equal(pruebaVista(14, 14).tipo, "normal");
});

test("prueba prorrogada (15–365 días): «N días restantes» sin «de 14» ni barra, con su fecha", () => {
  assert.deepEqual(pruebaVista(30, 14), { tipo: "prorrogada", barra: false, fecha: true });
  assert.equal(pruebaVista(DIAS_PRUEBA_SIN_VENCIMIENTO, 14).tipo, "prorrogada");
});

test("prueba de años (la de «3633 días restantes de 14» y el 6-sep-2036): sin cifra, sin fecha y sin barra", () => {
  assert.deepEqual(pruebaVista(3633, 14), { tipo: "sinVencimiento", barra: false, fecha: false });
  assert.equal(pruebaVista(DIAS_PRUEBA_SIN_VENCIMIENTO + 1, 14).tipo, "sinVencimiento");
  assert.equal(pruebaVista(-5, 14).tipo, "hoy", "negativos no rompen");
});

test("Suscripción (las dos vistas): precios con miles, «+ IVA» por la regla de exención, prueba por pruebaVista", () => {
  for (const f of ["src/components/dashboard/subscription-tab.tsx", "src/components/dashboard/bloques-rediseno/suscripcion.tsx"]) {
    const t = sinComentarios(leer(f));
    assert.doesNotMatch(t, /\{ delta: (planPrice|precio)/, `${f}: los deltas van con miles`);
    assert.match(t, /miles\(/, f);
  }
  const tab = sinComentarios(leer("src/components/dashboard/subscription-tab.tsx"));
  assert.match(tab, /exencionDeIva\(\{ createdAt: clinic\.createdAt, plan: clinic\.plan, tuvoTarjeta: false \}\)/);
  assert.match(tab, /ivaAplica\(\{ metodo: "spei", plan: id, exencion: exencionIva \}\) \? " \+ IVA" : ""/);
  const red = sinComentarios(leer("src/components/dashboard/bloques-rediseno/suscripcion.tsx"));
  assert.match(red, /m\.ivaDe\(plan\.id\)/);
  assert.match(red, /m\.pruebaVista\.tipo === "sinVencimiento"/);
  for (const f of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${f}.json`)).shell.subscriptionTab;
    assert.ok(d.daysLeftOnly && d.trialNoNearEnd, f);
  }
});

/* ── (#4) promo del primer mes: total exacto, sin «+ IVA» encima ───────── */

test("pantalla de pago: la promo se desglosa con el IVA DENTRO (total = promo) y «luego» lleva «+ IVA»", () => {
  const v = sinComentarios(leer("src/components/dashboard/cuenta-rediseno/planes-suspendida.tsx"));
  assert.match(v, /v\.ctaPromo \? desglosePromoConIvaIncluido\(centavosBase\) : desgloseConIva\(centavosBase\)/);
  assert.match(v, /const cobroMostrado = ivaSel \? cobroNuevo : desgloseSinIva\(centavosBase\)/);
  // «Tu primer mes: solo $29 con tarjeta · luego $689/mes + IVA»: la promo sin «+ IVA», la renovación con él.
  assert.match(v, /luego \$\{fmt\(plan\.priceMxn\)\}\/mes` \+ ivaPlan\(plan\.id\)/);
  assert.doesNotMatch(v, /solo \$\{fmt\(FIRST_MONTH_PROMO_MXN\[plan\.id\]\)\} con tarjeta[^`]*IVA/);
});

test("portada: la promo del primer mes sale de plan_configs/FIRST_MONTH_PROMO_MXN y NO lleva «+ IVA»", () => {
  for (const f of ["src/components/public/landing/sales/v2/pricing-section.tsx", "src/components/public/landing/sales/v2/hero.tsx"]) {
    const t = sinComentarios(leer(f));
    assert.doesNotMatch(t, /primer mes[^\n]*\+ IVA/i, f);
  }
});
