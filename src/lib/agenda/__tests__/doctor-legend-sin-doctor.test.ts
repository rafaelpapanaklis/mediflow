/**
 * Leyenda y filtro de doctores de la agenda de siempre con la cita «Sin doctor»
 * (ws1-t11 · fase 2 · P2, PLAN §1.4 y §2.3, decisión D2).
 *
 * Run: node_modules/.bin/tsx --test src/lib/agenda/__tests__/doctor-legend-sin-doctor.test.ts
 *
 *  · Una cita sin doctor pinta un color (gris): la leyenda tiene que nombrarlo («todo color
 *    pintado necesita entrada»), primero y con el id que entiende el filtro (`FILTRO_SIN_DOCTOR`).
 *  · Seleccionada en el filtro, no desaparece aunque el fetch ya no traiga ninguna, y nunca se
 *    cuela como un «Profesional» con color del hash.
 *  · El filtro la ofrece siempre que la clínica pueda agendar «Sin doctor»; sin eso y sin
 *    ninguna, la lista es la de siempre.
 *
 * Con el código de f4d8fe31d falla: `legendDoctors` ignoraba las citas sin doctor y, con
 * `FILTRO_SIN_DOCTOR` en el filtro, inventaba un «Profesional» de color del hash.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { legendDoctors, orderLegendStrip } from "@/lib/agenda/doctor-legend";
import { FILTRO_SIN_DOCTOR } from "@/lib/agenda/sin-doctor";
import type { AgendaAppointmentDTO, DoctorColumnDTO } from "@/lib/agenda/types";

const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra
const FALLBACK = "Profesional";

function doc(id: string, shortName: string, activeInAgenda = true): DoctorColumnDTO {
  return { id, displayName: `${shortName} (largo)`, shortName, color: null, activeInAgenda };
}

function cita(id: string, doctor: { id: string; shortName: string } | null): AgendaAppointmentDTO {
  return {
    id,
    startsAt: "2026-11-05T15:00:00.000Z",
    endsAt: "2026-11-05T15:30:00.000Z",
    status: "CONFIRMED",
    patient: { id: `p-${id}`, name: "Paciente" },
    doctor: doctor ?? undefined,
    resourceId: null,
  } as unknown as AgendaAppointmentDTO;
}

const DOCTORES = [doc(DRA, "Dra. Ana"), doc(DR_SIEMBRA, "Dr. Siembra")];

test("con una cita sin doctor cargada, «Sin doctor» sale PRIMERO, gris y con el id del filtro", () => {
  const lista = legendDoctors(
    DOCTORES,
    [cita("dentalink-appt-88231", null), cita("a1", { id: DRA, shortName: "Dra. Ana" })],
    [],
    FALLBACK,
    { nombreSinDoctor: "Sin doctor" },
  );
  assert.deepEqual(lista.map((d) => d.id), [FILTRO_SIN_DOCTOR, DRA, DR_SIEMBRA]);
  const sin = lista[0]!;
  assert.equal(sin.name, "Sin doctor");
  assert.equal(sin.sinDoctor, true);
  assert.equal(sin.present, true);
  assert.equal(sin.selected, false);
  assert.equal(sin.initials, "—");
  // Token del tema, nunca un hex del hash (pintaría a un doctor que no existe).
  assert.match(sin.color, /^var\(--/);
});

test("sin ninguna sin doctor y sin ofrecerla, la lista es exactamente la de siempre", () => {
  const lista = legendDoctors(DOCTORES, [cita("a1", { id: DRA, shortName: "Dra. Ana" })], [], FALLBACK);
  assert.deepEqual(lista.map((d) => d.id), [DRA, DR_SIEMBRA]);
});

test("seleccionada en el filtro: sigue en la lista aunque no llegue ninguna, y no inventa un «Profesional»", () => {
  const lista = legendDoctors(
    DOCTORES,
    [cita("a1", { id: DRA, shortName: "Dra. Ana" })],
    [DRA, FILTRO_SIN_DOCTOR],
    FALLBACK,
    { nombreSinDoctor: "Sin doctor" },
  );
  const deSinDoctor = lista.filter((d) => d.id === FILTRO_SIN_DOCTOR);
  assert.equal(deSinDoctor.length, 1, "una sola entrada para «Sin doctor»");
  assert.equal(deSinDoctor[0]!.selected, true);
  assert.equal(deSinDoctor[0]!.name, "Sin doctor");
  assert.ok(!lista.some((d) => d.name === FALLBACK), "nada de «Profesional» con el id virtual");
  // El contador del filtro (2) y la lista dicen lo mismo.
  assert.equal(lista.filter((d) => d.selected).length, 2);
  // En la tira va delante, con los seleccionados.
  assert.equal(orderLegendStrip(lista)[0]!.id, FILTRO_SIN_DOCTOR);
});

test("el filtro la ofrece si la clínica puede agendar «Sin doctor», aunque ese día no haya ninguna", () => {
  const conSql = legendDoctors(DOCTORES, [], [], FALLBACK, { nombreSinDoctor: "Sin doctor", ofrecerSinDoctor: true });
  assert.equal(conSql[0]?.id, FILTRO_SIN_DOCTOR);
  assert.equal(conSql[0]?.present, false);
  const sinSql = legendDoctors(DOCTORES, [], [], FALLBACK, { nombreSinDoctor: "Sin doctor", ofrecerSinDoctor: false });
  assert.deepEqual(sinSql.map((d) => d.id), [DRA, DR_SIEMBRA]);
});

test("clínica con un solo doctor y una sin doctor: dos entradas (la leyenda ya distingue los dos colores)", () => {
  const lista = legendDoctors(
    [doc(DRA, "Dra. Ana")],
    [cita("dentalink-appt-88231", null), cita("a1", { id: DRA, shortName: "Dra. Ana" })],
    [],
    FALLBACK,
    { nombreSinDoctor: "Sin doctor" },
  );
  assert.equal(lista.length, 2);
  assert.notEqual(lista[0]!.color, lista[1]!.color);
});
