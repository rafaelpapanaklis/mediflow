// QA B ronda 2 (15-nov-2026) · Ticket para impresora térmica de 80 y 58 mm.
//
// Rafael: «¿si se conecta una terminal de tickets para imprimir, se puede?».
// Sin drivers ni servicios nuevos: window.print() con una página del ancho del
// rollo (@page con ancho, márgenes 0 y el LARGO del ticket medido), letra
// legible, blanco y negro, renglones que no se parten, logo opcional en gris.
// La elección se recuerda en el navegador.
//
//   npx tsx --test src/lib/barber/__tests__/ticket-termico.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRINT_LOGO_KEY,
  PRINT_WIDTH_KEY,
  PX_PER_MM,
  printWidthClass,
  readPrintWidth,
  thermalPageCss,
} from "@/components/barber/cash/print-width";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";

const SRC = join(__dirname, "../../..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("la página del rollo: ancho exacto, márgenes 0 y el largo del ticket (+8 mm para el corte)", () => {
  // Un ticket de 400 px de alto = 105.83 mm → 106 + 8 = 114 mm.
  assert.equal(thermalPageCss("80", 400), "@page { size: 80mm 114mm; margin: 0; }");
  assert.equal(thermalPageCss("58", 400), "@page { size: 58mm 114mm; margin: 0; }");
  assert.equal(thermalPageCss("80", 0), "@page { size: 80mm 40mm; margin: 0; }", "nunca menos de 40 mm");
  assert.equal(thermalPageCss("letter", 900), "", "carta: manda el navegador, como siempre");
  assert.ok(Math.abs(PX_PER_MM - 3.7795) < 0.001);
});

test("lo guardado en el navegador se lee con cuidado; la llave sobrevive al cambio de sede", () => {
  assert.equal(readPrintWidth("80"), "80");
  assert.equal(readPrintWidth("58"), "58");
  assert.equal(readPrintWidth(null), "letter");
  assert.equal(readPrintWidth("110"), "letter");
  // switchBranchAndReload borra todo lo que empieza con «dcb:»; la impresora no cambia con la sede.
  assert.ok(!PRINT_WIDTH_KEY.startsWith("dcb:") && !PRINT_LOGO_KEY.startsWith("dcb:"));
  assert.equal(printWidthClass("letter"), "");
  assert.equal(printWidthClass("80"), "bcaja-print--thermal bcaja-print--t80");
});

test("la hoja de estilos: ancho, blanco y negro, renglones enteros y sin adornos al imprimir", () => {
  const css = leer("components/barber/cash/money.css");
  assert.match(css, /\.bcaja-print--t80 \{ width: 80mm; max-width: 80mm;/);
  assert.match(css, /\.bcaja-print--t58 \{ width: 58mm; max-width: 58mm;/);
  assert.match(css, /\.bcaja-print--thermal \* \{ color: #000 !important; background: transparent !important;/);
  assert.match(css, /\.bcaja-print--thermal \.bcaja-print__row \{[^}]*break-inside: avoid;/);
  assert.match(css, /\.bcaja-print--thermal \.bcaja-print__logo \{[^}]*filter: grayscale\(1\)/);
  assert.match(css, /@media print \{[\s\S]*\.bcaja-print\.bcaja-print--thermal \{ width: 100% !important;/);
  assert.match(css, /@media print \{[\s\S]*\.barber-shell \.barber-menu-btn,/);
});

test("el ticket y el recibo usan el selector y la página medida; el recibo ya no avisa #418", () => {
  for (const rel of ["components/barber/cash/ticket-print.tsx", "components/barber/commissions/receipt-print.tsx"]) {
    const src = leer(rel);
    assert.match(src, /<PrintSetupControls/, rel);
    assert.match(src, /onPrint=\{\(\) => printWithWidth\(printSetup\.width, /, rel);
    assert.doesNotMatch(src, /onClick=\{\(\) => window\.print\(\)\}/, `${rel}: ya no imprime sin la página`);
  }
  assert.match(leer("components/barber/commissions/receipt-print.tsx"), /className="bcaja-print__thanks" suppressHydrationWarning/);
  assert.match(leer("components/barber/cash/ticket-print.tsx"), /\(!thermal \|\| printSetup\.logo\)/, "logo opcional en térmica");
});

test("textos del selector en es y en", () => {
  for (const locale of ["es", "en"] as const) {
    const p = (((getBarberDict(locale) as Dictionary).barber as Dictionary).caja as Dictionary).print as Dictionary;
    for (const k of ["printer", "widthLetter", "width80", "width58", "withLogo"]) assert.equal(typeof p[k], "string", `${locale}: print.${k}`);
    assert.match(String(p.width80), /80 mm/);
    assert.match(String(p.width58), /58 mm/);
  }
});
