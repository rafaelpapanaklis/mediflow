/**
 * Bloqueo de los cargadores HEIF y `.vips` de sharp (ws1-t12, auditoría H4).
 *
 * Se arranca como lo hace el servidor: `register()` de src/instrumentation.ts
 * con NEXT_RUNTIME=nodejs. El bloqueo es de todo el proceso, así que el orden
 * de las pruebas importa: la primera mide ANTES del arranque.
 *
 * Run: npm run test:sharp-bloqueos
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { PERFILES, validarArchivo, type PerfilSubida } from "../validar-archivo";

const lienzo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#3366cc" } });

async function muestras() {
  return {
    jpg: await lienzo().jpeg().toBuffer(),
    png: await lienzo().png().toBuffer(),
    webp: await lienzo().webp().toBuffer(),
    gif: await lienzo().gif().toBuffer(),
    tiff: await lienzo().tiff().toBuffer(),
    avif: await lienzo().avif().toBuffer(),
  };
}

// El perfil de fotos de ortodoncia (src/app/api/orthodontics/photos/upload) es
// el único que admite AVIF.
const PERFIL_CON_AVIF: PerfilSubida = {
  id: "ORTHO_FOTO_SET",
  mimesPermitidos: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/avif", "image/heic", "image/heif"],
  maxBytes: 25 * 1024 * 1024,
  imagen: true,
  descripcion: "foto del set fotográfico de ortodoncia",
};

test("antes del arranque, sharp sí abre un AVIF (la prueba mide algo)", async () => {
  const { avif } = await muestras();
  const m = await sharp(avif).metadata();
  assert.equal(m.format, "heif");
});

test("después de register(): AVIF se rechaza con el error de formato de sharp", async () => {
  const antes = process.env.NEXT_RUNTIME;
  process.env.NEXT_RUNTIME = "nodejs";
  try {
    const { register } = await import("../../../instrumentation");
    await register();
  } finally {
    if (antes === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = antes;
  }

  const { avif } = await muestras();
  await assert.rejects(sharp(avif).metadata(), /unsupported image format/);
  await assert.rejects(sharp(avif).resize(32).jpeg().toBuffer(), /unsupported image format/);
});

test("JPG, PNG, WebP, GIF y TIFF se siguen procesando igual (logo, foto, radiografía, miniatura)", async () => {
  const m = await muestras();
  for (const [nombre, buf] of Object.entries(m)) {
    if (nombre === "avif") continue;
    const meta = await sharp(buf).metadata();
    assert.equal(meta.width, 64, nombre);
    assert.equal(meta.height, 48, nombre);
    // Lo que hacen las rutas: comprimir a JPG y sacar miniatura WebP.
    const grande = await sharp(buf).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    const mini = await sharp(buf).rotate().resize(30, 30, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
    assert.equal((await sharp(grande).metadata()).format, "jpeg", nombre);
    assert.deepEqual([(await sharp(mini).metadata()).width, (await sharp(mini).metadata()).height], [30, 30], nombre);
  }
  // Solo se bloquea leer: escribir AVIF sigue funcionando.
  assert.ok((await sharp(m.jpg).avif().toBuffer()).length > 0);
});

test("validarArchivo: un AVIF se rechaza con un motivo claro, no como «corrupta»", async () => {
  const { avif } = await muestras();
  const r = await validarArchivo({ bytes: avif, nombreOriginal: "foto.avif", perfil: PERFIL_CON_AVIF });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.codigo, "tipo_no_permitido");
    assert.match(r.motivo, /AVIF no se aceptan.*JPG, PNG o WebP/);
  }
  // En un perfil que nunca lo admitió, el motivo de siempre.
  const logo = await validarArchivo({ bytes: avif, nombreOriginal: "logo.avif", perfil: PERFILES.LOGO_AVATAR });
  assert.equal(logo.ok, false);
  if (!logo.ok) assert.match(logo.motivo, /image\/avif\) no está permitido/);
});

test("validarArchivo con el bloqueo puesto: logo PNG, foto JPG/WebP y radiografía TIFF/GIF pasan", async () => {
  const m = await muestras();
  const casos: [Buffer, string, PerfilSubida, string][] = [
    [m.png, "logo.png", PERFILES.LOGO_AVATAR, "image/png"],
    [m.jpg, "foto.jpg", PERFILES.FOTO_CLINICA, "image/jpeg"],
    [m.webp, "foto.webp", PERFILES.FOTO_CLINICA, "image/webp"],
    [m.tiff, "rx.tiff", PERFILES.RADIOGRAFIA, "image/tiff"],
    [m.gif, "rx.gif", PERFILES.RADIOGRAFIA, "image/gif"],
    [m.jpg, "foto.jpg", PERFIL_CON_AVIF, "image/jpeg"],
  ];
  for (const [bytes, nombre, perfil, mime] of casos) {
    const r = await validarArchivo({ bytes, nombreOriginal: nombre, perfil });
    assert.equal(r.ok, true, `${nombre}: ${"motivo" in r ? r.motivo : ""}`);
    if (r.ok) assert.equal(r.mimeReal, mime);
  }
});
