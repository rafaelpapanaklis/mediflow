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
  assert.match(t, /enfocarNombre\.current \? campoNombre\.current : tarjeta\.current/);
});

test("W7: el botón solo sube cuando la barra está visible; en ese caso se esconde y la barra abre la tarjeta", () => {
  assert.match(bloque, /\.dcv4-wawidget \{ right: 14px; bottom: calc\(14px/);
  assert.match(bloque, /body\[data-barra-movil\] \.dcv4-wawidget \{ bottom: calc\(82px/);
  assert.match(bloque, /body\[data-barra-movil\] \.dcv4-wawidget__fab \{ display: none; \}/);
  const b = leer("barra-movil.tsx");
  assert.match(b, /setAttribute\("data-barra-movil"/);
  assert.match(b, /alClic=\{\(teclado\) => abrirTarjetaWhatsapp\(teclado\)\}/);
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

test("N-W2: el «WhatsApp» de la barra que abre la tarjeta NO registra la conversión; sin widget sí", async () => {
  const { BotonWhatsapp } = await import("../cta-embudo");
  const lanzados: string[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { gtag: (...a: unknown[]) => lanzados.push(String(a[1])), dataLayer: [], location: { pathname: "/", search: "" }, addEventListener() {}, localStorage: undefined };
  const el = BotonWhatsapp({ origen: "barra_movil", alClic: () => true, children: "x" }) as unknown as {
    props: { onClick: (e: { detail: number; preventDefault(): void }) => void };
  };
  let prevenido = false;
  el.props.onClick({ detail: 1, preventDefault: () => { prevenido = true; } });
  assert.equal(prevenido, true);
  assert.deepEqual(lanzados, [], "atendido por la tarjeta: ni gtag ni embudo");
  const el2 = BotonWhatsapp({ origen: "barra_movil", alClic: () => false, children: "x" }) as unknown as typeof el;
  let prev2 = false;
  el2.props.onClick({ detail: 1, preventDefault: () => { prev2 = true; } });
  assert.equal(prev2, false);
});

test("N-W2: la tarjeta registra la conversión en «Iniciar conversación» y al enviar el formulario, no al abrir", () => {
  const t = leer("whatsapp-widget.tsx");
  const abrir = t.slice(t.indexOf("function abrir("), t.indexOf("function cerrar("));
  assert.doesNotMatch(abrir, /registrarPaso/);
  // Un solo punto de registro (contarConversion, una vez por apertura), llamado desde «Iniciar» y desde el envío.
  assert.equal((t.match(/registrarPaso\("whatsapp_clic"/g) ?? []).length, 1);
  assert.match(t, /onClick=\{contarConversion\}/);
  assert.match(t, /if \(conversionContada\.current\) return;/);
});

test("N4-W2/W4: el campo usa autoComplete=\"tel\" y su etiqueta dice que es de México (+52, 10 dígitos)", () => {
  const t = leer("whatsapp-widget.tsx");
  assert.match(t, /autoComplete="tel"/);
  assert.doesNotMatch(t, /tel-national/);
  assert.match(t, /Número de WhatsApp en México \(\+52, 10 dígitos\)/);
  // El «+52» visual sigue fuera del árbol de accesibilidad: la etiqueta ya lo dice.
  assert.match(t, /dcv4-wawidget__prefijo" aria-hidden="true"/);
});
