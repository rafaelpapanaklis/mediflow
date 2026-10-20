/**
 * Revisión t4 (W2, W5, W6, W7): lo que el CSS y el DOM del botón de WhatsApp deben cumplir.
 * Lo que necesita un navegador (foco, Esc, posición real) se ejecutó con Playwright; ver el reporte.
 * Run: npm run test:whatsapp-widget
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const dir = path.resolve(__dirname, "..");
const leer = (f: string) => readFileSync(path.join(dir, f), "utf8");
const css = leer("landing-v2.css");
const bloque = css.slice(css.indexOf("Botón de WhatsApp flotante"));

test("W5: el botón y su tarjeta no tienen modo oscuro (la portada es clara)", () => {
  assert.doesNotMatch(bloque, /prefers-color-scheme/);
});

test("W6: la cabecera de la tarjeta usa #075E54 (blanco sobre él pasa AA)", () => {
  assert.match(bloque, /\.dcv4-wawidget__head \{[^}]*background: #075E54/);
});

test("W2: el botón va antes que la tarjeta en el DOM y el CSS lo pinta debajo (column-reverse)", () => {
  const t = leer("whatsapp-widget.tsx");
  assert.ok(t.indexOf("dcv4-wawidget__fab") < t.indexOf('role="dialog"'));
  assert.match(bloque, /flex-direction: column-reverse/);
  assert.match(t, /campoNombre\.current\?\.focus\(\)/);
});

test("W7: el botón solo sube cuando la barra está visible; en ese caso se esconde y la barra abre la tarjeta", () => {
  assert.match(bloque, /\.dcv4-wawidget \{ right: 14px; bottom: calc\(14px/);
  assert.match(bloque, /body\[data-barra-movil\] \.dcv4-wawidget \{ bottom: calc\(82px/);
  assert.match(bloque, /body\[data-barra-movil\] \.dcv4-wawidget__fab \{ display: none; \}/);
  const b = leer("barra-movil.tsx");
  assert.match(b, /setAttribute\("data-barra-movil"/);
  assert.match(b, /alClic=\{abrirTarjetaWhatsapp\}/);
  assert.match(leer("whatsapp-widget.tsx"), /EVENTO_ABRIR_WHATSAPP/);
});

test("el puente barra→tarjeta: sin widget montado el enlace sigue a wa.me; con widget, lo atiende", async () => {
  const { abrirTarjetaWhatsapp, EVENTO_ABRIR_WHATSAPP } = await import("../whatsapp-widget-eventos");
  const objetivo = new EventTarget();
  (globalThis as unknown as { window: EventTarget }).window = objetivo;
  (globalThis as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent ??= class extends Event {} as never;
  assert.equal(abrirTarjetaWhatsapp(), false);
  objetivo.addEventListener(EVENTO_ABRIR_WHATSAPP, (e) => e.preventDefault());
  assert.equal(abrirTarjetaWhatsapp(), true);
});
