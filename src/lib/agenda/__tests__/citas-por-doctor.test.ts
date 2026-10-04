/**
 * Citas POR DOCTOR iguales en Inicio, Analítica › Doctores y la nómina, y que
 * sumen las «citas del mes» (ws1-t2, auditoría de uso C-11, segunda vuelta;
 * t6 F4 y t12 F-19).
 *
 * Run: npm run test:citas-por-doctor
 *
 * La segunda auditoría vio 88 citas del mes en las cuatro pantallas, pero por
 * doctor Inicio daba 19/23/18/10 (suma 84: solo rol DOCTOR) y la Analítica y
 * la nómina 11/17/13/13 (suma 75: del día 1 del navegador a «ahora» y con
 * canceladas). Con el código viejo falla: `citas-por-doctor.ts` y
 * `doctores.server.ts` no existían, Inicio pedía `role: "DOCTOR"` y la nómina
 * contaba citas por doctor con `startsAt: { gte: from, lte: to }` sin filtro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { contarCitasPorDoctor, diasConCitas, idsConCitasFueraDeLista, ventanaDelPedido } from "@/lib/agenda/citas-por-doctor";
import { mesDeLaClinica } from "@/lib/agenda/citas-del-periodo";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const TZ = "America/Mexico_City";

test("C-11: el conteo por doctor usa las atendidas (COMPLETED y CHECKED_OUT) y separa «No asistió»", () => {
  const m = contarCitasPorDoctor([
    { doctorId: "d1", status: "COMPLETED", _count: { _all: 5 } },
    { doctorId: "d1", status: "CHECKED_OUT", _count: { _all: 2 } },
    { doctorId: "d1", status: "NO_SHOW", _count: { _all: 1 } },
    { doctorId: "d1", status: "SCHEDULED", _count: { _all: 3 } },
    { doctorId: "dueno", status: "CONFIRMED", _count: { _all: 4 } },
    { doctorId: null, status: "SCHEDULED", _count: { _all: 9 } },
  ]);
  assert.deepEqual(m.get("d1"), { citas: 11, atendidas: 7, noAsistio: 1 });
  // El dueño que atiende tiene citas y no tiene rol DOCTOR: con la lista vieja de Inicio no salía.
  assert.deepEqual(idsConCitasFueraDeLista(["d1"], m), ["dueno"]);
  const suma = Array.from(m.values()).reduce((s, c) => s + c.citas, 0);
  assert.equal(suma, 15, "la columna suma todas las citas con doctor del periodo");
});

test("C-11: «Este mes» de Analítica y nómina es el mes entero de la clínica, no del día 1 del navegador a «ahora»", () => {
  const ahora = new Date("2026-10-04T05:10:00Z");
  const mes = () => mesDeLaClinica(TZ, ahora);
  assert.deepEqual(ventanaDelPedido({ periodo: "mes" }, mes), { desde: new Date("2026-10-01T06:00:00Z"), hasta: new Date("2026-11-01T06:00:00Z") });
  assert.deepEqual(ventanaDelPedido({}, mes), mes());
  const r = ventanaDelPedido({ from: "2026-09-04T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" }, mes);
  assert.equal(r.hasta.getTime(), new Date("2026-10-04T00:00:00.000Z").getTime() + 1, "`to` inclusivo");
  assert.deepEqual(ventanaDelPedido({ from: "basura", to: "2026-10-04T00:00:00Z" }, mes), mes());
  // «Citas por día» cuenta días de la clínica: 23:30 del 3 y 00:30 del 4 (CDMX) son dos días.
  assert.equal(diasConCitas([new Date("2026-10-04T05:30:00Z"), new Date("2026-10-04T06:30:00Z")], TZ), 2);
  assert.equal(diasConCitas([new Date("2026-10-03T15:00:00Z"), new Date("2026-10-04T05:30:00Z")], TZ), 1);
});

test("C-11: Inicio, Analítica y nómina cuentan con la definición única sobre la misma lista", () => {
  const inicio = leer("src/app/api/dashboard/home/admin/route.ts");
  assert.match(inicio, /where: \{ clinicId, \.\.\.ATIENDE_WHERE \}/);
  assert.doesNotMatch(inicio, /role: "DOCTOR", isActive: true/);
  assert.match(inicio, /where: citasDelPeriodoWhere\(clinicId, from, to\),/);
  assert.match(inicio, /idsConCitasFueraDeLista\(/);
  const comun = leer("src/lib/analytics/doctores.server.ts");
  assert.match(comun, /citasDelPeriodoWhere\(clinicId, desde, hasta\)/);
  assert.match(comun, /\.\.\.ATIENDE_WHERE/);
  assert.match(comun, /idsConCitasFueraDeLista\(ids, porDoctor\)/);
  for (const f of ["src/app/api/analytics/doctor-performance/route.ts", "src/app/api/analytics/payroll-pdf/route.ts"]) {
    const s = leer(f);
    assert.match(s, /filasDeDoctores\(clinicId, \{ desde, hasta \}/, f);
    assert.doesNotMatch(s, /startsAt: \{ gte: from, lte: to \}/, f);
  }
  assert.match(leer("src/app/dashboard/analytics/doctors/doctors-client.tsx"), /new URLSearchParams\(\{ periodo: "mes" \}\)/);
});
