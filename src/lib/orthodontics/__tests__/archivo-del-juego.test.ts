/**
 * X6 — un juego de fotos no acepta el archivo de otro paciente.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/archivo-del-juego.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { motivoArchivoAjenoAlJuego } from "../photo-set-helpers";

const juego = { clinicId: "c1", patientId: "p1" };

test("mismo paciente y clínica: se puede", () => {
  assert.equal(motivoArchivoAjenoAlJuego(juego, { clinicId: "c1", patientId: "p1" }), null);
});

test("archivo de otro paciente de la misma clínica: se rechaza con motivo claro", () => {
  assert.match(motivoArchivoAjenoAlJuego(juego, { clinicId: "c1", patientId: "p2" }) ?? "", /otro paciente/);
});

test("sin archivo, de otra clínica o juego sin clínica: «no encontrado»", () => {
  assert.equal(motivoArchivoAjenoAlJuego(juego, null), "Archivo no encontrado");
  assert.equal(motivoArchivoAjenoAlJuego(juego, { clinicId: "c2", patientId: "p1" }), "Archivo no encontrado");
  assert.equal(motivoArchivoAjenoAlJuego({ clinicId: "", patientId: "p1" }, { clinicId: "", patientId: "p1" }), "Archivo no encontrado");
});

test("uploadPhotoToSet usa la comprobación antes de escribir", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "app/actions/orthodontics/uploadPhotoToSet.ts"), "utf8");
  const i = src.indexOf("motivoArchivoAjenoAlJuego(set, file)");
  assert.ok(i > 0 && i < src.indexOf("prisma.orthoPhotoSet.update"));
  assert.match(src, /where: \{ id: parsed\.data\.fileId, clinicId: ctx\.clinicId, deletedAt: null \}/);
});
