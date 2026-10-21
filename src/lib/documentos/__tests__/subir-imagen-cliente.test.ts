/**
 * subirImagenDocumento (el `onSubirImagen` del editor) de punta a punta.
 *
 * Run: npm run test:documentos-imagenes
 *
 * El navegador se dobla en lo mínimo —`createImageBitmap`, el `<canvas>` (que
 * redimensiona con sharp), `XMLHttpRequest` y `fetch`— y las peticiones llegan
 * a los HANDLERS REALES de /api/documentos/imagenes con el bucket en memoria de
 * ./dobles. Fija qué camino toma cada foto:
 *   · el navegador la abre → se comprime aquí y viaja < 4 MB por la ruta;
 *   · no la abre (foto enorme, formato raro) → el original va directo al bucket;
 *   · HEIC que no abre → mensaje claro y CERO peticiones;
 *   · > 40 MB, GIF/SVG/PDF, tope de 40 → mensaje claro y cero peticiones;
 *   · cancelar a media subida limpia el bucket.
 * El comportamiento real de Chromium (decodificar y codificar webp de verdad)
 * se midió aparte, con el navegador; ver el reporte de ws1-t6.
 */
import "./dobles";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { bucket, putFirmado, sesion } from "./dobles";
import { TOPE_CUERPO_RUTA } from "../imagenes";

const MB = 1024 * 1024;

// ─────────────────────────── El «navegador» ───────────────────────────

const nav = {
  /** "abre": decodifica todo; "no-abre": createImageBitmap lanza (HEIC en Chrome, foto que no cabe en memoria). */
  decodifica: "abre" as "abre" | "no-abre",
  /** Safari: toBlob("image/webp") devuelve png (no codifica webp). */
  sinWebp: false,
  peticiones: [] as Array<{ metodo: string; url: string; bytes: number; tipo?: string }>,
  /** Cuántos PUT al bucket fallan por red antes de funcionar. */
  putFallan: 0,
  /** Se llama justo cuando empieza el PUT (para cancelar a media subida). */
  alEmpezarPut: null as null | (() => void),
  reiniciar() {
    this.decodifica = "abre";
    this.sinWebp = false;
    this.peticiones = [];
    this.putFallan = 0;
    this.alEmpezarPut = null;
  },
};

const ORIGEN = "http://localhost";

async function aHandler(metodo: string, url: string, init: { body?: BodyInit | null; headers?: HeadersInit }): Promise<Response> {
  const ruta = new URL(url, ORIGEN).pathname;
  // Como un navegador: el multipart armado y con su Content-Length.
  let body = init.body ?? null;
  const headers = new Headers(init.headers);
  if (body instanceof FormData) {
    const armado = new Response(body);
    body = new Uint8Array(await armado.arrayBuffer());
    headers.set("content-type", armado.headers.get("content-type")!);
  }
  if (body !== null) headers.set("content-length", String(await largoDe(body)));
  const req = new Request(new URL(url, ORIGEN), { method: metodo, body, headers }) as any;
  if (ruta === "/api/documentos/imagenes" && metodo === "POST") return (await import("@/app/api/documentos/imagenes/route")).POST(req);
  if (ruta === "/api/documentos/imagenes/original" && metodo === "POST") return (await import("@/app/api/documentos/imagenes/original/route")).POST(req);
  if (ruta === "/api/documentos/imagenes/original" && metodo === "DELETE") return (await import("@/app/api/documentos/imagenes/original/route")).DELETE(req);
  if (ruta === "/api/documentos/imagenes/original/procesar") return (await import("@/app/api/documentos/imagenes/original/procesar/route")).POST(req);
  throw new Error(`ruta inesperada: ${metodo} ${url}`);
}

const largoDe = async (body: unknown): Promise<number> =>
  body instanceof Blob ? body.size
  : body instanceof Uint8Array ? body.byteLength
  : body instanceof FormData ? (await new Response(body).arrayBuffer()).byteLength
  : Buffer.byteLength(String(body ?? ""));

(globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
  nav.peticiones.push({ metodo: init.method ?? "GET", url, bytes: await largoDe(init.body) });
  if (init.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  return aHandler(init.method ?? "GET", url, init as any);
};

class XHRDoble {
  status = 0;
  responseText = "";
  upload: { onprogress: null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) } = { onprogress: null };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  onabort: null | (() => void) = null;
  private metodo = "";
  private url = "";
  private cabeceras: Record<string, string> = {};
  private abortada = false;
  open(metodo: string, url: string) {
    this.metodo = metodo;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.cabeceras[k.toLowerCase()] = v;
  }
  abort() {
    if (this.abortada) return;
    this.abortada = true;
    queueMicrotask(() => this.onabort?.());
  }
  send(body: Blob | FormData) {
    void (async () => {
      const total = await largoDe(body);
      nav.peticiones.push({ metodo: this.metodo, url: this.url, bytes: total, tipo: this.cabeceras["content-type"] });
      if (this.metodo === "PUT") {
        nav.alEmpezarPut?.();
        await new Promise((r) => setTimeout(r, 5));
        if (this.abortada) return;
        if (nav.putFallan > 0) {
          nav.putFallan--;
          return this.onerror?.();
        }
        this.upload.onprogress?.({ lengthComputable: true, loaded: total / 2, total });
        this.upload.onprogress?.({ lengthComputable: true, loaded: total, total });
        this.status = putFirmado(this.url, Buffer.from(await (body as Blob).arrayBuffer()), this.cabeceras["content-type"] ?? "");
        return this.onload?.();
      }
      this.upload.onprogress?.({ lengthComputable: true, loaded: total, total });
      const res = await aHandler(this.metodo, this.url, { body });
      if (this.abortada) return;
      this.status = res.status;
      this.responseText = await res.text();
      this.onload?.();
    })();
  }
}
(globalThis as any).XMLHttpRequest = XHRDoble;

/** «Mapa de bits»: guarda los bytes del archivo para que el lienzo los redimensione con sharp. */
(globalThis as any).createImageBitmap = async (file: Blob) => {
  if (nav.decodifica === "no-abre") throw new DOMException("The source image could not be decoded.", "InvalidStateError");
  const bytes = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(bytes).rotate().metadata();
  const girada = (meta.orientation ?? 1) >= 5;
  return { width: girada ? meta.height : meta.width, height: girada ? meta.width : meta.height, bytes, close() {} };
};

(globalThis as any).document = {
  createElement(etiqueta: string) {
    assert.equal(etiqueta, "canvas");
    let origen: Buffer | null = null;
    const lienzo = {
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        globalCompositeOperation: "source-over",
        fillStyle: "",
        drawImage: (mapa: { bytes: Buffer }) => {
          origen = mapa.bytes;
        },
        fillRect: () => undefined,
      }),
      toBlob(cb: (b: Blob | null) => void, tipo: string, calidad: number) {
        const formato = tipo === "image/webp" && !nav.sinWebp ? "webp" : tipo === "image/jpeg" ? "jpeg" : "png";
        void sharp(origen!)
          .rotate()
          .resize(lienzo.width, lienzo.height, { fit: "fill" })
          .toFormat(formato, { quality: Math.round(calidad * 100) })
          .toBuffer()
          .then((b) => cb(new Blob([new Uint8Array(b)], { type: `image/${formato}` })));
      },
    };
    return lienzo;
  },
};

beforeEach(() => {
  bucket.reiniciar();
  sesion.reiniciar();
  nav.reiniciar();
});

const subir = async (...a: Parameters<typeof import("../subir-imagen.client").subirImagenDocumento>) =>
  (await import("../subir-imagen.client")).subirImagenDocumento(...a);

const foto = (ancho: number, alto: number) =>
  sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: "gaussian", mean: 128, sigma: 50 } } }).jpeg({ quality: 92 }).toBuffer();

async function jpegDeTamano(bytes: number): Promise<Buffer> {
  const base = await foto(1200, 900);
  return Buffer.concat([base, Buffer.alloc(bytes - base.length)]);
}

const archivo = (bytes: Buffer, nombre: string, tipo: string) => new File([new Uint8Array(bytes)], nombre, { type: tipo });

