/**
 * Headers de next.config.mjs — caché larga de los dientes 3D sin romper los de siempre (CSP…).
 *
 * Run: npm run test:next-headers
 *
 * Los .glb del odontograma 3D (public/odontograma/dientes-3d/, con `?v=MODEL_VERSION`) y el
 * decodificador Draco (public/odontograma/draco/) se sirven con `Cache-Control: immutable` de un
 * año. Sin eso Vercel los sirve con `max-age=0, must-revalidate`. Lo que se vigila:
 *   · las dos carpetas (y solo ellas) llevan el Cache-Control inmutable;
 *   · la entrada `/:path*` conserva CSP, HSTS, X-Frame-Options… y NO lleva Cache-Control
 *     (si lo llevara, ganaría sobre las páginas y las APIs de todo el sitio);
 *   · la CSP sigue dejando cargar el decodificador Draco (worker-src blob:, script/connect 'self').
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

type Entrada = { source: string; headers: { key: string; value: string }[] };

async function cargar(): Promise<Entrada[]> {
  const ruta = path.resolve(__dirname, "../../../next.config.mjs");
  const mod = await import(pathToFileURL(ruta).href);
  return mod.default.headers();
}

const INMUTABLE = "public, max-age=31536000, immutable";
const valor = (e: Entrada | undefined, key: string) => e?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

test("dientes 3D y decodificador Draco: caché de un año, inmutable", async () => {
  const h = await cargar();
  for (const source of ["/odontograma/dientes-3d/:path*", "/odontograma/draco/:path*"]) {
    const e = h.find((x) => x.source === source);
    assert.ok(e, `falta la entrada ${source}`);
    assert.equal(valor(e, "Cache-Control"), INMUTABLE);
    assert.equal(e!.headers.length, 1, "solo Cache-Control: no pisa nada más");
  }
});

test("solo esas dos carpetas son inmutables (nada más bajo /odontograma, ni el resto del sitio)", async () => {
  const h = await cargar();
  const conCache = h.filter((x) => valor(x, "Cache-Control") !== undefined).map((x) => x.source).sort();
  assert.deepEqual(conCache, ["/odontograma/dientes-3d/:path*", "/odontograma/draco/:path*"]);
});

test("la entrada general conserva sus headers de seguridad y no lleva Cache-Control", async () => {
  const h = await cargar();
  const general = h.find((x) => x.source === "/:path*");
  assert.ok(general);
  for (const k of ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
    assert.ok(valor(general, k), `falta ${k}`);
  }
  assert.equal(valor(general, "Cache-Control"), undefined);
});

test("la CSP deja cargar Draco: workers desde blob:, decodificador wasm y wrapper desde 'self'", async () => {
  const csp = valor((await cargar()).find((x) => x.source === "/:path*"), "Content-Security-Policy")!;
  const dir = (n: string) => csp.split("; ").find((d) => d.startsWith(`${n} `)) ?? "";
  assert.match(dir("worker-src"), /'self' blob:/);
  assert.match(dir("script-src"), /'self'/);
  assert.match(dir("connect-src"), /'self'/);
});
