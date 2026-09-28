/**
 * ws1-t6 — ARCHIVOS EN BLOQUE: piezas PURAS (sin Prisma, sin Storage) del
 * emparejamiento y la categoría por nombre de archivo. Las rutas (match/sign/
 * confirm/abort) tocan Prisma y Supabase Storage de verdad y se prueban por su
 * permiso en permisos-rutas.test.ts; su lógica de validación es la misma que
 * ya cubren estas piezas puras.
 *
 * Run: npx tsx --test src/lib/import/__tests__/archivos-en-bloque.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BULK_FILE_EXT,
  MAX_BULK_FILE_BYTES,
  bulkFilePathPrefix,
  bulkFileStoragePath,
  candidatosDeEmparejamiento,
  extOfName,
  guessFileCategory,
  isBulkFileExt,
  isFileCategory,
  mimeForBulkFileExt,
  safeBulkFileName,
} from "@/lib/uploads/patient-bulk-file-upload";

test("extensiones aceptadas: jpg/jpeg/png/gif/webp/bmp/tiff/pdf, nada de estudios 3D/DICOM", () => {
  for (const e of ["jpg", "JPG", "jpeg", "png", "gif", "webp", "bmp", "tiff", "pdf"]) assert.ok(isBulkFileExt(e), e);
  for (const e of ["stl", "dcm", "zip", "exe", "docx", ""]) assert.ok(!isBulkFileExt(e), e);
  assert.equal(extOfName("Radiografía 16.JPG"), "jpg");
  assert.equal(extOfName("sin_extension"), "sin_extension"); // sin punto: split(".").pop() devuelve el string entero
});

test("tope de tamaño: 50 MB, el mismo que /api/xrays (no el de 2 GB de los estudios 3D)", () => {
  assert.equal(MAX_BULK_FILE_BYTES, 50 * 1024 * 1024);
});

test("mimeForBulkFileExt cubre las 8 extensiones aceptadas", () => {
  for (const e of BULK_FILE_EXT) assert.notEqual(mimeForBulkFileExt(e), "application/octet-stream", e);
  assert.equal(mimeForBulkFileExt("jpg"), "image/jpeg");
  assert.equal(mimeForBulkFileExt("pdf"), "application/pdf");
});

test("categoría por nombre: nunca inventa con confianza — sin pista clara, OTHER", () => {
  assert.equal(guessFileCategory("Radiografía panorámica Juan.jpg"), "XRAY_PANORAMIC");
  assert.equal(guessFileCategory("RX periapical 16.jpg"), "XRAY_PERIAPICAL");
  assert.equal(guessFileCategory("bitewing_derecho.jpg"), "XRAY_BITEWING");
  assert.equal(guessFileCategory("CBCT_maxilar.pdf"), "XRAY_CBCT");
  assert.equal(guessFileCategory("consentimiento_firmado.pdf"), "CONSENT_FORM");
  assert.equal(guessFileCategory("foto_frontal.jpg"), "PHOTO_FRONTAL");
  assert.equal(guessFileCategory("foto_paciente.jpg"), "PHOTO_PATIENT");
  assert.equal(guessFileCategory("12345_documento.pdf"), "OTHER");
  assert.equal(guessFileCategory("IMG_0341.jpg"), "OTHER");
  // Sin acentos ni mayúsculas: sigue reconociendo.
  assert.equal(guessFileCategory("RADIOGRAFIA-PANORAMICA.png"), "XRAY_PANORAMIC");
});

test("isFileCategory: whitelist estricta, nunca acepta un valor inventado", () => {
  assert.ok(isFileCategory("PHOTO_PATIENT"));
  assert.ok(isFileCategory("OTHER"));
  assert.ok(!isFileCategory("CUALQUIER_COSA"));
  assert.ok(!isFileCategory(undefined));
  assert.ok(!isFileCategory(123));
});

test("candidatos de emparejamiento: carpeta primero, luego el nombre completo, luego el prefijo antes de separador", () => {
  assert.deepEqual(candidatosDeEmparejamiento("12345_rx.jpg", "12345"), ["12345", "12345_rx"]);
  assert.deepEqual(candidatosDeEmparejamiento("Juan Perez - rx.jpg", null), ["Juan Perez - rx", "Juan Perez"]);
  assert.deepEqual(candidatosDeEmparejamiento("JuanPerez.jpg", null), ["JuanPerez"]);
  assert.deepEqual(candidatosDeEmparejamiento("foto.jpg", "María Hernández"), ["María Hernández", "foto"]);
  // Sin separador ni carpeta: un solo candidato, el nombre completo.
  assert.deepEqual(candidatosDeEmparejamiento("IMG0001.jpg"), ["IMG0001"]);
});

test("safeBulkFileName: nunca deja caracteres que rompan el path del bucket", () => {
  assert.equal(safeBulkFileName("Radiografía Juan (16).jpg"), "Radiograf_a_Juan_16_.jpg");
  assert.ok(safeBulkFileName("../../etc/passwd.jpg").length > 0);
  assert.ok(!safeBulkFileName("../../etc/passwd.jpg").includes("/"));
});

test("el path SIEMPRE cae en <clinic>/<patient>/ — la misma carpeta que usa /api/xrays", () => {
  const path = bulkFileStoragePath("cli_A", "p1", "uuid-1", "rx.jpg");
  assert.ok(path.startsWith(bulkFilePathPrefix("cli_A", "p1")));
  assert.equal(bulkFilePathPrefix("cli_A", "p1"), "cli_A/p1/");
  assert.equal(path, "cli_A/p1/uuid-1-rx.jpg");
  // Un patientId de OTRO paciente no cae en este prefijo (lo que valida /confirm y /abort).
  assert.ok(!path.startsWith(bulkFilePathPrefix("cli_A", "p2")));
});
