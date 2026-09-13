/**
 * LA CABECERA COMÚN DE LOS PDF — piezas puras y descarga del logo (WS1-T2).
 *
 * Run: npm run test:pdf-cabecera
 *
 * Por qué existe: los cuatro documentos que se entregan a alguien (comprobante,
 * nota clínica, orden de laboratorio y carta de referencia) salían sin ninguna
 * identidad de clínica, y el logo es una URL REMOTA. Ahí las cosas fallan de un
 * modo que no salta compilando:
 *   · el bucket tarda, devuelve 404 o se cae  → el PDF tiene que salir IGUAL;
 *   · el logo viene apaisado o vertical       → no se puede deformar;
 *   · la clínica no tiene logo                → manda el nombre, nunca un hueco;
 *   · el nombre es larguísimo                 → parte, no empuja nada fuera.
 *
 * Estas pruebas cubren las piezas puras y la descarga contra un servidor HTTP
 * de verdad (levantado aquí mismo), que es la única forma honesta de probar un
 * 404, un formato que @react-pdf no sabe pintar, y un servidor mudo.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { makePng, makeJpeg, WEBP, GIF, SVG } from "./_imagenes-de-prueba";
import {
  logoBox,
  clinicNameFontSize,
  clinicLetterheadLines,
  brandColumnWidth,
  CLINIC_LETTERHEAD_SELECT,
  imageAspect,
  fetchClinicLogo,
  LOGO_MAX_H,
  LOGO_MAX_W,
} from "../clinic-letterhead";

// ── logoBox: proporciones ──────────────────────────────────────────────

describe("logoBox — el logo nunca se deforma ni desborda", () => {
  const casos: Array<[string, number]> = [
    ["cuadrado 400×400", 1],
    ["apaisado 800×200", 4],
    ["vertical 200×600", 1 / 3],
    ["pancarta 2000×100", 20],
    ["columna 100×2000", 0.05],
  ];

  for (const [nombre, aspect] of casos) {
    it(`${nombre}: conserva la proporción y cabe en la caja`, () => {
      const box = logoBox(aspect);
      // La proporción de salida es la de entrada: no se estira ni se aplasta.
      assert.ok(
        Math.abs(box.width / box.height - aspect) < 0.02,
        `proporción rota: ${box.width}×${box.height} para aspect ${aspect}`,
      );
      assert.ok(box.width <= LOGO_MAX_W + 0.01, `se pasa de ancho: ${box.width}`);
      assert.ok(box.height <= LOGO_MAX_H + 0.01, `se pasa de alto: ${box.height}`);
      assert.ok(box.width > 0 && box.height > 0);
    });
  }

  it("sin proporción se asume cuadrado — la caja de hoy, 44×44", () => {
    assert.deepEqual(logoBox(null), { width: LOGO_MAX_H, height: LOGO_MAX_H });
    assert.deepEqual(logoBox(undefined), { width: LOGO_MAX_H, height: LOGO_MAX_H });
  });

  it("una proporción absurda (0, negativa, NaN) no rompe la caja", () => {
    for (const malo of [0, -3, NaN, Infinity]) {
      const box = logoBox(malo);
      assert.ok(box.width > 0 && box.height > 0, `caja inválida con ${malo}`);
      assert.ok(box.width <= LOGO_MAX_W && box.height <= LOGO_MAX_H);
    }
  });

  it("el apaisado aprovecha el ancho en vez de quedarse en una tira de 11 pt", () => {
    // Antes, con la caja fija de 44×44 de consentimiento/receta/presupuesto, un
    // logo 4:1 salía a 44×11 y no se leía. Ahora ocupa el ancho disponible.
    const box = logoBox(4);
    assert.equal(box.width, LOGO_MAX_W);
    assert.ok(box.height > 30, `demasiado bajo: ${box.height}`);
  });
});

// ── brandColumnWidth: el tope que hace que el nombre PARTA ─────────────

describe("brandColumnWidth — sin este tope el nombre se monta encima del folio", () => {
  it("descuenta el logo y su hueco del ancho disponible", () => {
    // Logo apaisado a tope (132): al texto le quedan 340 − 132 − 10 = 198.
    assert.equal(brandColumnWidth(logoBox(4).width), 198);
    // Logo cuadrado (44): le quedan 286, mucho más sitio para el nombre.
    assert.equal(brandColumnWidth(logoBox(1).width), 286);
  });

  it("sin logo el nombre dispone de todo el bloque izquierdo", () => {
    assert.equal(brandColumnWidth(null), brandColumnWidth(0));
    assert.ok(brandColumnWidth(null) > brandColumnWidth(logoBox(4).width));
  });

  it("nunca deja una columna tan estrecha que el nombre parta por sílabas", () => {
    // Ningún logo posible puede dejar el texto por debajo de este suelo.
    for (const aspect of [1, 4, 20, 1 / 3, 0.05]) {
      assert.ok(brandColumnWidth(logoBox(aspect).width) >= 120);
    }
  });

  it("el ancho total nunca se sale de la caja izquierda", () => {
    for (const aspect of [1, 4, 20, 1 / 3]) {
      const w = logoBox(aspect).width;
      assert.ok(w + 10 + brandColumnWidth(w) <= 340 + 0.01);
    }
  });
});

// ── clinicNameFontSize: nombres largos ─────────────────────────────────

describe("clinicNameFontSize — el nombre manda cuando no hay logo", () => {
  const CORTO = "Clínica Sonrisa";
  const LARGO = "Clínica Dental y Especialidades del Valle de Guadalupe";

  it("sin logo el nombre sale MÁS GRANDE que con logo", () => {
    assert.ok(clinicNameFontSize(CORTO, false) > clinicNameFontSize(CORTO, true));
    assert.ok(clinicNameFontSize(LARGO, false) > clinicNameFontSize(LARGO, true));
  });

  it("un nombre largo baja de tamaño para caber", () => {
    assert.ok(clinicNameFontSize(LARGO, false) < clinicNameFontSize(CORTO, false));
    assert.ok(clinicNameFontSize(LARGO, true) < clinicNameFontSize(CORTO, true));
  });

  it("nunca baja tanto que deje de leerse", () => {
    const absurdo = "Clínica " + "Muy Larga ".repeat(40);
    assert.ok(clinicNameFontSize(absurdo, true) >= 11);
    assert.ok(clinicNameFontSize(absurdo, false) >= 11);
  });

  it("aguanta nombre vacío sin reventar", () => {
    assert.ok(clinicNameFontSize("", true) > 0);
    assert.ok(clinicNameFontSize(null as unknown as string, false) > 0);
  });
});

// ── clinicLetterheadLines: los datos ───────────────────────────────────

describe("clinicLetterheadLines — dirección, teléfono y fiscal", () => {
  it("la calle en un renglón y la ciudad con el estado en el siguiente", () => {
    // Juntos no caben en la columna de 198 pt que queda junto a un logo ancho:
    // @react-pdf los partía con guion ("Guadalajara, Jalis-co").
    const l = clinicLetterheadLines({
      clinicName: "X",
      clinicAddress: "Av. Juárez 1234, Col. Americana",
      clinicCity: "Guadalajara",
      clinicState: "Jalisco",
    });
    assert.equal(l[0], "Av. Juárez 1234, Col. Americana");
    assert.equal(l[1], "Guadalajara, Jalisco");
  });

  it("teléfono y correo van juntos, con el Tel: delante", () => {
    const l = clinicLetterheadLines({
      clinicName: "X",
      clinicPhone: "33 1234 5678",
      clinicEmail: "hola@clinica.mx",
    });
    assert.equal(l[0], "Tel: 33 1234 5678 · hola@clinica.mx");
  });

  it("los campos vacíos no dejan comas ni puntos sueltos", () => {
    const l = clinicLetterheadLines({
      clinicName: "X",
      clinicAddress: null,
      clinicCity: "Mérida",
      clinicState: null,
      clinicPhone: null,
      clinicEmail: "hola@clinica.mx",
    });
    assert.deepEqual(l, ["Mérida", "hola@clinica.mx"]);
  });

  it("el RFC solo sale donde el documento lo pide", () => {
    const base = { clinicName: "X", clinicPhone: "55 0000 0000" };
    assert.ok(!clinicLetterheadLines(base).some((l) => l.includes("RFC")));
    assert.ok(
      clinicLetterheadLines({ ...base, clinicTaxId: "XAXX010101000" }).includes(
        "RFC: XAXX010101000",
      ),
    );
  });

  it("una clínica sin ningún dato no genera renglones vacíos", () => {
    assert.deepEqual(clinicLetterheadLines({ clinicName: "Clínica Sonrisa" }), []);
  });
});

// ── CLINIC_LETTERHEAD_SELECT: el contrato con Prisma ───────────────────

describe("CLINIC_LETTERHEAD_SELECT — sin logoUrl no hay logo posible", () => {
  it("pide exactamente lo que la cabecera sabe pintar", () => {
    assert.deepEqual(CLINIC_LETTERHEAD_SELECT, {
      name: true,
      address: true,
      city: true,
      state: true,
      phone: true,
      email: true,
      logoUrl: true,
    });
  });
});

// ── imageAspect: qué es de verdad una imagen pintable ──────────────────

describe("imageAspect — solo pasan PNG y JPEG", () => {
  it("lee la proporción real de un PNG", () => {
    assert.equal(imageAspect(makePng(400, 400)), 1);
    assert.equal(imageAspect(makePng(800, 200)), 4);
    assert.ok(Math.abs(imageAspect(makePng(200, 600))! - 1 / 3) < 1e-9);
  });

  it("lee la proporción real de un JPEG", () => {
    assert.equal(imageAspect(makeJpeg(600, 300)), 2);
  });

  it("descarta webp, gif y svg — @react-pdf no los pinta y dejaría un hueco", () => {
    assert.equal(imageAspect(WEBP), null);
    assert.equal(imageAspect(GIF), null);
    assert.equal(imageAspect(SVG), null);
  });

  it("descarta basura: HTML de error, vacío, truncado", () => {
    assert.equal(imageAspect(Buffer.from("<!doctype html><h1>404</h1>")), null);
    assert.equal(imageAspect(Buffer.alloc(0)), null);
    assert.equal(imageAspect(makePng(100, 100).subarray(0, 12)), null);
  });
});

// ── fetchClinicLogo: contra un servidor HTTP de verdad ─────────────────

describe("fetchClinicLogo — el PDF sale aunque el logo no", () => {
  let base = "";
  let server: http.Server;
  /** Sockets del caso "servidor mudo": hay que soltarlos al cerrar. */
  const colgados: import("node:net").Socket[] = [];

  before(async () => {
    server = http.createServer((req, res) => {
      const ruta = req.url ?? "/";
      if (ruta === "/ok.png") {
        const png = makePng(800, 200);
        res.writeHead(200, { "content-type": "image/png", "content-length": png.length });
        return res.end(png);
      }
      if (ruta === "/ok.jpg") {
        const jpg = makeJpeg(300, 300);
        res.writeHead(200, { "content-type": "image/jpeg" });
        return res.end(jpg);
      }
      if (ruta === "/octet.png") {
        // Bucket mal configurado: los BYTES son un PNG válido aunque el
        // content-type mienta. Eso sí vale: lo que decide son los bytes.
        const png = makePng(400, 400);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(png);
      }
      if (ruta === "/logo.webp") {
        res.writeHead(200, { "content-type": "image/webp" });
        return res.end(WEBP);
      }
      if (ruta === "/logo.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        return res.end(SVG);
      }
      if (ruta === "/mentiroso.png") {
        // Se anuncia como imagen y devuelve el HTML de error del bucket.
        res.writeHead(200, { "content-type": "image/png" });
        return res.end("<!doctype html><h1>NoSuchKey</h1>");
      }
      if (ruta === "/enorme.png") {
        const png = makePng(3000, 3000);
        res.writeHead(200, { "content-type": "image/png", "content-length": 9_000_000 });
        return res.end(png);
      }
      if (ruta === "/mudo.png") {
        // Nunca responde: es el bucket que "tarda".
        colgados.push(res.socket!);
        return;
      }
      if (ruta === "/500.png") {
        res.writeHead(500);
        return res.end("boom");
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no such key");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    for (const s of colgados) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("un PNG bueno vuelve como data URL con su proporción", async () => {
    const logo = await fetchClinicLogo(`${base}/ok.png`, 2000);
    assert.ok(logo, "debería haber logo");
    assert.match(logo!.dataUrl, /^data:image\/png;base64,/);
    assert.equal(logo!.aspect, 4);
  });

  it("un JPEG bueno también", async () => {
    const logo = await fetchClinicLogo(`${base}/ok.jpg`, 2000);
    assert.ok(logo);
    assert.match(logo!.dataUrl, /^data:image\/jpeg;base64,/);
    assert.equal(logo!.aspect, 1);
  });

  it("un bucket que sirve octet-stream no pierde su logo: mandan los bytes", async () => {
    const logo = await fetchClinicLogo(`${base}/octet.png`, 2000);
    assert.ok(logo, "un PNG válido no se descarta por el content-type");
    assert.equal(logo!.aspect, 1);
  });

  // Éstos son EL punto de la tarea: ninguno puede lanzar, todos devuelven null,
  // y con null la cabecera pinta el nombre en grande.
  const rotos: Array<[string, string]> = [
    ["404 del bucket", "/no-existe.png"],
    ["500 del bucket", "/500.png"],
    ["webp: @react-pdf no lo pinta", "/logo.webp"],
    ["svg: @react-pdf no lo pinta", "/logo.svg"],
    ["se dice PNG y manda HTML", "/mentiroso.png"],
    ["pesa más de la cuenta", "/enorme.png"],
  ];
  for (const [nombre, ruta] of rotos) {
    it(`${nombre} → null, sin lanzar`, async () => {
      assert.equal(await fetchClinicLogo(`${base}${ruta}`, 2000), null);
    });
  }

  it("servidor mudo → null en cuanto vence el plazo, no se queda colgado", async () => {
    const t0 = Date.now();
    assert.equal(await fetchClinicLogo(`${base}/mudo.png`, 300), null);
    assert.ok(Date.now() - t0 < 3000, "el plazo no cortó la espera");
  });

  it("puerto cerrado (bucket caído) → null", async () => {
    assert.equal(await fetchClinicLogo("http://127.0.0.1:1/logo.png", 1000), null);
  });

  it("sin logoUrl, o con algo que no es http, → null y ni se intenta", async () => {
    assert.equal(await fetchClinicLogo(null), null);
    assert.equal(await fetchClinicLogo(undefined), null);
    assert.equal(await fetchClinicLogo(""), null);
    assert.equal(await fetchClinicLogo("file:///etc/passwd"), null);
    assert.equal(await fetchClinicLogo("logos/clinica.png"), null);
  });
});
