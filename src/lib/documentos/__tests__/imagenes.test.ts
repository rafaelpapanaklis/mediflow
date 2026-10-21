/**
 * IMÁGENES DEL EDITOR DE DOCUMENTOS (P4) — servidor y rutas.
 *
 * Run: npm run test:documentos-imagenes
 *
 * Qué fija:
 *   · El contrato: límites (40 MB, 40 por documento, 1600 px, tipos) y la forma
 *     exacta de la clave `documentos/<clinicId>/<id>.webp`.
 *   · Tipo y tamaño en el servidor, por los BYTES: 39.9 MB entra, 40.1 MB no;
 *     GIF, SVG, PDF y AVIF no; HEIC se rechaza con su mensaje (el sharp del repo
 *     no lo decodifica).
 *   · La compresión con sharp de verdad: una foto de cámara de 6000×4000 con
 *     EXIF de rotación y GPS sale webp de ≤ 1600 px, derecha y SIN metadatos.
 *   · El camino del original (subida directa de 40 MB): mide en Storage antes de
 *     bajar, rechaza y borra lo que pasa de 40 MB sin bajarlo, borra siempre el
 *     original.
 *   · Tenant: la clave de otra clínica, con `../`, doble codificada o inventada
 *     da 404 (nunca 403 con detalles); `leerImagenDocumento` igual.
 *   · Tope de 40, permisos (recepción no sube ni ve), límite por usuario y
 *     bitácora (una fila por imagen guardada, una por rechazo).
 *
 * Handlers REALES con el bucket en memoria de ./dobles. ⛔ Sin base ni red.
 */
import "./dobles";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import sharp from "sharp";

type Sharp = ReturnType<typeof sharp>;
import { bucket, putFirmado, sesion } from "./dobles";
import {
  IMAGEN_LADO_MAX_PX,
  IMAGEN_MAX_BYTES,
  IMAGEN_MAX_POR_DOCUMENTO,
  IMAGEN_TIPOS,
} from "../limites-imagen";
import {
  claveDeImagen,
  claveDesdeSegmentos,
  claveEsDeLaClinica,
  leerClave,
  medidasFinales,
  revisarArchivo,
  revisarImagenesDelDocumento,
  rutaDeImagen,
  tipoDeclarado,
} from "../imagenes";

const MB = 1024 * 1024;

beforeEach(() => {
  bucket.reiniciar();
  sesion.reiniciar();
});

// ─────────────────────────── Imágenes de prueba (sharp real) ───────────────────────────

/** Ruido: no se comprime, así que pesa como una foto de verdad. */
async function fotoJpeg(ancho: number, alto: number, extra?: (s: Sharp) => Sharp): Promise<Buffer> {
  let s = sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: "gaussian", mean: 128, sigma: 50 } } });
  if (extra) s = extra(s);
  return s.jpeg({ quality: 92 }).toBuffer();
}

/** Un JPEG válido estirado con bytes de relleno hasta `bytes` (lo de después del EOI no se decodifica). */
async function jpegDeTamano(bytes: number): Promise<Buffer> {
  const base = await fotoJpeg(1200, 900);
  return Buffer.concat([base, Buffer.alloc(bytes - base.length)]);
}

const gif = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#808080" } }).gif().toBuffer();
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
const avif = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#808080" } }).avif().toBuffer();
const svg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

/** Cabecera HEIC real (caja ftyp de un iPhone): file-type la reconoce; el cuerpo no importa. */
function heic(): Buffer {
  const ftyp = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic"),
  ]);
  return Buffer.concat([ftyp, Buffer.alloc(2048, 7)]);
}

