// ws1-t1 (ronda de arreglos de la auditoría de uso, C-90, C-91 y C-96) — la Agenda en escritorio.
// Con el código de antes (medido en navegador a 1440×900, clinica_qa_prueba):
//   · C-90: la página entera crecía a ~1 600 px y el pie del panel de la cita (Confirmar, Editar, Cancelar,
//     Llegada, No asistió, Anticipo) quedaba en y≈1 450: «parece que no hay acciones». Con el alto acotado, el pie
//     queda en y=719–900 y la rejilla hace scroll por dentro.
//   · C-91: un doctor solo recibe SUS citas pero ve las columnas de todo el equipo; la suya quedaba a la derecha de
//     21 columnas vacías («0 citas») y no encontraba su cita de las 23:01. Ahora va primero.
//   · C-96: con 13–22 columnas a 88 px la tarjeta decía «11:00–1 · Contr…». Ahora 128 px y desplazamiento horizontal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primeroElPropio } from "@/lib/agenda/primero-el-propio";
import { ANCHO_MINIMO_COLUMNA_DIA } from "../tokens";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 C-90: en escritorio la agenda mide lo que queda de la ventana (el pie del panel se ve)", () => {
  const css = leer("components/dashboard/agenda-nueva/agenda-nueva.module.css");
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\.raiz \{\s*height: calc\(100dvh - 102px\);\s*min-height: 520px;/);
});

test("🔴→🟢 C-91: al doctor, su columna primero; a los demás roles, el orden de siempre", () => {
  const docs = [{ id: "a" }, { id: "b" }, { id: "yo" }, { id: "c" }];
  assert.deepEqual(primeroElPropio(docs, "yo", "DOCTOR").map((d) => d.id), ["yo", "a", "b", "c"]);
  assert.deepEqual(primeroElPropio(docs, "yo", "RECEPTIONIST").map((d) => d.id), ["a", "b", "yo", "c"]);
  assert.deepEqual(primeroElPropio(docs, "otro", "DOCTOR").map((d) => d.id), ["a", "b", "yo", "c"]);
  assert.match(leer("app/dashboard/agenda/page.tsx"), /doctors: primeroElPropio\(doctors, user\.id, user\.role\)/);
  assert.match(leer("app/api/agenda/range/route.ts"), /doctors: primeroElPropio\(doctors, session\.user\.id, session\.user\.role\)/);
});

test("🔴→🟢 C-96: la columna de Día mide al menos 128 px", () => {
  assert.equal(ANCHO_MINIMO_COLUMNA_DIA, 128);
});
