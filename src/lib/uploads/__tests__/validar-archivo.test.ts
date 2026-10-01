import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import JSZip from "jszip";
import {
  PERFILES,
  validarArchivo,
  sanitizarNombreArchivo,
  generarLlaveAlmacenamiento,
  tieneExtensionPeligrosa,
  pareceScriptOMarcado,
  verificarPdfPeligroso,
  cabecerasDescargaSegura,
} from "../validar-archivo";
// El validador de hojas de cálculo (.xlsx/.xls/.csv — macros, bombas zip,
// cifrado) vive en @/lib/validate-upload (compartido, NO src/lib/import/**):
// es el "punto de enchufe" que t12 dejó documentado para esta auditoría —
// aquí solo se prueba, no se duplica su lógica.
import { validateSpreadsheet } from "../../validate-upload";

// ─────────────────────────── Fixtures ───────────────────────────

async function jpegValido(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
}

async function pngValido(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 4, background: "blue" } })
    .png()
    .toBuffer();
}

function pdfMinimo(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    "latin1",
  );
}

function pdfConJs(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction 2 0 R >>\nendobj\n2 0 obj\n<< /S /JavaScript /JS (app.alert('hola')) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    "latin1",
  );
}

function ejecutableWindows(): Buffer {
  // Firma MZ + relleno.
  return Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(200, 0)]);
}

