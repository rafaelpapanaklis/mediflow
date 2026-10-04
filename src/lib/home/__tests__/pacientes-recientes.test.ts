// ws1-t1 (ronda de arreglos de la auditoría de uso, C-99) — «Pacientes recientes» en el Hoy del doctor.
// Con el código de antes: dos pacientes que se llaman igual («QaDL Luis Demo Dos / ayer») salían como dos
// tarjetas idénticas, sin forma de saber cuál es cuál.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineaDePacienteReciente } from "../greet";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 la tarjeta lleva el folio junto a cuándo vino", () => {
  assert.equal(lineaDePacienteReciente("P0175", "ayer"), "P0175 · ayer");
  assert.equal(lineaDePacienteReciente(null, "ayer"), "ayer");
});

test("🔴→🟢 la ruta trae el folio y las dos versiones del Hoy lo pintan", () => {
  const ruta = leer("app/api/dashboard/home/doctor/route.ts");
  assert.match(ruta, /patient: \{ select: \{ id: true, firstName: true, lastName: true, patientNumber: true \} \}/);
  assert.match(ruta, /patientNumber: r\.patient\.patientNumber \?\? null/);
  for (const f of ["components/dashboard/hoy-rediseno/hoy-doctor.tsx", "components/dashboard/home/parts/recent-patients-carousel.tsx"]) {
    assert.match(leer(f), /lineaDePacienteReciente\(p\.patientNumber, formatRelative\(p\.lastVisitAt\)\)/, f);
  }
});
