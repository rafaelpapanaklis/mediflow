/**
 * Citas por doctor con citas «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.7).
 *
 * Run: node_modules/.bin/tsx --test src/lib/agenda/__tests__/citas-por-doctor-sin-doctor.test.ts
 *
 * `contarCitasPorDoctor` cuenta solo las que tienen doctor (lo fija citas-por-doctor.test.ts);
 * las del `groupBy` con `doctorId: null` las cuenta `contarCitasSinDoctor`, para la fila
 * «Sin doctor» de Inicio. Las dos juntas suman todas las filas del `groupBy` (C-11). Con el
 * código de f4d8fe31d falla: `contarCitasSinDoctor` no existía.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { contarCitasPorDoctor, contarCitasSinDoctor, idsConCitasFueraDeLista } from "@/lib/agenda/citas-por-doctor";

const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra

test("las citas «Sin doctor» tienen su cuenta y, con las de cada doctor, suman el total", () => {
  assert.equal(typeof contarCitasSinDoctor, "function", "falta contarCitasSinDoctor");
  const filas = [
    { doctorId: DRA, status: "COMPLETED", _count: { _all: 3 } },
    { doctorId: DR_SIEMBRA, status: "SCHEDULED", _count: { _all: 2 } },
    { doctorId: null, status: "CHECKED_OUT", _count: { _all: 4 } },
    { doctorId: null, status: "NO_SHOW", _count: { _all: 1 } },
    { doctorId: null, status: "CONFIRMED", _count: { _all: 2 } },
  ];
  const porDoctor = contarCitasPorDoctor(filas);
  const sin = contarCitasSinDoctor(filas);
  assert.deepEqual(sin, { citas: 7, atendidas: 4, noAsistio: 1 });
  const total = filas.reduce((s, f) => s + f._count._all, 0);
  const suma = Array.from(porDoctor.values()).reduce((s, c) => s + c.citas, 0) + sin.citas;
  assert.equal(suma, total, "suma de filas = citas del periodo");
  // La fila «Sin doctor» no es una persona: no se busca en `users`.
  assert.deepEqual(idsConCitasFueraDeLista([DRA], porDoctor), [DR_SIEMBRA]);
  assert.deepEqual(contarCitasSinDoctor([]), { citas: 0, atendidas: 0, noAsistio: 0 });
});
