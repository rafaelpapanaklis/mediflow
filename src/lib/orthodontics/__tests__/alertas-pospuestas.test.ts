// Ortodoncia — «Posponer 7 días» en Alertas (fila 22 de la revisión de uso,
// ws1-t4 ronda 6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIAS_DE_POSPOSICION,
  esTipoPosponible,
  hastaDePosposicion,
  quitarPospuestas,
  vigentes,
} from "../alertas-pospuestas";

const AHORA = new Date("2026-09-28T16:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

test("se pospone 7 días exactos", () => {
  assert.equal(DIAS_DE_POSPOSICION, 7);
  assert.equal(hastaDePosposicion(AHORA).getTime() - AHORA.getTime(), 7 * DIA);
});

test("solo cuatro tipos se posponen: ni mensualidad vencida ni fotos", () => {
  for (const t of ["sin-proximo-control", "no-asistio", "proximo-a-terminar", "pasado-de-fecha"]) {
    assert.equal(esTipoPosponible(t), true, t);
  }
  for (const t of ["mensualidad-vencida", "fotos-del-paciente", "", null, 3]) {
    assert.equal(esTipoPosponible(t), false, String(t));
  }
});

test("una posposición vigente quita la fila de su tipo, y solo de su tipo", () => {
  const activas = vigentes(
    [{ patientId: "ana", tipo: "sin-proximo-control", hasta: new Date(AHORA.getTime() + DIA) }],
    AHORA,
  );
  const filas = [{ patientId: "ana" }, { patientId: "beto" }];
  const r = quitarPospuestas(filas, "sin-proximo-control", activas);
  assert.deepEqual(r.quedan, [{ patientId: "beto" }]);
  assert.equal(r.pospuestas, 1);
  // Ana sigue saliendo en «No asistió» si faltó.
  assert.equal(quitarPospuestas(filas, "no-asistio", activas).quedan.length, 2);
});

test("vencida la posposición, la alerta vuelve sola", () => {
  const activas = vigentes(
    [{ patientId: "ana", tipo: "pasado-de-fecha", hasta: new Date(AHORA.getTime() - 1) }],
    AHORA,
  );
  assert.equal(quitarPospuestas([{ patientId: "ana" }], "pasado-de-fecha", activas).quedan.length, 1);
});

test("varias faltas del mismo paciente se posponen juntas", () => {
  const activas = vigentes([{ patientId: "ana", tipo: "no-asistio", hasta: hastaDePosposicion(AHORA) }], AHORA);
  const r = quitarPospuestas([{ patientId: "ana" }, { patientId: "ana" }, { patientId: "beto" }], "no-asistio", activas);
  assert.equal(r.quedan.length, 1);
  assert.equal(r.pospuestas, 2);
});

// Candados de cableado.
const RAIZ = join(__dirname, "../../../..");
const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");

test("Alertas quita lo pospuesto al cargar, y la carga nunca lanza sin la tabla", () => {
  const datos = leer("src/lib/orthodontics/alerts-data.ts");
  for (const t of ["sin-proximo-control", "no-asistio", "proximo-a-terminar", "pasado-de-fecha"]) {
    assert.match(datos, new RegExp(`quitarPospuestas\\(.*"${t}"`), t);
  }
  const db = leer("src/lib/orthodontics/alertas-pospuestas-db.ts");
  assert.match(db, /WHERE "clinicId" = \$\{clinicId\}/);
  assert.match(db, /catch \(e\)[\s\S]*return \[\]/);
});

test("la acción toma la clínica de la sesión y comprueba el paciente", () => {
  const accion = leer("src/app/actions/orthodontics/modulo/posponerAlerta.ts");
  assert.match(accion, /^"use server";/);
  assert.match(accion, /getOrthoActionContext\(/);
  assert.match(accion, /loadPatientForOrtho\(/);
  assert.match(accion, /clinicId: ctx\.clinicId/);
  // En un archivo "use server" solo se exportan funciones async.
  const exportados: string[] = accion.match(/^export .*/gm) ?? [];
  assert.ok(exportados.every((l) => l.startsWith("export async function")), exportados.join("\n"));
});

test("la vista ofrece «Posponer» en las cuatro secciones, con permiso", () => {
  const vista = leer("src/components/specialties/orthodontics/modulo/vista-alertas.tsx");
  assert.equal((vista.match(/\{puedePosponer && <PosponerAlertaBoton/g) ?? []).length, 4);
  assert.match(leer("src/app/dashboard/orthodontics/alertas/page.tsx"), /puedePosponer=\{puedePosponer\}/);
});

test("el SQL es plano, idempotente y sin bloques DO", () => {
  const sql = leer("sql/ortodoncia-alertas-pospuestas.sql")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "ortho_alert_snoozes"/);
  assert.doesNotMatch(sql, /\bDO\s+\$\$/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS/);
});

test("fila 23: Alertas no toma como «próximo control» una cita de más tarde ya atendida", () => {
  const datos = leer("src/lib/orthodontics/alerts-data.ts");
  assert.match(datos, /a\.startsAt >= ahora &&[\s\S]{0,120}!citaAtendida\(a\.status\)/);
});

import { listaDePospuestas } from "../alertas-pospuestas";

test("H14: lista las pospuestas vigentes con nombre y etiqueta, y deja fuera las vencidas", () => {
  const ahora = new Date("2026-09-28T12:00:00Z");
  const r = listaDePospuestas(
    [
      { patientId: "p1", tipo: "sin-proximo-control", hasta: new Date("2026-10-05T12:00:00Z") },
      { patientId: "p2", tipo: "no-asistio", hasta: new Date("2026-09-20T12:00:00Z") },
      { patientId: "p3", tipo: "pasado-de-fecha", hasta: new Date("2026-10-01T12:00:00Z") },
    ],
    ahora,
    new Map([["p1", "Ana Pérez"]]),
  );
  assert.deepEqual(r.map((x) => [x.patientName, x.etiqueta]), [["Ana Pérez", "Sin próximo control"], ["Paciente", "Pasado de su fecha"]]);
});