/** Un File del tamaño pedido sin reservar los bytes de verdad (para los rechazos que no leen el contenido). */
const archivoDeTamano = (size: number, nombre: string, tipo: string) => {
  const f = new File([new Uint8Array(1)], nombre, { type: tipo });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

// ─────────────────────────── Camino normal ───────────────────────────

test("foto de cámara que el navegador abre: se comprime AQUÍ y viaja < 4 MB por la ruta; progreso 0 → 100", async () => {
  const original = await foto(6000, 4000);
  const progreso: number[] = [];
  const r = await subir(archivo(original, "IMG_2041.JPG", "image/jpeg"), { onProgreso: (p) => progreso.push(p) });

  assert.match(r.clave, /^documentos\/clinica_a\/[0-9a-f]{32}\.webp$/);
  assert.deepEqual({ ancho: r.ancho, alto: r.alto }, { ancho: 1600, alto: 1067 });
  assert.deepEqual(nav.peticiones.map((p) => `${p.metodo} ${p.url}`), ["POST /api/documentos/imagenes"], "un solo viaje, sin el camino del original");
  assert.ok(nav.peticiones[0]!.bytes < TOPE_CUERPO_RUTA, `viajaron ${nav.peticiones[0]!.bytes} B`);
  assert.ok(nav.peticiones[0]!.bytes < original.length / 3, "viajó comprimida, no el original");
  assert.equal(progreso[0], 0);
  assert.equal(progreso.at(-1), 100);
  assert.deepEqual([...progreso].sort((a, b) => a - b), progreso, "el progreso nunca retrocede");
  assert.equal((await sharp(bucket.objetos.get(r.clave)!.bytes).metadata()).format, "webp");
});

test("Safari que no codifica webp: viaja en jpeg y el servidor la guarda en webp", async () => {
  nav.sinWebp = true;
  const r = await subir(archivo(await foto(3024, 4032), "IMG.jpg", "image/jpeg"));
  const fd = nav.peticiones[0]!;
  assert.equal(fd.url, "/api/documentos/imagenes");
  assert.deepEqual({ ancho: r.ancho, alto: r.alto }, { ancho: 1200, alto: 1600 });
  assert.equal((await sharp(bucket.objetos.get(r.clave)!.bytes).metadata()).format, "webp");
});

// ─────────────────────────── Camino del original ───────────────────────────

test("foto de 39.9 MB que el navegador NO abre: el original va directo al bucket y el servidor la comprime", async () => {
  nav.decodifica = "no-abre";
  const original = await jpegDeTamano(Math.floor(39.9 * MB));
  const progreso: number[] = [];
  const r = await subir(archivo(original, "camara.jpg", "image/jpeg"), { onProgreso: (p) => progreso.push(p) });

  const pasos = nav.peticiones.map((p) => `${p.metodo} ${p.url.replace(/originales\/[0-9a-f]+/, "originales/<id>").replace(/\?.*$/, "")}`);
  assert.deepEqual(pasos, [
    "POST /api/documentos/imagenes/original",
    "PUT https://bucket.prueba/storage/v1/object/upload/sign/patient-files/documentos/clinica_a/originales/<id>",
    "POST /api/documentos/imagenes/original/procesar",
  ]);
  assert.equal(nav.peticiones[1]!.bytes, original.length, "los 39.9 MB fueron al BUCKET, no a la ruta");
  assert.ok(nav.peticiones.filter((p) => p.url.startsWith("/api")).every((p) => p.bytes < 4096), "a las rutas solo viaja JSON");
  assert.match(r.clave, /^documentos\/clinica_a\/[0-9a-f]{32}\.webp$/);
  assert.deepEqual(Array.from(bucket.objetos.keys()), [r.clave], "el original ya no está");
  assert.equal(progreso.at(-1), 100);
  assert.deepEqual([...progreso].sort((a, b) => a - b), progreso);
});

test("un corte de red en el PUT se reintenta una vez", async () => {
  nav.decodifica = "no-abre";
  nav.putFallan = 1;
  const r = await subir(archivo(await foto(800, 600), "a.png", "image/png"));
  assert.equal(nav.peticiones.filter((p) => p.metodo === "PUT").length, 2);
  assert.ok(bucket.objetos.has(r.clave));
});

test("cancelar a media subida del original: SubidaImagenCancelada y el bucket queda limpio", async () => {
  nav.decodifica = "no-abre";
  const control = new AbortController();
  nav.alEmpezarPut = () => control.abort();
  const { SubidaImagenCancelada } = await import("../subir-imagen.client");
  await assert.rejects(subir(archivo(await foto(800, 600), "a.jpg", "image/jpeg"), { signal: control.signal }), SubidaImagenCancelada);
  // El DELETE sale con keepalive; se le da un instante.
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(nav.peticiones.some((p) => p.metodo === "DELETE" && p.url.startsWith("/api/documentos/imagenes/original?id=")));
  assert.equal(bucket.objetos.size, 0);
});

test("si procesar ni llega a correr (límite, sesión), el navegador descarta el original: no queda huérfano", async () => {
  nav.decodifica = "no-abre";
  sesion.bloqueados.add("documentos-imagenes-procesar");
  await assert.rejects(subir(archivo(await foto(800, 600), "a.jpg", "image/jpeg")), { message: "Demasiados intentos. Intenta de nuevo más tarde." });
  assert.ok(nav.peticiones.some((p) => p.metodo === "DELETE"), "se pidió descartar");
  assert.equal(bucket.objetos.size, 0, "el original no se quedó en el bucket");
});

test("WebKit viejo: createImageBitmap rechaza la OPCIÓN (TypeError) → se reintenta sin opciones y entra por el camino normal", async () => {
  const real = (globalThis as any).createImageBitmap;
  (globalThis as any).createImageBitmap = async (f: Blob, o?: unknown) => {
    if (o) throw new TypeError("The provided value 'from-image' is not a valid enum value of type ImageOrientation.");
    return real(f);
  };
  try {
    const r = await subir(archivo(await foto(2000, 1000), "a.jpg", "image/jpeg"));
    assert.deepEqual({ ancho: r.ancho, alto: r.alto }, { ancho: 1600, alto: 800 });
    assert.deepEqual(nav.peticiones.map((p) => p.url), ["/api/documentos/imagenes"]);
  } finally {
    (globalThis as any).createImageBitmap = real;
  }
});

// ─────────────────────────── Rechazos sin subir nada ───────────────────────────

test("HEIC que el navegador no abre (Chrome de escritorio): mensaje claro y CERO peticiones", async () => {
  nav.decodifica = "no-abre";
  const { ErrorImagenDocumento } = await import("../subir-imagen.client");
  for (const f of [archivoDeTamano(3 * MB, "IMG_0001.HEIC", ""), archivoDeTamano(3 * MB, "IMG_0001.heic", "image/heic")]) {
    await assert.rejects(subir(f), (e: unknown) => {
      assert.ok(e instanceof ErrorImagenDocumento);
      assert.equal(e.codigo, "heic_no_legible");
      assert.equal(e.message, "Este navegador no puede abrir fotos HEIC. Súbela desde el iPhone o desde Safari, o guárdala como JPG.");
      return true;
    });
  }
  assert.deepEqual(nav.peticiones, []);
});

test("más de 40 MB, GIF, SVG, PDF y el tope de 40: mensaje en español y cero peticiones", async () => {
  const casos: Array<[File, string, number | undefined]> = [
    [archivoDeTamano(Math.ceil(40.1 * MB), "grande.jpg", "image/jpeg"), "La imagen pesa más de 40 MB.", undefined],
    [archivoDeTamano(1000, "a.gif", "image/gif"), "Solo fotos JPG, PNG, WEBP o HEIC.", undefined],
    [archivoDeTamano(1000, "a.svg", "image/svg+xml"), "Solo fotos JPG, PNG, WEBP o HEIC.", undefined],
    [archivoDeTamano(1000, "a.pdf", "application/pdf"), "Solo fotos JPG, PNG, WEBP o HEIC.", undefined],
    [archivoDeTamano(1000, "a.jpg", "image/jpeg"), "Un documento admite hasta 40 imágenes.", 40],
  ];
  for (const [f, mensaje, enDocumento] of casos) {
    await assert.rejects(subir(f, { enDocumento }), { message: mensaje }, f.name);
  }
  assert.deepEqual(nav.peticiones, []);
  // 39.9 MB sí se intenta (y entra por el camino del original si no se abre).
  nav.decodifica = "no-abre";
  const r = await subir(archivo(await jpegDeTamano(Math.floor(39.9 * MB)), "ok.jpg", "image/jpeg"));
  assert.ok(bucket.objetos.has(r.clave));
});

test("errores del servidor llegan con mensaje: sesión vencida, sin permiso, contenido que no es imagen", async () => {
  const { ErrorImagenDocumento } = await import("../subir-imagen.client");
  sesion.ctx = null;
  await assert.rejects(subir(archivo(await foto(100, 100), "a.jpg", "image/jpeg")), { message: "Tu sesión terminó. Vuelve a entrar e inténtalo otra vez." });
  sesion.reiniciar();
  sesion.ctx = { userId: "u-recep", clinicId: "clinica_a", role: "RECEPTIONIST", permissionsOverride: [] };
  await assert.rejects(subir(archivo(await foto(100, 100), "a.jpg", "image/jpeg")), (e: unknown) => {
    assert.ok(e instanceof ErrorImagenDocumento);
    assert.equal(e.estado, 403);
    assert.match(e.message, /No tienes permiso/);
    return true;
  });
  // Un PDF renombrado .jpg que el navegador «no abre»: va como original y el servidor lo rechaza por los bytes.
  sesion.reiniciar();
  nav.decodifica = "no-abre";
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");
  await assert.rejects(subir(archivo(pdf, "foto.jpg", "image/jpeg")), { message: "Solo fotos JPG, PNG, WEBP o HEIC." });
  assert.equal(bucket.objetos.size, 0, "y el original se borró");
});
