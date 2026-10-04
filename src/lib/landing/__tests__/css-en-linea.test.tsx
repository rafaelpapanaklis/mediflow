/**
 * N-60 (ws1-t8, tercera ronda): el CSS de las plantillas de la página web iba
 * como hijo de texto de <style>; en el render del servidor React escapaba la
 * comilla del `@import url('…')` y el navegador recibía `url(&#x27;https…`:
 * las fuentes no cargaban y la hidratación no coincidía (#425/#423).
 * Run: npm run test:css-en-linea
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { cssEnLinea } from "../css-en-linea";

const CSS = "@import url('https://fonts.googleapis.com/css2?family=Fraunces');";

test("con hijo de texto, React escapa la comilla del @import (la causa)", () => {
  assert.match(renderToString(<style>{CSS}</style>), /&#x27;/);
});

test("con cssEnLinea el @import llega intacto", () => {
  const html = renderToString(<style dangerouslySetInnerHTML={cssEnLinea(CSS)} />);
  assert.ok(html.includes("url('https://fonts.googleapis.com/css2?family=Fraunces')"), html);
  assert.doesNotMatch(html, /&#x27;/);
});

test("nada puede cerrar la etiqueta <style> desde un color de la clínica", () => {
  assert.doesNotMatch(cssEnLinea(".a{color:#000}</style><script>x()</script>").__html, /</);
});

test("ninguna plantilla de la página web pinta su CSS como hijo de texto", () => {
  const raiz = join(__dirname, "..", "..", "..", "app", "[slug]");
  const archivos = ["landing-client.tsx", ...readdirSync(join(raiz, "templates")).filter((f) => f.endsWith(".tsx")).map((f) => join("templates", f))];
  for (const f of archivos) {
    const fuente = readFileSync(join(raiz, f), "utf8");
    assert.doesNotMatch(fuente, /<style>\{`/, `${f} aún usa <style>{\`…\`}`);
  }
});
