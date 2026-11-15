/* ═══════════════════════════════════════════════════════════════════════
   RONDA 4 · punto 3 de «lo que un barbero no entendería» (revisora ws6-t3,
   ronda 6): al cerrar el turno se leía

       Efectivo (10)            $1,380.00
       Propinas en efectivo        $30.00
       Esperado en efectivo     $1,880.00

   y parecía que las propinas había que sumarlas, cuando ya van dentro de
   los $1,380. Solo PRESENTACIÓN: ningún número cambia. Ahora:

       Fondo inicial                       $500.00
     + Efectivo cobrado en el turno      $1,380.00
         Incluye $30.00 de propinas: ya van dentro, no se suman aparte.
     = Esperado en efectivo              $1,880.00

     npx tsx --tsconfig tsconfig.test.json \
       "src/components/barber/cash/__tests__/cierre-esperado.test.tsx"

   (Sin `--test` y con el tsconfig de pruebas: pinta JSX en node.)
   Sin base de datos y sin navegador: es un componente puro.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { closeExpectedView } from "../close-expected";
import { CloseExpectedBreakdown } from "../close-expected-breakdown";

/** El turno de la revisora: fondo $500, 10 tickets en efectivo por $1,380 (con $30 de propinas). */
const TURNO = {
  session: { openingAmount: 500 },
  byMethod: {
    CASH: { count: 10, subtotal: 1350, tip: 30, total: 1380 },
    CARD: { count: 2, subtotal: 360, tip: 20, total: 380 },
    SPEI: { count: 1, subtotal: 180, tip: 0, total: 180 },
    STRIPE: { count: 0, subtotal: 0, tip: 0, total: 0 },
  },
  cashTips: 30,
  expectedCash: 1880,
};

const cents = (n: number) => Math.round(n * 100);

function tOf(locale: "es" | "en") {
  const dict = (getBarberDict(locale) as unknown as { barber: { caja: Dictionary } }).barber.caja;
  return makeBarberT(dict);
}

function pintar(summary: typeof TURNO, locale: "es" | "en" = "es") {
  const html = renderToStaticMarkup(<CloseExpectedBreakdown view={closeExpectedView(summary)} t={tOf(locale)} />);
  const texto = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  /** Importe (última columna) de cada fila marcada con ese atributo. */
  const importes = (attr: string) =>
    Array.from(html.matchAll(new RegExp(`<div class="bcaja-totals__row[^"]*" ${attr}="([^"]+)">.*?<span>([^<]*)</span></div>`, "g"))).map((m) => ({
      key: m[1],
      amount: m[2],
    }));
  return { html, texto, importes };
}

test("los números son los del servidor: fondo + efectivo cobrado = esperado, y las propinas van DENTRO", () => {
  const v = closeExpectedView(TURNO);
  assert.equal(v.opening, 500);
  assert.equal(v.cashCharged, 1380);
  assert.equal(v.cashTickets, 10);
  assert.equal(v.cashTipsIncluded, 30);
  assert.equal(v.expected, 1880, "el esperado es el que mandó el servidor, tal cual");
  assert.equal(cents(v.opening) + cents(v.cashCharged), cents(v.expected), "500 + 1,380 = 1,880");
  assert.notEqual(cents(v.opening) + cents(v.cashCharged) + cents(v.cashTipsIncluded), cents(v.expected), "sumar las propinas otra vez NO da el esperado");
});

test("se lee en orden: fondo, + efectivo cobrado (incluye propinas), = esperado", () => {
  const { texto } = pintar(TURNO);
  const orden = [
    "Fondo inicial",
    "$500.00",
    "+",
    "Efectivo cobrado en el turno",
    "(10 tickets)",
    "$1,380.00",
    "Incluye $30.00 de propinas: ya van dentro, no se suman aparte.",
    "=",
    "Esperado en efectivo",
    "$1,880.00",
    "Fondo inicial + efectivo cobrado.",
  ];
  let desde = 0;
  for (const trozo of orden) {
    const i = texto.indexOf(trozo, desde);
    assert.ok(i >= 0, `falta «${trozo}» (o está fuera de orden) en: ${texto}`);
    desde = i + trozo.length;
  }
});

test("solo tres importes en la suma (fondo, efectivo, esperado): las propinas NO tienen fila ni columna propia", () => {
  const { html, texto, importes } = pintar(TURNO);
  assert.deepEqual(importes("data-sum"), [
    { key: "opening", amount: "$500.00" },
    { key: "cash", amount: "$1,380.00" },
    { key: "expected", amount: "$1,880.00" },
  ]);
  assert.doesNotMatch(texto, /Propinas en efectivo/, "ya no hay una fila «Propinas en efectivo $30.00» entre el efectivo y el esperado");
  assert.equal(texto.split("$30.00").length - 1, 1, "los $30 aparecen una sola vez…");
  assert.match(html, /<div class="bcaja-totals__note" data-note="tips">Incluye \$30\.00 de propinas[^<]*<\/div>/, "…y dentro de la nota del efectivo cobrado");
});

test("tarjeta y transferencia van APARTE, después del esperado: no están en el cajón", () => {
  const { texto, importes } = pintar(TURNO);
  assert.deepEqual(importes("data-outside"), [
    { key: "CARD", amount: "$380.00" },
    { key: "SPEI", amount: "$180.00" },
  ]);
  const esperado = texto.indexOf("Esperado en efectivo");
  const aparte = texto.indexOf("No está en el cajón");
  assert.ok(esperado >= 0 && aparte > esperado, "el aviso va debajo del esperado");
  assert.ok(texto.indexOf("Tarjeta") > aparte && texto.indexOf("Transferencia") > aparte);
});

test("un turno sin propinas en efectivo no enseña la nota", () => {
  const sinPropinas = { ...TURNO, byMethod: { ...TURNO.byMethod, CASH: { count: 10, subtotal: 1350, tip: 0, total: 1350 } }, cashTips: 0, expectedCash: 1850 };
  const { html, texto } = pintar(sinPropinas);
  assert.doesNotMatch(html, /data-note="tips"/);
  assert.doesNotMatch(texto, /propinas/i);
  assert.match(texto, /\$1,850\.00/);
});

test("también en inglés, con las mismas cifras", () => {
  const { texto, importes } = pintar(TURNO, "en");
  assert.deepEqual(importes("data-sum").map((x) => x.amount), ["$500.00", "$1,380.00", "$1,880.00"]);
  assert.match(texto, /Includes \$30\.00 in tips/);
  assert.doesNotMatch(texto, /session\.|caja\./, "ninguna llave sin traducir");
});

test("el diálogo de cierre usa este cuadro y ya no arma la lista vieja", () => {
  const src = readFileSync(join(__dirname, "..", "session-modals.tsx"), "utf8");
  assert.match(src, /<CloseExpectedBreakdown view=\{closeExpectedView\(summary\)\} t=\{t\} \/>/);
  assert.doesNotMatch(src, /caja\.cashTips/, "sin la fila suelta de propinas en efectivo");
  assert.match(src, /toCents\(summary\.expectedCash\)/, "la diferencia se sigue calculando contra el esperado del servidor");
});
