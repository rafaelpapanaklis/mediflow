/**
 * WS1-T4 ronda 6 — al profesional se le nombra sin inventarle género.
 *
 * Run: npx tsx --test src/lib/__tests__/nombre-profesional.test.ts
 *
 * Salía «Dr/a. Mariana» en Resumen → Citas y «Dr. Renata», «Dr. Mariana» en
 * Hoy → «Performance del equipo». `model User` no tiene campo de tratamiento
 * ni de género: se escribe nombre y apellido, como la Agenda.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { firstName } from "@/lib/home/greet";
import { nombreDeProfesional } from "../nombre-profesional";

const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("nombre y apellido, sin prefijo", () => {
  assert.equal(nombreDeProfesional({ firstName: "Mariana", lastName: "Cortés" }), "Mariana Cortés");
  assert.equal(nombreDeProfesional({ firstName: "Renata", lastName: "Ibarra Luna" }), "Renata Ibarra Luna");
});

test("sin apellido, sin nombre o sin nada", () => {
  assert.equal(nombreDeProfesional({ firstName: "Mariana", lastName: null }), "Mariana");
  assert.equal(nombreDeProfesional({ firstName: "", lastName: "Cortés" }), "Cortés");
  assert.equal(nombreDeProfesional({ firstName: "  ", lastName: undefined }), "");
  assert.equal(nombreDeProfesional(null), "");
  assert.equal(nombreDeProfesional(undefined), "");
});

test("limpia espacios de más", () => {
  assert.equal(nombreDeProfesional({ firstName: " María  José ", lastName: " Cortés " }), "María José Cortés");
});

test("nunca escribe un tratamiento", () => {
  for (const p of [{ firstName: "Mariana", lastName: "Cortés" }, { firstName: "Renata", lastName: "" }]) {
    assert.doesNotMatch(nombreDeProfesional(p), /\bDra?\b|Dr\/a/);
  }
});

test("el saludo de Hoy llama al doctor por su nombre, no «Dr.»", () => {
  // `firstName` se queda con la primera palabra: con el prefijo delante el
  // saludo era «Buenos días, Dr..».
  assert.equal(firstName("Dr. Mariana Cortés"), "Dr.");
  assert.equal(firstName("Mariana Cortés"), "Mariana");
  for (const archivo of [
    "src/components/dashboard/hoy-rediseno/hoy-doctor.tsx",
    "src/components/dashboard/home/home-doctor.tsx",
  ]) {
    const codigo = sinComentarios(leer(archivo));
    assert.doesNotMatch(codigo, /Dra?\. \$\{/, `${archivo} sigue anteponiendo «Dr.»`);
    assert.match(codigo, /=\{user\.displayName\}/, `${archivo} ya no pasa el nombre`);
  }
});

test("«Performance del equipo» no antepone «Dr.»", () => {
  const ruta = sinComentarios(leer("src/app/api/dashboard/home/admin/route.ts"));
  assert.doesNotMatch(ruta, /Dra?\. \$\{/);
  assert.match(ruta, /nombreDeProfesional\(d\)/);
});

test("Resumen → Citas no antepone «Dr/a.»", () => {
  const resumen = sinComentarios(leer("src/components/dashboard/pacientes-rediseno/resumen.tsx"));
  assert.doesNotMatch(resumen, /doctorPrefix/);
  assert.match(resumen, /nombreDeProfesional\(c\.doctor\)/);
});