/** PNG que DECLARA `lado` × `lado` px con un IDAT diminuto: una «bomba» de descompresión. */
function pngBomba(lado = 30000): Buffer {
  const trozo = (tipo: string, datos: Buffer) => {
    const t = Buffer.from(tipo);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, datos])) >>> 0);
    return Buffer.concat([largo, t, datos, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

// ─────────────────────────── Peticiones a los handlers reales ───────────────────────────

const URL_BASE = "http://localhost/api/documentos/imagenes";

async function postImagen(bytes: Buffer, o: { tipo?: string; nombre?: string; enDocumento?: number; cabeceras?: Record<string, string> } = {}) {
  const { POST } = await import("@/app/api/documentos/imagenes/route");
  const fd = new FormData();
  fd.append("archivo", new Blob([new Uint8Array(bytes)], { type: o.tipo ?? "image/jpeg" }), o.nombre ?? "foto.jpg");
  fd.append("nombre", o.nombre ?? "foto.jpg");
  if (o.enDocumento !== undefined) fd.append("enDocumento", String(o.enDocumento));
  // Como lo manda un navegador: el multipart ya armado, con su Content-Length.
  const armado = new Response(fd);
  const cuerpo = new Uint8Array(await armado.arrayBuffer());
  const cabeceras = { "content-type": armado.headers.get("content-type")!, "content-length": String(cuerpo.length), ...o.cabeceras };
  const res = await POST(new Request(URL_BASE, { method: "POST", body: cuerpo, headers: cabeceras }) as any);
  return { status: res.status, body: await res.json() };
}

async function firmarOriginal(cuerpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/documentos/imagenes/original/route");
  const res = await POST(new Request(`${URL_BASE}/original`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }) as any);
  return { status: res.status, body: await res.json() };
}

async function procesar(cuerpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/documentos/imagenes/original/procesar/route");
  const res = await POST(new Request(`${URL_BASE}/original/procesar`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }) as any);
  return { status: res.status, body: await res.json() };
}

/** `segmentos` como viajan en la URL; los params se los pasa decodificados, como hace el route-matcher de Next. */
async function verImagen(segmentos: string[]) {
  const { GET } = await import("@/app/api/documentos/imagenes/[...clave]/route");
  const params = { clave: segmentos.map((s) => decodeURIComponent(s)) };
  const res = await GET(new Request(`${URL_BASE}/${segmentos.join("/")}`) as any, { params: Promise.resolve(params) });
  return { status: res.status, location: res.headers.get("location"), cache: res.headers.get("cache-control"), texto: await res.text() };
}

/** Guarda una imagen de la clínica `clinicId` directamente en el bucket (como si la hubiera subido). */
async function sembrar(clinicId: string, id = "a".repeat(32)): Promise<string> {
  const clave = claveDeImagen(clinicId, id);
  bucket.objetos.set(clave, { bytes: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).webp().toBuffer(), tipo: "image/webp" });
  return clave;
}

// ─────────────────────────── 1 · Contrato ───────────────────────────

