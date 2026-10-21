/**
 * subirImagenDocumento EN CHROMIUM DE VERDAD — lo que los dobles de Node no
 * pueden probar: que el navegador abre una foto de cámara de casi 40 MB, la
 * gira según su EXIF, la deja en 1600 px y la codifica en webp antes de que
 * salga la petición; y que lo que no abre (HEIC en Chrome, un JPEG roto) toma
 * el camino correcto.
 *
 * Run: npm run test:documentos-imagenes   (SALTA si no está Playwright: ~/navegador)
 *
 * La página es el ayudante real empaquetado con esbuild. Cada petición a
 * /api/documentos/imagenes* la contesta el HANDLER REAL (bucket en memoria de
 * ./dobles) y el PUT a la URL firmada lo recibe ese mismo bucket. Las fotos se
 * generan con sharp y se le sirven a la página por /muestra/<n>.
 */
import "./dobles";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { bucket, putFirmado, sesion } from "./dobles";
import { cargarChromium, empaquetar } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";

const MB = 1024 * 1024;
const ORIGEN = "http://editor.prueba";

let navegador: any = null;
let paquete: string | null = null;

after(async () => {
  await navegador?.close();
});

const ruido = (ancho: number, alto: number, sigma = 60) =>
  sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: "gaussian", mean: 128, sigma } } });

async function abrir(t: { skip(m: string): void }, muestras: Record<string, Buffer>) {
  const chromium = await cargarChromium();
  if (!chromium) {
    t.skip("Playwright no está (NAVEGADOR_DIR): el navegador NO se ejecutó");
    return null;
  }
  paquete ??= await empaquetar("src/lib/documentos/__tests__/arnes-subir-imagen.ts");
  navegador ??= await chromium.launch({ args: ["--no-sandbox"] });
  const page = await navegador.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  const peticiones: Array<{ metodo: string; ruta: string; bytes: number }> = [];

  const { POST } = await import("@/app/api/documentos/imagenes/route");
  const original = await import("@/app/api/documentos/imagenes/original/route");
  const procesar = await import("@/app/api/documentos/imagenes/original/procesar/route");

  await page.route("**/*", async (route: any) => {
    const req = route.request();
    const url = new URL(req.url());
    const metodo = req.method();
    if (url.origin === ORIGEN && url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><script src="/arnes.js"></script>` });
    }
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete });
    const muestra = url.pathname.match(/^\/muestra\/(.+)$/);
    if (muestra) return route.fulfill({ contentType: "application/octet-stream", body: muestras[decodeURIComponent(muestra[1]!)] });

    // La URL firmada del bucket (otro origen): CORS como lo contesta Storage.
    if (url.origin === "https://bucket.prueba") {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "PUT", "access-control-allow-headers": "*" };
      if (metodo === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const cuerpo = req.postDataBuffer() ?? Buffer.alloc(0);
      peticiones.push({ metodo, ruta: "PUT bucket", bytes: cuerpo.length });
      const estado = putFirmado(url.href, cuerpo, req.headers()["content-type"] ?? "");
      return route.fulfill({ status: estado, headers: cors, body: "{}" });
    }

    if (url.pathname.startsWith("/api/documentos/imagenes")) {
      const cuerpo = req.postDataBuffer();
      peticiones.push({ metodo, ruta: url.pathname, bytes: cuerpo?.length ?? 0 });
      const peticion = new Request(new URL(url.pathname + url.search, "http://localhost"), {
        method: metodo,
        headers: req.headers(),
        body: cuerpo && metodo !== "GET" ? new Uint8Array(cuerpo) : undefined,
      }) as any;
      const res =
        url.pathname === "/api/documentos/imagenes" ? await POST(peticion)
        : url.pathname === "/api/documentos/imagenes/original" ? await (metodo === "DELETE" ? original.DELETE(peticion) : original.POST(peticion))
        : await procesar.POST(peticion);
      return route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGEN}/`);
  await page.waitForFunction('typeof window.subirImagenDocumento === "function"', null, { timeout: 15_000 });

  /** Sube la muestra `nombre` como un File con ese tipo; devuelve el resultado o el error tal como lo ve el editor. */
  // Como texto y no como función: tsx le mete `__name(...)` a las funciones y
  // ese ayudante no existe dentro de la página.
  const subir = (nombre: string, tipo: string) =>
    page.evaluate(`(async () => {
      const blob = await (await fetch("/muestra/" + encodeURIComponent(${JSON.stringify(nombre)}))).blob();
      const file = new File([blob], ${JSON.stringify(nombre)}, { type: ${JSON.stringify(tipo)} });
      const progreso = [];
      const t0 = performance.now();
      try {
        const r = await window.subirImagenDocumento(file, { onProgreso: (p) => progreso.push(p) });
        return { ok: true, ...r, progreso, ms: Math.round(performance.now() - t0), tamano: file.size };
      } catch (e) {
        return { ok: false, nombre: e && e.name, codigo: e && e.codigo, mensaje: e && e.message, progreso, tamano: file.size };
      }
    })()`);
  return { page, subir, peticiones, errores };
}

const rutasDe = (p: Array<{ metodo: string; ruta: string }>) =>
  p.filter((x) => !x.ruta.startsWith("/muestra")).map((x) => (x.ruta === "PUT bucket" ? x.ruta : `${x.metodo} ${x.ruta}`));

test("Chromium: foto de cámara de ~39 MB (8 000 × 6 000) → se abre y comprime EN el navegador, viaja < 2 MB, sale webp 1600 px", async (t) => {
  bucket.reiniciar();
  sesion.reiniciar();
  // Ruido a calidad alta: un JPEG de cámara de verdad, sin relleno.
  // (medido: 8 000 × 6 000, sigma 30, calidad 96 ≈ 38 MB)
  const foto = await ruido(8000, 6000, 30).jpeg({ quality: 96 }).toBuffer();
  assert.ok(foto.length > 30 * MB && foto.length < 40 * MB, `la muestra pesa ${(foto.length / MB).toFixed(1)} MB`);
  const a = await abrir(t, { "DSC_0042.JPG": foto });
  if (!a) return;
  const r = await a.subir("DSC_0042.JPG", "image/jpeg");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual({ ancho: r.ancho, alto: r.alto }, { ancho: 1600, alto: 1200 });
  assert.deepEqual(rutasDe(a.peticiones), ["POST /api/documentos/imagenes"], "camino normal, sin subida directa");
  assert.ok(a.peticiones[0]!.bytes < 2 * MB, `viajaron ${(a.peticiones[0]!.bytes / MB).toFixed(2)} MB de ${(foto.length / MB).toFixed(1)} MB`);
  assert.equal(r.progreso.at(-1), 100);
  const meta = await sharp(bucket.objetos.get(r.clave)!.bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.deepEqual([meta.width, meta.height], [1600, 1200]);
  assert.deepEqual(a.errores, []);
  t.diagnostic(`muestra ${(foto.length / MB).toFixed(1)} MB → viajó ${(a.peticiones[0]!.bytes / 1024).toFixed(0)} KB → guardada ${(bucket.objetos.get(r.clave)!.bytes.length / 1024).toFixed(0)} KB en ${r.ms} ms`);
});

test("Chromium: la foto vertical del celular (EXIF orientación 6) sale DERECHA; y 39.9 MB justos entran", async (t) => {
  bucket.reiniciar();
  sesion.reiniciar();
  const vertical = await ruido(4032, 3024).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer();
  const base = await ruido(2000, 1500).jpeg({ quality: 90 }).toBuffer();
  const justa = Buffer.concat([base, Buffer.alloc(Math.floor(39.9 * MB) - base.length)]);
  const a = await abrir(t, { "IMG_4410.JPG": vertical, "justa.jpg": justa });
  if (!a) return;
  const r1 = await a.subir("IMG_4410.JPG", "image/jpeg");
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.deepEqual({ ancho: r1.ancho, alto: r1.alto }, { ancho: 1200, alto: 1600 }, "girada según el EXIF");
  const r2 = await a.subir("justa.jpg", "image/jpeg");
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.tamano, Math.floor(39.9 * MB));
  assert.deepEqual(rutasDe(a.peticiones), ["POST /api/documentos/imagenes", "POST /api/documentos/imagenes"]);
});

test("Chromium: 40.1 MB, GIF y SVG se rechazan con su mensaje SIN ninguna petición", async (t) => {
  bucket.reiniciar();
  sesion.reiniciar();
  const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 9, g: 9, b: 9 } } }).gif().toBuffer();
  const a = await abrir(t, {
    "grande.jpg": Buffer.alloc(Math.ceil(40.1 * MB), 1),
    "a.gif": gif,
    "a.svg": Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  if (!a) return;
  assert.deepEqual(
    [await a.subir("grande.jpg", "image/jpeg"), await a.subir("a.gif", "image/gif"), await a.subir("a.svg", "image/svg+xml")].map((r) => [r.ok, r.mensaje]),
    [
      [false, "La imagen pesa más de 40 MB."],
      [false, "Solo fotos JPG, PNG, WEBP o HEIC."],
      [false, "Solo fotos JPG, PNG, WEBP o HEIC."],
    ],
  );
  assert.deepEqual(rutasDe(a.peticiones), []);
});

