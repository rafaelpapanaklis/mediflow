/**
 * Auditoría de seguridad «cloudflare», nº2 — SSRF por `Clinic.logoUrl`. Los PDF dentales (receta,
 * presupuesto, cabecera de factura/nota/consentimiento) bajaban el logo desde el servidor con un
 * `fetch(url)` sin reja: 127.0.0.1, 169.254.169.254, la red privada o un 302 hacia ahí.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 * Contra un servidor HTTP de verdad en 127.0.0.1 (el «servicio interno»), sin red de fuera.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Module from "node:module";
import type { AddressInfo } from "node:net";

// prescription-pdf y quote-pdf importan Prisma: un doble (estas pruebas no leen la base)
const dobles: Record<string, unknown> = { "server-only": {}, "@/lib/prisma": { prisma: {} } };
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

// PNG 1×1
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let server: http.Server;
let base = "";
const pedidos: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    pedidos.push(req.url ?? "");
    if (req.url === "/x.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG); return; }
    if (req.url === "/r.png") { res.writeHead(302, { location: "/x.png" }); res.end(); return; }
    if (req.url === "/r-interno.png") { res.writeHead(302, { location: "/interno.png" }); res.end(); return; }
    if (req.url === "/bucle.png") { res.writeHead(301, { location: "/bucle.png" }); res.end(); return; }
    if (req.url === "/sin-largo.png") { // chunked: sin content-length
      res.writeHead(200, { "content-type": "image/png" });
      for (let i = 0; i < 30; i++) res.write(Buffer.alloc(100_000, 1));
      res.end();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>((r) => server.close(() => r())); });

test("nº2: con la reja (lo de producción), ningún lector de logo visita un servicio interno", async () => {
  pedidos.length = 0;
  const { fetchClinicLogo } = await import("@/lib/pdf/clinic-letterhead");
  const { fetchLogoDataUrl } = await import("@/lib/pdf/prescription-pdf");
  const { fetchQuoteLogoDataUrl } = await import("@/lib/quotes/quote-pdf");
  assert.equal(await fetchClinicLogo(`${base}/x.png`, 1000), null, "cabecera (factura, nota, consentimiento…)");
  assert.equal(await fetchLogoDataUrl(`${base}/x.png`), null, "receta (también la verificación pública)");
  assert.equal(await fetchQuoteLogoDataUrl(`${base}/x.png`), null, "presupuesto");
  assert.deepEqual(pedidos, [], "al servicio interno no le llegó ni una petición");
});

test("nº2: cada redirección se revisa antes de seguirla; un 302 hacia lo interno no se pide", async () => {
  const { descargarLogoRemoto } = await import("@/lib/logo-remoto");
  // «público» = todo salvo /interno…: el primer destino pasa, el del salto no
  const reja = async (u: string) => !u.includes("/interno");

  pedidos.length = 0;
  assert.ok(await descargarLogoRemoto(`${base}/r.png`, { esSegura: reja }), "http→https o a www. sigue funcionando");
  assert.deepEqual(pedidos, ["/r.png", "/x.png"]);

  pedidos.length = 0;
  assert.equal(await descargarLogoRemoto(`${base}/r-interno.png`, { esSegura: reja }), null);
  assert.deepEqual(pedidos, ["/r-interno.png"], "el destino interno ni se pidió");

  pedidos.length = 0;
  assert.equal(await descargarLogoRemoto(`${base}/bucle.png`, { esSegura: reja }), null);
  assert.equal(pedidos.length, 4, "tres saltos y se corta");
});

test("nº2: el plazo cubre también la comprobación (un DNS que no contesta no cuelga el PDF)", async () => {
  const { descargarLogoRemoto } = await import("@/lib/logo-remoto");
  const t0 = Date.now();
  assert.equal(await descargarLogoRemoto(`${base}/x.png`, { timeoutMs: 200, esSegura: () => new Promise<boolean>(() => {}) }), null);
  assert.ok(Date.now() - t0 < 2000);
});

test("nº2: la reja rechaza localhost, privadas, metadatos de la nube, puertos raros y otros esquemas", async () => {
  const { esUrlRemotaSegura } = await import("@/lib/logo-remoto");
  for (const url of [
    "http://127.0.0.1/x.png", "http://localhost/x.png", "http://app.localhost/x.png",
    "http://169.254.169.254/latest/meta-data/x.png", "http://10.0.0.5/x.png", "http://192.168.1.10/x.png",
    "http://172.16.3.4/x.png", "http://100.64.0.1/x.png", "https://[::1]/x.png", "https://[fd00::1]/x.png",
    "https://[::ffff:10.0.0.1]/x.png", "https://[::ffff:169.254.169.254]/x.png", "https://[::ffff:7f00:1]/x.png",
    "https://[::127.0.0.1]/x.png", "https://[64:ff9b::a00:1]/x.png", "https://8.8.8.8:8443/x.png", "http://8.8.8.8:9200/x.png",
    "ftp://8.8.8.8/x.png", "file:///etc/passwd", "https://usuario:clave@8.8.8.8/x.png", "no es url",
  ]) {
    assert.equal(await esUrlRemotaSegura(url), false, url);
  }
  // una IP pública (sin consultar DNS de fuera: es una IP literal)
  assert.equal(await esUrlRemotaSegura("https://8.8.8.8/x.png"), true);
  assert.equal(await esUrlRemotaSegura("http://8.8.8.8/x.png"), true, "http en su puerto de siempre sigue valiendo");
});

test("nº2: tope de bytes por content-length y por lo que llega", async () => {
  const grande = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "image/png" }); res.end(Buffer.alloc(3_000_000, 1)); });
  await new Promise<void>((r) => grande.listen(0, "127.0.0.1", r));
  try {
    const { descargarLogoRemoto } = await import("@/lib/logo-remoto");
    const url = `http://127.0.0.1:${(grande.address() as AddressInfo).port}/x.png`;
    assert.equal(await descargarLogoRemoto(url, { esSegura: async () => true }), null);
    assert.equal(await descargarLogoRemoto(`${base}/sin-largo.png`, { esSegura: async () => true }), null, "sin content-length, cortado al leer");
  } finally {
    await new Promise<void>((r) => grande.close(() => r()));
  }
});