test("contrato: los límites son los que firmó Rafael (40 MB, 40 por documento, 1600 px, cinco tipos)", () => {
  assert.equal(IMAGEN_MAX_BYTES, 40 * 1024 * 1024);
  assert.equal(IMAGEN_MAX_POR_DOCUMENTO, 40);
  assert.equal(IMAGEN_LADO_MAX_PX, 1600);
  assert.deepEqual(IMAGEN_TIPOS, ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
});

test("contrato: la clave es documentos/<clinicId>/<32 hex>.webp y la ruta la codifica en un solo segmento", () => {
  const clave = claveDeImagen("clinica_qa_prueba", "0123456789abcdef0123456789abcdef");
  assert.equal(clave, "documentos/clinica_qa_prueba/0123456789abcdef0123456789abcdef.webp");
  assert.deepEqual(leerClave(clave), { clinicId: "clinica_qa_prueba", id: "0123456789abcdef0123456789abcdef" });
  assert.equal(rutaDeImagen(clave), "/api/documentos/imagenes/documentos%2Fclinica_qa_prueba%2F0123456789abcdef0123456789abcdef.webp");
  // Ids de clínica que no son uuid (cuid, siembras) también sirven.
  assert.ok(leerClave(claveDeImagen("cmuyolu2a0000abcd", "f".repeat(32))));
  assert.throws(() => claveDeImagen("../otra", "f".repeat(32)));
  assert.throws(() => claveDeImagen("clinica_a", "no-hex"));
});

test("contrato: claves mal formadas no se leen (../, otra extensión, subcarpeta, %2F doble, mayúsculas)", () => {
  const id = "a".repeat(32);
  for (const mala of [
    `documentos/../clinica_b/${id}.webp`,
    `documentos/clinica_a/../clinica_b/${id}.webp`,
    `documentos/clinica_a/${id}.png`,
    `documentos/clinica_a/originales/${id}`,
    `documentos/clinica_a/${id}.webp/`,
    `/documentos/clinica_a/${id}.webp`,
    `documentos/clinica_a/${"A".repeat(32)}.webp`,
    `clinical-photos/clinica_a/${id}.webp`,
  ]) {
    assert.equal(leerClave(mala), null, mala);
  }
  // Los segmentos llegan YA decodificados por Next: aquí no se decodifica otra vez.
  assert.equal(claveDesdeSegmentos([`documentos%2Fclinica_a%2F${id}.webp`]), null, "doble codificación (a Next le llegó %252F)");
  assert.equal(claveDesdeSegmentos(["documentos", "..", "clinica_a", `${id}.webp`]), null);
  assert.equal(claveDesdeSegmentos(["%E0%A4%A"]), null, "codificación rota");
  assert.equal(claveDesdeSegmentos([`documentos/clinica_a/${id}.webp`]), `documentos/clinica_a/${id}.webp`, "un segmento con %2F que Next decodificó");
  assert.equal(claveDesdeSegmentos(["documentos", "clinica_a", `${id}.webp`]), `documentos/clinica_a/${id}.webp`, "partida por un proxy");
  assert.equal(claveEsDeLaClinica(`documentos/clinica_a/${id}.webp`, "clinica_b"), false);
});

test("validación de cortesía: 39.9 MB entra, 40.1 MB no; GIF, SVG, PDF no; HEIC sin tipo se reconoce por extensión", () => {
  assert.equal(revisarArchivo({ type: "image/jpeg", name: "a.jpg", size: 39.9 * MB }), null);
  assert.equal(revisarArchivo({ type: "image/jpeg", name: "a.jpg", size: IMAGEN_MAX_BYTES }), null, "40 MB justos entran");
  assert.equal(revisarArchivo({ type: "image/jpeg", name: "a.jpg", size: 40.1 * MB }), "muy_pesada");
  assert.equal(revisarArchivo({ type: "image/jpeg", name: "a.jpg", size: 0 }), "vacia");
  assert.equal(revisarArchivo({ type: "image/gif", name: "a.gif", size: 1000 }), "tipo_no_permitido");
  assert.equal(revisarArchivo({ type: "image/svg+xml", name: "a.svg", size: 1000 }), "tipo_no_permitido");
  assert.equal(revisarArchivo({ type: "application/pdf", name: "a.pdf", size: 1000 }), "tipo_no_permitido");
  assert.equal(revisarArchivo({ type: "", name: "a.svg", size: 1000 }), "tipo_no_permitido");
  // Chrome en Windows manda los HEIC con type vacío.
  assert.equal(tipoDeclarado({ type: "", name: "IMG_0001.HEIC" }), "image/heic");
  assert.equal(revisarArchivo({ type: "", name: "IMG_0001.HEIC", size: 3 * MB }), null);
  // Un tipo declarado manda sobre la extensión: un .jpg que dice ser gif no pasa.
  assert.equal(revisarArchivo({ type: "image/gif", name: "a.jpg", size: 1000 }), "tipo_no_permitido");
});

test("medidas: lado mayor ≤ 1600 sin agrandar nunca", () => {
  assert.deepEqual(medidasFinales(6000, 4000), { ancho: 1600, alto: 1067 });
  assert.deepEqual(medidasFinales(3000, 4000), { ancho: 1200, alto: 1600 });
  assert.deepEqual(medidasFinales(800, 600), { ancho: 800, alto: 600 });
  assert.deepEqual(medidasFinales(16000, 10), { ancho: 1600, alto: 1 });
});

test("tope por documento: cuenta las <img data-archivo> (repetidas también) y señala las de otra clínica", () => {
  const propia = (n: number) => `<img data-archivo="documentos/clinica_a/${n.toString(16).padStart(32, "0")}.webp" data-ancho="medio" alt="">`;
  const cuarenta = Array.from({ length: 40 }, (_, i) => propia(i)).join("");
  assert.deepEqual(revisarImagenesDelDocumento(`<p>x</p>${cuarenta}`, "clinica_a"), { total: 40, excedeTope: false, ajenas: [] });
  const r = revisarImagenesDelDocumento(`${cuarenta}${propia(0)}`, "clinica_a");
  assert.equal(r.total, 41);
  assert.equal(r.excedeTope, true, "la misma foto dos veces cuenta dos");
  const ajena = `<img alt="" data-archivo='documentos/clinica_b/${"b".repeat(32)}.webp'>`;
  assert.deepEqual(revisarImagenesDelDocumento(`${propia(1)}${ajena}`, "clinica_a").ajenas, [`documentos/clinica_b/${"b".repeat(32)}.webp`]);
});

// ─────────────────────────── 2 · POST /api/documentos/imagenes ───────────────────────────

test("POST: una foto de cámara 6000×4000 con EXIF (rotación + GPS) se guarda webp ≤ 1600 px, derecha y sin metadatos", async () => {
  const foto = await fotoJpeg(6000, 4000, (s) =>
    s.withMetadata({ orientation: 6 }).withExif({ IFD0: { Make: "Canon", Copyright: "QA" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 25/1 0/1" } }),
  );
  assert.ok(foto.length > 3 * MB, `la foto de prueba pesa ${(foto.length / MB).toFixed(1)} MB`);
  const r = await postImagen(foto);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.clave, /^documentos\/clinica_a\/[0-9a-f]{32}\.webp$/);
  // Orientación 6 = girar 90°: la foto apaisada sale vertical.
  assert.deepEqual({ ancho: r.body.ancho, alto: r.body.alto }, { ancho: 1067, alto: 1600 });

  const guardado = bucket.objetos.get(r.body.clave)!;
  assert.equal(guardado.tipo, "image/webp");
  const meta = await sharp(guardado.bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(Math.max(meta.width!, meta.height!), 1600);
  assert.equal(meta.exif, undefined, "sin EXIF (ni GPS ni cámara)");
  assert.equal(meta.orientation, undefined);
  assert.ok(guardado.bytes.length < 1.5 * MB, `pesa ${guardado.bytes.length} B`);

  // Bitácora: una fila, sin paciente, con lo que se guardó.
  assert.equal(sesion.filas.length, 1);
  const fila = sesion.filas[0] as any;
  assert.equal(fila.clinicId, "clinica_a");
  assert.equal(fila.userId, "u-doc-a");
  assert.equal(fila.entityType, "document-image");
  assert.equal(fila.action, "create");
  assert.equal(fila.patientId, null);
  assert.equal(fila.changes._imagen.after.clave, r.body.clave);
  assert.equal(fila.changes._imagen.after.camino, "navegador");
  // Límite por usuario, con el id de la SESIÓN.
  assert.deepEqual(sesion.llamadasLimite[0], { id: "u-doc-a", limit: 60, windowSec: 600, scope: "documentos-imagenes-subir" });
});

test("POST: una imagen chica no se agranda y un PNG con transparencia entra", async () => {
  const r = await postImagen(await png(300, 200), { tipo: "image/png", nombre: "logo.png" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ ancho: r.body.ancho, alto: r.body.alto }, { ancho: 300, alto: 200 });
  const meta = await sharp(bucket.objetos.get(r.body.clave)!.bytes).metadata();
  assert.equal(meta.hasAlpha, true);
});

test("POST: 39.9 MB entra; 40.1 MB no (413) y no se guarda nada", async () => {
  const entra = await postImagen(await jpegDeTamano(Math.floor(39.9 * MB)));
  assert.equal(entra.status, 201, JSON.stringify(entra.body));

  bucket.reiniciar();
  sesion.reiniciar();
  const noEntra = await postImagen(await jpegDeTamano(Math.ceil(40.1 * MB)));
  assert.equal(noEntra.status, 413);
  assert.equal(noEntra.body.code, "muy_pesada");
  assert.equal(noEntra.body.error, "La imagen pesa más de 40 MB.");
  assert.equal(bucket.objetos.size, 0);
  assert.equal(sesion.rechazos.length, 1, "el rechazo queda en la bitácora");
  assert.equal((sesion.rechazos[0] as any).entityType, "upload-rejected");
});

test("POST: un Content-Length de más de 40 MB se rechaza sin leer el cuerpo", async () => {
  const r = await postImagen(await fotoJpeg(50, 50), { cabeceras: { "content-length": String(41 * MB) } });
  assert.equal(r.status, 413);
  assert.equal(bucket.objetos.size, 0);
});

test("POST: GIF, SVG, PDF y AVIF no entran aunque digan ser JPEG (se mira el contenido)", async () => {
  for (const [nombre, bytes] of [["a.gif", await gif()], ["a.svg", svg()], ["a.pdf", pdf()], ["a.avif", await avif()]] as const) {
    const r = await postImagen(bytes, { tipo: "image/jpeg", nombre: nombre.replace(/\.\w+$/, ".jpg") });
    assert.equal(r.status, 415, `${nombre}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, "tipo_no_permitido", nombre);
    assert.equal(r.body.error, "Solo fotos JPG, PNG, WEBP o HEIC.");
  }
  assert.equal(bucket.objetos.size, 0);
});

test("POST: un HEIC que llega sin convertir se rechaza con el mensaje de HEIC (el servidor no lo decodifica)", async () => {
  const r = await postImagen(heic(), { tipo: "image/heic", nombre: "IMG_0001.HEIC" });
  assert.equal(r.status, 415);
  assert.equal(r.body.code, "heic_no_legible");
  assert.match(r.body.error, /HEIC/);
  assert.equal(bucket.objetos.size, 0);
});

test("POST: un JPEG roto y una «bomba» de 900 MP se rechazan sin guardar", async () => {
  const roto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 0x33)]);
  const r1 = await postImagen(roto);
  assert.equal(r1.status, 422, JSON.stringify(r1.body));
  assert.equal(r1.body.code, "no_se_pudo_leer");
  const r2 = await postImagen(pngBomba(), { tipo: "image/png", nombre: "b.png" });
  assert.equal(r2.status, 422, JSON.stringify(r2.body));
  assert.equal(r2.body.code, "demasiados_pixeles");
  // PNG no se reduce al decodificar: su tope es 60 MP (9 000 × 9 000 = 81 MP no pasa).
  const r3 = await postImagen(pngBomba(9000), { tipo: "image/png", nombre: "c.png" });
  assert.equal(r3.body.code, "demasiados_pixeles", JSON.stringify(r3.body));
  assert.equal(bucket.objetos.size, 0);
});

test("POST: sin Content-Length (cuerpo chunked) → 411 sin leer el cuerpo", async () => {
  const { POST } = await import("@/app/api/documentos/imagenes/route");
  const fd = new FormData();
  fd.append("archivo", new Blob([new Uint8Array(await fotoJpeg(50, 50))], { type: "image/jpeg" }), "a.jpg");
  const res = await POST(new Request(URL_BASE, { method: "POST", body: fd }) as any);
  assert.equal(res.status, 411);
  assert.equal(bucket.objetos.size, 0);
});

test("cuota del plan: sin espacio → 402 y nada se guarda (también por el camino del original, que se borra)", async () => {
  sesion.cuotaLlena = true;
  const r = await postImagen(await fotoJpeg(300, 300));
  assert.equal(r.status, 402, JSON.stringify(r.body));
  assert.equal(bucket.objetos.size, 0);
  assert.equal(sesion.llamadasCuota[0]!.clinicId, "clinica_a");
  assert.ok(sesion.llamadasCuota[0]!.bytes > 0 && sesion.llamadasCuota[0]!.bytes < 200_000, "cuenta lo que se GUARDA (el webp), no el original");

  const foto = await fotoJpeg(300, 300);
  const f = await firmarOriginal({ nombre: "a.jpg", tamano: foto.length, tipo: "image/jpeg" });
  putFirmado(f.body.signedUrl, foto, "image/jpeg");
  const p = await procesar({ id: f.body.id });
  assert.equal(p.status, 402);
  assert.equal(bucket.objetos.size, 0, "ni el webp ni el original");
});

test("POST: tope de 40 por documento (39 entra, 40 ya no)", async () => {
  const foto = await fotoJpeg(64, 64);
  assert.equal((await postImagen(foto, { enDocumento: 39 })).status, 201);
  const r = await postImagen(foto, { enDocumento: 40 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "tope_por_documento");
  assert.equal(r.body.error, "Un documento admite hasta 40 imágenes.");
});

test("POST: sin sesión 401, recepción (sin expediente) 403, límite por usuario 429; nada se guarda", async () => {
  const foto = await fotoJpeg(64, 64);
  sesion.ctx = null;
  assert.equal((await postImagen(foto)).status, 401);
  sesion.reiniciar();
  sesion.ctx = { userId: "u-recep", clinicId: "clinica_a", role: "RECEPTIONIST", permissionsOverride: [] };
  assert.equal((await postImagen(foto)).status, 403);
  sesion.reiniciar();
  sesion.limite = 0;
  assert.equal((await postImagen(foto)).status, 429);
  assert.equal(bucket.objetos.size, 0);
});

test("POST: la clave sale de la clínica de la SESIÓN, no de nada que mande el cliente", async () => {
  sesion.ctx = { userId: "u-doc-b", clinicId: "clinica_b", role: "DOCTOR", permissionsOverride: [] };
  const r = await postImagen(await fotoJpeg(64, 64), { nombre: "documentos/clinica_a/x.jpg" });
  assert.equal(r.status, 201);
  assert.match(r.body.clave, /^documentos\/clinica_b\//);
});

// ─────────────────────────── 3 · Camino del original (40 MB directo al bucket) ───────────────────────────

test("original: firma → PUT al bucket → procesar: 39.9 MB entra, sale webp ≤ 1600 y el original se borra", async () => {
  const foto = await jpegDeTamano(Math.floor(39.9 * MB));
  const f = await firmarOriginal({ nombre: "camara.jpg", tamano: foto.length, tipo: "image/jpeg" });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.match(f.body.id, /^[0-9a-f]{32}$/);
  assert.equal(f.body.maxBytes, 40 * MB);
  assert.deepEqual(bucket.firmasSubida, [`documentos/clinica_a/originales/${f.body.id}`], "el path lo arma el servidor con la clínica de la sesión");
  assert.equal(putFirmado(f.body.signedUrl, foto, "image/jpeg"), 200);

  const p = await procesar({ id: f.body.id, nombre: "camara.jpg" });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.match(p.body.clave, /^documentos\/clinica_a\/[0-9a-f]{32}\.webp$/);
  assert.notEqual(p.body.clave.includes(f.body.id), true, "la clave final es un id nuevo");
  assert.equal(bucket.objetos.has(`documentos/clinica_a/originales/${f.body.id}`), false, "original borrado");
  // Se apartó a su ruta propia ANTES de medir y bajar: un segundo PUT con la
  // misma URL firmada ya no puede cambiar lo que se procesa.
  const orig = `documentos/clinica_a/originales/${f.body.id}`;
  assert.deepEqual(bucket.movidas, [[orig, `${orig}.proc`]]);
  assert.deepEqual(bucket.bajadas, [`${orig}.proc`]);
  const meta = await sharp(bucket.objetos.get(p.body.clave)!.bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(Math.max(meta.width!, meta.height!) <= 1600);
  assert.equal((sesion.filas[0] as any).changes._imagen.after.camino, "original");
});

test("original: una foto de 6000×4000 que el navegador no pudo abrir también sale a 1600 px", async () => {
  const foto = await fotoJpeg(6000, 4000);
  const f = await firmarOriginal({ nombre: "IMG.jpg", tamano: foto.length, tipo: "image/jpeg" });
  putFirmado(f.body.signedUrl, foto, "image/jpeg");
  const p = await procesar({ id: f.body.id });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.deepEqual({ ancho: p.body.ancho, alto: p.body.alto }, { ancho: 1600, alto: 1067 });
});

test("original: firmar rechaza lo declarado de más de 40 MB, GIF/SVG/PDF, HEIC y nombres peligrosos — sin firmar nada", async () => {
  const casos: Array<[Record<string, unknown>, number, string]> = [
    [{ nombre: "a.jpg", tamano: Math.ceil(40.1 * MB), tipo: "image/jpeg" }, 413, "muy_pesada"],
    [{ nombre: "a.gif", tamano: 1000, tipo: "image/gif" }, 415, "tipo_no_permitido"],
    [{ nombre: "a.svg", tamano: 1000, tipo: "image/svg+xml" }, 415, "tipo_no_permitido"],
    [{ nombre: "a.pdf", tamano: 1000, tipo: "application/pdf" }, 415, "tipo_no_permitido"],
    [{ nombre: "IMG_1.HEIC", tamano: 3 * MB, tipo: "" }, 415, "heic_no_legible"],
    [{ nombre: "IMG_1.heif", tamano: 3 * MB, tipo: "image/heif" }, 415, "heic_no_legible"],
    [{ nombre: "foto.jpg.exe", tamano: 1000, tipo: "image/jpeg" }, 415, "tipo_no_permitido"],
    [{ nombre: "a.jpg", tamano: 0, tipo: "image/jpeg" }, 400, "vacia"],
    [{ nombre: "a.jpg", tamano: 1000, tipo: "image/jpeg", enDocumento: 40 }, 409, "tope_por_documento"],
  ];
  for (const [cuerpo, estado, codigo] of casos) {
    const r = await firmarOriginal(cuerpo);
    assert.equal(r.status, estado, JSON.stringify(cuerpo));
    assert.equal(r.body.code, codigo, JSON.stringify(cuerpo));
  }
  assert.deepEqual(bucket.firmasSubida, []);
  assert.equal(await firmarOriginal({ nombre: "a.jpg", tamano: 39.9 * MB, tipo: "image/jpeg" }).then((r) => r.status), 200);
});

test("original: si el cliente sube MÁS de lo que declaró (40.1 MB), se rechaza y se borra SIN bajarlo", async () => {
  const f = await firmarOriginal({ nombre: "a.jpg", tamano: 1 * MB, tipo: "image/jpeg" });
  putFirmado(f.body.signedUrl, await jpegDeTamano(Math.ceil(40.1 * MB)), "image/jpeg");
  const p = await procesar({ id: f.body.id });
  assert.equal(p.status, 413);
  assert.equal(p.body.code, "muy_pesada");
  assert.deepEqual(bucket.bajadas, [], "no se bajó nada: se midió en Storage");
  assert.equal(bucket.objetos.size, 0, "el original se borró");
});

test("original: lo que no es imagen (PDF disfrazado) se rechaza y el original se borra igual", async () => {
  const f = await firmarOriginal({ nombre: "a.jpg", tamano: 1000, tipo: "image/jpeg" });
  putFirmado(f.body.signedUrl, pdf(), "image/jpeg");
  const p = await procesar({ id: f.body.id });
  assert.equal(p.status, 415);
  assert.equal(bucket.objetos.size, 0);
});

test("original: Storage tarda en listar el objeto → se reintenta y entra", async () => {
  const foto = await fotoJpeg(300, 300);
  const f = await firmarOriginal({ nombre: "a.jpg", tamano: foto.length, tipo: "image/jpeg" });
  putFirmado(f.body.signedUrl, foto, "image/jpeg");
  bucket.listarFalla = 2;
  const p = await procesar({ id: f.body.id });
  assert.equal(p.status, 201, JSON.stringify(p.body));
});

test("original: el id de OTRA clínica (o inventado, o con ../) no encuentra nada: 404 y no toca su original", async () => {
  // clinica_b sube su original…
  sesion.ctx = { userId: "u-doc-b", clinicId: "clinica_b", role: "DOCTOR", permissionsOverride: [] };
  const foto = await fotoJpeg(64, 64);
  const f = await firmarOriginal({ nombre: "a.jpg", tamano: foto.length, tipo: "image/jpeg" });
  putFirmado(f.body.signedUrl, foto, "image/jpeg");
  // …y clinica_a intenta procesarlo con su id.
  sesion.reiniciar();
  const p = await procesar({ id: f.body.id });
  assert.equal(p.status, 404);
  assert.ok(bucket.objetos.has(`documentos/clinica_b/originales/${f.body.id}`), "el original ajeno sigue ahí");
  assert.equal((await procesar({ id: "../clinica_b/originales/x" })).status, 404);
  assert.equal((await procesar({ id: 123 })).status, 404);
});

test("original: DELETE descarta solo dentro de la carpeta de la sesión", async () => {
  const { DELETE } = await import("@/app/api/documentos/imagenes/original/route");
  const id = "c".repeat(32);
  bucket.objetos.set(`documentos/clinica_a/originales/${id}`, { bytes: Buffer.from("x"), tipo: "image/jpeg" });
  bucket.objetos.set(`documentos/clinica_b/originales/${id}`, { bytes: Buffer.from("x"), tipo: "image/jpeg" });
  const res = await DELETE(new Request(`${URL_BASE}/original?id=${id}`, { method: "DELETE" }) as any);
  assert.equal(res.status, 204);
  assert.equal(bucket.objetos.has(`documentos/clinica_a/originales/${id}`), false);
  assert.equal(bucket.objetos.has(`documentos/clinica_b/originales/${id}`), true);
  await DELETE(new Request(`${URL_BASE}/original?id=../x`, { method: "DELETE" }) as any);
  assert.deepEqual(bucket.borradas, [`documentos/clinica_a/originales/${id}`, `documentos/clinica_a/originales/${id}.proc`]);
});

// ─────────────────────────── 4 · GET /api/documentos/imagenes/[...clave] ───────────────────────────

test("GET: la imagen propia → 302 a una URL firmada de 300 s, en caché privada 4 min", async () => {
  const clave = await sembrar("clinica_a");
  const r = await verImagen([encodeURIComponent(clave)]);
  assert.equal(r.status, 302);
  assert.ok(r.location?.startsWith("https://bucket.prueba/storage/v1/object/sign/patient-files/documentos/clinica_a/"), r.location ?? "");
  assert.deepEqual(bucket.firmasLectura, [{ ruta: clave, ttl: 300 }]);
  assert.equal(r.cache, "private, max-age=240");
  // Con la clave partida en segmentos (un proxy que decodificó el %2F), igual.
  assert.equal((await verImagen(clave.split("/"))).status, 302);
});

test("GET: clave de otra clínica, con ../, doble codificada, inventada o del original → 404 sin detalles y sin firmar", async () => {
  const deB = await sembrar("clinica_b", "b".repeat(32));
  await sembrar("clinica_a");
  const id = "a".repeat(32);
  const casos = [
    [encodeURIComponent(deB)],
    deB.split("/"),
    ["documentos", "clinica_a", "..", "..", "documentos", "clinica_b", `${"b".repeat(32)}.webp`],
    [encodeURIComponent(`documentos/clinica_a/../clinica_b/${"b".repeat(32)}.webp`)],
    [encodeURIComponent(encodeURIComponent(`documentos/clinica_a/${id}.webp`))],
    [encodeURIComponent(`documentos/clinica_a/${"d".repeat(32)}.webp`)],
    [encodeURIComponent(`documentos/clinica_a/originales/${id}`)],
    ["..", "..", "etc", "passwd"],
  ];
  for (const segmentos of casos) {
    const r = await verImagen(segmentos);
    assert.equal(r.status, 404, segmentos.join("/"));
    assert.deepEqual(JSON.parse(r.texto), { error: "Imagen no encontrada" }, "el mismo cuerpo siempre");
  }
  // Solo se intentó firmar la que tenía forma y prefijo propios (y no existe).
  assert.deepEqual(bucket.firmasLectura.map((f) => f.ruta), [`documentos/clinica_a/${"d".repeat(32)}.webp`]);
});

test("GET: sin sesión 401; sin permiso de ver expediente 403; límite por usuario", async () => {
  const clave = await sembrar("clinica_a");
  sesion.ctx = null;
  assert.equal((await verImagen([encodeURIComponent(clave)])).status, 401);
  sesion.reiniciar();
  sesion.ctx = { userId: "u-ro", clinicId: "clinica_a", role: "READONLY", permissionsOverride: [] };
  assert.equal((await verImagen([encodeURIComponent(clave)])).status, 403);
  sesion.reiniciar();
  sesion.limite = 0;
  assert.equal((await verImagen([encodeURIComponent(clave)])).status, 429);
  assert.equal(sesion.llamadasLimite[0]!.scope, "documentos-imagenes-ver");
  assert.deepEqual(bucket.firmasLectura, []);
});

// ─────────────────────────── 5 · leerImagenDocumento (PDF de la ola 2) ───────────────────────────

test("leerImagenDocumento: devuelve los bytes de la propia; la de otra clínica o mal formada lanza SIN bajar nada", async () => {
  const { leerImagenDocumento, ImagenNoEncontrada } = await import("../imagenes.server");
  const propia = await sembrar("clinica_a");
  const bytes = await leerImagenDocumento("clinica_a", propia);
  assert.deepEqual(bytes, bucket.objetos.get(propia)!.bytes);
  assert.equal((await sharp(bytes).metadata()).format, "webp");

  const ajena = await sembrar("clinica_b", "b".repeat(32));
  bucket.bajadas = [];
  for (const clave of [ajena, `documentos/clinica_a/../clinica_b/${"b".repeat(32)}.webp`, "", "documentos/clinica_a/originales/" + "a".repeat(32)]) {
    await assert.rejects(leerImagenDocumento("clinica_a", clave), ImagenNoEncontrada, clave);
  }
  assert.deepEqual(bucket.bajadas, [], "nunca se bajó la ajena");
  await assert.rejects(leerImagenDocumento("clinica_a", `documentos/clinica_a/${"e".repeat(32)}.webp`), ImagenNoEncontrada, "no existe");
});

// ─────────────────────────── 6 · Copiar a otra sede ───────────────────────────

test("copiar a otra sede: las imágenes propias se copian a la carpeta de la sede nueva y el HTML sale con claves nuevas", async () => {
  const { copiarImagenesEntreClinicas } = await import("../imagenes.server");
  const a1 = await sembrar("clinica_a", "1".repeat(32));
  const a2 = await sembrar("clinica_a", "2".repeat(32));
  const ajena = await sembrar("clinica_c", "3".repeat(32));
  const html = `<p>x</p><img data-archivo="${a1}" alt=""><img data-archivo="${a2}" alt=""><img data-archivo="${a1}" alt=""><img data-archivo="${ajena}" alt="">`;
  const copia = await copiarImagenesEntreClinicas(html, "clinica_a", "clinica_nueva");

  const claves = Array.from(copia.matchAll(/data-archivo="([^"]+)"/g)).map((m) => m[1]!);
  assert.equal(claves.length, 4);
  assert.ok(claves.slice(0, 3).every((c) => claveEsDeLaClinica(c, "clinica_nueva")), claves.join(" "));
  assert.equal(claves[0], claves[2], "la misma imagen repetida se copia una vez y queda igual en los dos sitios");
  assert.notEqual(claves[0], claves[1]);
  assert.equal(claves[3], ajena, "la de otra clínica no se toca");
  assert.deepEqual(bucket.objetos.get(claves[0]!)!.bytes, bucket.objetos.get(a1)!.bytes);
  assert.ok(bucket.objetos.has(a1) && bucket.objetos.has(a2), "los originales de la sede de origen siguen ahí");
  assert.equal(await copiarImagenesEntreClinicas(html, "clinica_a", "clinica_a"), html);
});
