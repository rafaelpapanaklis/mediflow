// ws1-t1 (tercera ronda, Bajas de G5) — N-41 (las canceladas cuentan como citas del día) y N-42 (se completa una
// cita futura). Con el código de antes: «Agenda de hoy · 3 citas» con 2 canceladas, «2 pacientes hoy» del doctor con
// sus dos canceladas, Ctrl K sin decir «Cancelada», «Citas 4» en la ficha; y IN_PROGRESS → COMPLETED de una cita del
// 7 de octubre el día 4.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canTransition } from "../transitions";
import { citasQueCuentan } from "@/lib/home/citas-que-cuentan";
import { etiquetaDeEstadoEnBusqueda } from "@/lib/command-palette/estado-cita";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 N-41: las canceladas no cuentan como citas del día (Hoy, doctor, ficha) y Ctrl K las marca", () => {
  assert.equal(citasQueCuentan([{ status: "CANCELLED" }, { status: "CANCELLED" }, { status: "SCHEDULED" }]), 1);
  for (const f of [
    "components/dashboard/hoy-rediseno/hoy-recepcion.tsx",
    "components/dashboard/home/home-receptionist.tsx",
  ]) {
    assert.match(leer(f), /todayCount", \{ count: citasQueCuentan\(data\.todayAppointments\) \}/, f);
  }
  assert.match(leer("components/dashboard/hoy-rediseno/hoy-doctor.tsx"), /const totalHoy = citasQueCuentan\(data\.todayAppointments\);/);
  assert.match(leer("components/dashboard/home/home-doctor.tsx"), /const totalToday = citasQueCuentan\(data\.todayAppointments\);/);
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.equal((ficha.match(/agenda: citasVivas,/g) ?? []).length, 3);
  assert.equal(etiquetaDeEstadoEnBusqueda("CANCELLED"), "Cancelada");
  assert.equal(etiquetaDeEstadoEnBusqueda("NO_SHOW"), "No asistió");
  assert.equal(etiquetaDeEstadoEnBusqueda("SCHEDULED"), null);
  assert.match(leer("components/dashboard/command-palette.tsx"), /etiquetaDeEstadoEnBusqueda\(a\.status, locale\)/);
});

test("🔴→🟢 N-42: no se completa una cita que todavía no empieza", () => {
  const hoy = new Date("2026-10-04T15:00:00Z");
  const el7 = new Date("2026-10-07T16:00:00Z");
  for (const from of ["IN_PROGRESS", "IN_CHAIR"] as const) {
    const r = canTransition(from, "COMPLETED", "DOCTOR", hoy, el7);
    assert.equal(r.ok, false, from);
    assert.match(r.ok === false ? r.error : "", /todavía no empieza/);
  }
  assert.equal(canTransition("IN_PROGRESS", "CHECKED_OUT", "DOCTOR", hoy, el7).ok, false);
  // La de hoy (o 10 min antes de su hora) sí.
  assert.equal(canTransition("IN_PROGRESS", "COMPLETED", "DOCTOR", hoy, new Date("2026-10-04T15:10:00Z")).ok, true);
  assert.equal(canTransition("IN_PROGRESS", "COMPLETED", "DOCTOR", hoy, new Date("2026-10-04T14:00:00Z")).ok, true);
});