test("Chromium: un HEIC (Chrome no lo abre) → mensaje de HEIC sin subir nada; un JPEG roto → va como original y el servidor lo rechaza", async (t) => {
  bucket.reiniciar();
  sesion.reiniciar();
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(4), Buffer.from("mif1heic"), Buffer.alloc(4096, 3)]);
  const roto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200_000, 0x41)]);
  const a = await abrir(t, { "IMG_0001.HEIC": heic, "roto.jpg": roto });
  if (!a) return;
  const r1 = await a.subir("IMG_0001.HEIC", "image/heic");
  assert.deepEqual([r1.ok, r1.codigo], [false, "heic_no_legible"], JSON.stringify(r1));
  // Chrome en Windows manda los HEIC con tipo vacío: lo reconoce por la extensión.
  const r2 = await a.subir("IMG_0001.HEIC", "");
  assert.deepEqual([r2.ok, r2.codigo], [false, "heic_no_legible"], JSON.stringify(r2));
  assert.deepEqual(rutasDe(a.peticiones), [], "el HEIC no salió del navegador");

  const r3 = await a.subir("roto.jpg", "image/jpeg");
  assert.deepEqual([r3.ok, r3.codigo], [false, "no_se_pudo_leer"], JSON.stringify(r3));
  assert.deepEqual(rutasDe(a.peticiones), ["POST /api/documentos/imagenes/original", "PUT bucket", "POST /api/documentos/imagenes/original/procesar"]);
  assert.equal(bucket.objetos.size, 0, "el original se borró");
});

test("Chromium: un PNG con transparencia conserva el canal alfa en el webp", async (t) => {
  bucket.reiniciar();
  sesion.reiniciar();
  const png = await sharp({ create: { width: 2400, height: 800, channels: 4, background: { r: 30, g: 90, b: 160, alpha: 0.4 } } }).png().toBuffer();
  const a = await abrir(t, { "logo.png": png });
  if (!a) return;
  const r = await a.subir("logo.png", "image/png");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual({ ancho: r.ancho, alto: r.alto }, { ancho: 1600, alto: 533 });
  const meta = await sharp(bucket.objetos.get(r.clave)!.bytes).metadata();
  assert.equal(meta.hasAlpha, true);
});