function svgConScript(): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>`,
    "utf8",
  );
}

function htmlDisfrazado(): Buffer {
  return Buffer.from(`<!doctype html><html><body><script>alert(1)</script></body></html>`, "utf8");
}

// ─────────────────────────── validarArchivo ───────────────────────────

test("acepta un JPEG real dentro del perfil FOTO_CLINICA", async () => {
  const bytes = await jpegValido();
  const r = await validarArchivo({ bytes, nombreOriginal: "foto.jpg", perfil: PERFILES.FOTO_CLINICA });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.mimeReal, "image/jpeg");
    assert.equal(r.extensionReal, "jpg");
  }
});

test("acepta un PNG real dentro del perfil LOGO_AVATAR", async () => {
  const bytes = await pngValido();
  const r = await validarArchivo({ bytes, nombreOriginal: "logo.png", perfil: PERFILES.LOGO_AVATAR });
  assert.equal(r.ok, true);
});

test("rechaza un .exe renombrado a .jpg (extensión falsa)", async () => {
  const bytes = ejecutableWindows();
  const r = await validarArchivo({ bytes, nombreOriginal: "foto.jpg", perfil: PERFILES.FOTO_CLINICA });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "ejecutable");
});

test("rechaza un SVG con <script> aunque se declare como imagen", async () => {
  const bytes = svgConScript();
  const r = await validarArchivo({ bytes, nombreOriginal: "avatar.png", perfil: PERFILES.LOGO_AVATAR });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "script_o_marcado");
});

test("rechaza HTML disfrazado de imagen", async () => {
  const bytes = htmlDisfrazado();
  const r = await validarArchivo({ bytes, nombreOriginal: "foto.jpg", perfil: PERFILES.FOTO_CLINICA });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "script_o_marcado");
});

test("rechaza un PDF con JavaScript/OpenAction embebido", async () => {
  const bytes = pdfConJs();
  const r = await validarArchivo({ bytes, nombreOriginal: "trazado.pdf", perfil: PERFILES.DOCUMENTO_PACIENTE });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "pdf_peligroso");
});

test("acepta un PDF limpio", async () => {
  const bytes = pdfMinimo();
  const r = await validarArchivo({ bytes, nombreOriginal: "documento.pdf", perfil: PERFILES.DOCUMENTO_PACIENTE });
  assert.equal(r.ok, true);
});

test("un PDF con un stream Flate MUY compresible no cuelga ni revienta memoria (bomba zlib)", async () => {
  const zlib = await import("node:zlib");
  // 30 MB de ceros comprime a unos pocos KB — si se inflara sin tope, el
  // proceso intentaría reservar 30 MB (o más con streams repetidos).
  const plano = Buffer.alloc(30 * 1024 * 1024, 0);
  const comprimido = zlib.deflateSync(plano);
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + comprimido.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
    comprimido,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF", "latin1"),
  ]);
  const antes = Date.now();
  const motivo = verificarPdfPeligroso(pdf);
  const tardanza = Date.now() - antes;
  // No debe tronar (ya no lanza) y no debe tardar más que un instante.
  assert.ok(tardanza < 5000, `tardó ${tardanza}ms — sospecha de bomba zlib sin tope`);
  // El contenido descomprimido (puros ceros) no tiene ningún marcador
  // peligroso, así que el PDF se acepta — lo que importa es que no truene.
  assert.equal(motivo, null);
});

test("no rechaza un PDF escaneado real por falsos positivos de /JS o /AA dentro de una imagen binaria embebida", async () => {
  // Simula bytes binarios "reales" (una imagen JPEG embebida sin comprimir
  // con Flate, como en un PDF escaneado con DCTDecode) que por azar podrían
  // contener la secuencia "/JS" o "/AA" en algún punto de sus 2MB.
  const relleno = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < relleno.length; i++) relleno[i] = (i * 2654435761) % 256;
  // Fuerza a propósito que la secuencia "/JS" SÍ aparezca dentro del "stream"
  // binario (para probar que ahí NO cuenta, solo fuera de streams).
  relleno.write("/JS", 12345, "latin1");
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /XObject /Filter /DCTDecode >>\nstream\n", "latin1"),
    relleno,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF", "latin1"),
  ]);
  const motivo = verificarPdfPeligroso(pdf);
  assert.equal(motivo, null, `no debería rechazar por contenido binario de un stream: ${motivo}`);
});

test("rechaza una imagen corrupta (cabecera JPEG pero contenido basura)", async () => {
  // Firma JPEG real (FF D8 FF) para pasar file-type, pero sin datos de imagen
  // válidos detrás — sharp debe tronar al decodificar.
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 0x41)]);
  const r = await validarArchivo({ bytes, nombreOriginal: "foto.jpg", perfil: PERFILES.FOTO_CLINICA });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "imagen_corrupta");
});

test("rechaza por tamaño excedido", async () => {
  const bytes = await jpegValido();
  const perfilChico = { ...PERFILES.FOTO_CLINICA, maxBytes: 10 };
  const r = await validarArchivo({ bytes, nombreOriginal: "foto.jpg", perfil: perfilChico });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "demasiado_grande");
});

test("rechaza archivo vacío", async () => {
  const r = await validarArchivo({ bytes: Buffer.alloc(0), nombreOriginal: "foto.jpg", perfil: PERFILES.FOTO_CLINICA });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "vacio");
});

test("rechaza un tipo real no permitido para el perfil (PNG en perfil solo-PDF)", async () => {
  const bytes = await pngValido();
  const soloPdf = { ...PERFILES.DOCUMENTO_PACIENTE, mimesPermitidos: ["application/pdf"] };
  const r = await validarArchivo({ bytes, nombreOriginal: "foto.png", perfil: soloPdf });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "tipo_no_permitido");
});

test("falla cerrado ante contenido no reconocible por file-type", async () => {
  const bytes = Buffer.from("este texto plano no tiene firma binaria de nada conocido 12345");
  const r = await validarArchivo({ bytes, nombreOriginal: "misterio.jpg", perfil: PERFILES.FOTO_CLINICA });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.codigo, "tipo_no_reconocido");
});

// ─────────────────────────── helpers sueltos ───────────────────────────

test("tieneExtensionPeligrosa detecta doble extensión (factura.pdf.exe)", () => {
  assert.equal(tieneExtensionPeligrosa("factura.pdf.exe"), true);
  assert.equal(tieneExtensionPeligrosa("informe.html"), true);
  assert.equal(tieneExtensionPeligrosa("radiografia.jpg"), false);
  assert.equal(tieneExtensionPeligrosa("sin_extension"), false);
});

test("pareceScriptOMarcado detecta HTML/SVG/PHP en el arranque", () => {
  assert.ok(pareceScriptOMarcado(svgConScript()));
  assert.ok(pareceScriptOMarcado(htmlDisfrazado()));
  assert.equal(pareceScriptOMarcado(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x41, 0x42])), null);
});

test("pareceScriptOMarcado NO dispara falsos positivos por '<%' en binarios reales (revisión ws1-t8)", async () => {
  // Antes de la revisión, el marcador de 2 bytes "<%" coincidía por azar en
  // ~6% de fotos JPEG legítimas. Se prueba contra 200 JPEGs reales
  // (variando el color de relleno para variar los bytes comprimidos).
  let falsos = 0;
  for (let i = 0; i < 200; i++) {
    const buf = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: i % 256, g: (i * 7) % 256, b: (i * 13) % 256 } },
    })
      .jpeg()
      .toBuffer();
    if (pareceScriptOMarcado(buf)) falsos++;
  }
  assert.equal(falsos, 0, `${falsos}/200 JPEGs reales se rechazaron por error`);
});

test("BMP no fuerza decodificación con sharp (no soportado) pero sí exige firma real", async () => {
  const perfilConBmp = { ...PERFILES.RADIOGRAFIA, mimesPermitidos: [...PERFILES.RADIOGRAFIA.mimesPermitidos, "image/bmp"] };
  // BMP mínimo válido (1x1, 24bpp, sin compresión).
  const bmp = Buffer.from(
    "424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000000000ffffff00",
    "hex",
  );
  const r = await validarArchivo({ bytes: bmp, nombreOriginal: "radiografia.bmp", perfil: perfilConBmp });
  assert.equal(r.ok, true, (r as { motivo?: string }).motivo);

  // Pero un .exe renombrado a .bmp se sigue rechazando (la firma real no es BMP).
  const falso = ejecutableWindows();
  const r2 = await validarArchivo({ bytes: falso, nombreOriginal: "radiografia.bmp", perfil: perfilConBmp });
  assert.equal(r2.ok, false);
});

test("verificarPdfPeligroso detecta /Encrypt", () => {
  const cifrado = Buffer.from("%PDF-1.4\n<< /Encrypt 3 0 R >>\n%%EOF", "latin1");
  assert.ok(verificarPdfPeligroso(cifrado));
  assert.equal(verificarPdfPeligroso(pdfMinimo()), null);
});

test("sanitizarNombreArchivo quita path traversal y caracteres raros", () => {
  assert.equal(sanitizarNombreArchivo("../../etc/passwd"), "passwd");
  assert.equal(sanitizarNombreArchivo("..\\..\\windows\\system32\\evil.exe"), "evil.exe");
  assert.equal(sanitizarNombreArchivo("foto con espacios (1).jpg"), "foto con espacios (1).jpg");
  assert.ok(!sanitizarNombreArchivo("a".repeat(500)).length || sanitizarNombreArchivo("a".repeat(500)).length <= 120);
});

test("generarLlaveAlmacenamiento nunca incluye el nombre original del cliente", () => {
  const llave = generarLlaveAlmacenamiento(["clinic123", "patient456"], "jpg");
  assert.ok(llave.startsWith("clinic123/patient456/"));
  assert.ok(llave.endsWith(".jpg"));
  assert.equal(llave.includes(".."), false);
});

test("generarLlaveAlmacenamiento sanea segmentos con caracteres de path traversal", () => {
  const llave = generarLlaveAlmacenamiento(["../otra-clinica", "paciente"], "pdf");
  assert.equal(llave.includes(".."), false);
  assert.equal(llave.includes("/otra-clinica"), false);
});

// ───────────────── .xlsm / macros (validateSpreadsheet, compartido con t12) ─────────────────

test("validateSpreadsheet rechaza un .xlsx con macro (xl/vbaProject.bin)", async () => {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("xl/vbaProject.bin", Buffer.alloc(20));
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const err = await validateSpreadsheet((bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), "xlsx");
  assert.ok(err);
  assert.match(err!, /macro/i);
});

test("validateSpreadsheet acepta un .xlsx real sin macros", async () => {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", "<workbook/>");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const err = await validateSpreadsheet((bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), "xlsx");
  assert.equal(err, null);
});

test("validateSpreadsheet rechaza un .xlsx cifrado/protegido (contenedor OLE2)", async () => {
  const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(40)]);
  const arr = cfb.buffer.slice(cfb.byteOffset, cfb.byteOffset + cfb.byteLength);
  const err = await validateSpreadsheet(arr, "xlsx");
  assert.ok(err);
  assert.match(err!, /cifrad|protegid/i);
});

test("cabecerasDescargaSegura fuerza attachment para lo que no es imagen/pdf y siempre manda nosniff", () => {
  const img = cabecerasDescargaSegura({ mimeReal: "image/jpeg", nombreSaneado: "foto.jpg" });
  assert.equal(img["X-Content-Type-Options"], "nosniff");
  assert.ok(img["Content-Disposition"].startsWith("inline"));

  const zip = cabecerasDescargaSegura({ mimeReal: "application/zip", nombreSaneado: "set.zip" });
  assert.ok(zip["Content-Disposition"].startsWith("attachment"));

  const forzado = cabecerasDescargaSegura({ mimeReal: "application/pdf", nombreSaneado: "x.pdf", forzarDescarga: true });
  assert.ok(forzado["Content-Disposition"].startsWith("attachment"));
});

// ─────────── Artículo del mensaje (ws1-t9): «una radiografía», no «un radiografía» ───────────

test("el rechazo concuerda en género: «no una radiografía…» y «no un documento…»", async () => {
  const exe = await validarArchivo({ bytes: ejecutableWindows(), nombreOriginal: "rx.png", perfil: PERFILES.RADIOGRAFIA });
  assert.equal(exe.ok, false);
  if (exe.ok === false) {
    assert.match(exe.motivo, /, no una radiografía o archivo clínico$/);
    assert.doesNotMatch(exe.motivo, /no un radiograf/);
  }
  const svg = await validarArchivo({ bytes: Buffer.from(`<svg><script>1</script></svg>`), nombreOriginal: "f.png", perfil: PERFILES.FOTO_CLINICA });
  if (svg.ok === false) assert.match(svg.motivo, /, no una foto clínica$/);
  const doc = await validarArchivo({ bytes: ejecutableWindows(), nombreOriginal: "d.png", perfil: PERFILES.DOCUMENTO_PACIENTE });
  if (doc.ok === false) assert.match(doc.motivo, /, no un documento del paciente$/);
});

test("FOTO_CLINICA rechaza un JPG truncado (cabecera válida, cuerpo cortado) con motivo claro", async () => {
  const entero = await sharp(randomBytes(400 * 400 * 3), { raw: { width: 400, height: 400, channels: 3 } }).jpeg().toBuffer();
  const truncado = entero.subarray(0, Math.floor(entero.length / 3));
  const r = await validarArchivo({ bytes: truncado, nombreOriginal: "foto.jpg", perfil: PERFILES.FOTO_CLINICA });
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.codigo, "imagen_corrupta");
    assert.match(r.motivo, /corrupta/);
  }
});
