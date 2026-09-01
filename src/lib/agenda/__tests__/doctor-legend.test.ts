/**
 * Tests de la leyenda de color por doctor (doctor-legend).
 *
 * Run: npm run test:agenda-legend
 *
 * Foco crítico:
 *  - **Ningún color pintado sin entrada en la leyenda.** El color de la
 *    card sale del doctor de la CITA, no del padrón: si un doctor dado de
 *    baja conserva citas, su color está en pantalla. La leyenda tiene que
 *    listarlo igual que `computeColumns` le da columna en Día + Doctores.
 *  - **Un solo estado.** La leyenda y la pill "Doctores" leen y escriben
 *    el mismo `filters.doctorIds`, así que tienen que enseñar la MISMA
 *    lista: un doctor seleccionado no puede desaparecer de la lista
 *    mientras sigue contando en el filtro.
 *  - **La tira no crece nunca.** `fitLegendChips` decide con anchos
 *    medidos cuántos chips caben; lo que sobra va al "+N".
 *  - **Dónde se pinta.** En Día + Doctores la cabecera ya lo dice, y en
 *    Mes/Lista las citas NO se pintan con el color del doctor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEGEND_CHIP_GAP_PX,
  fitLegendChips,
  legendAppliesTo,
  legendDoctors,
  orderLegendStrip,
} from "../doctor-legend";
import { doctorColorFor, doctorInitials } from "../doctor-color";
import type { AgendaAppointmentDTO, DoctorColumnDTO } from "../types";

const FALLBACK = "Profesional";

function doc(
  id: string,
  shortName: string,
  activeInAgenda: boolean,
  color: string | null = null,
): DoctorColumnDTO {
  return {
    id,
    displayName: `${shortName} (largo)`,
    shortName,
    color,
    activeInAgenda,
  };
}

function appt(id: string, doctor: { id: string; shortName: string } | null): AgendaAppointmentDTO {
  return {
    id,
    startsAt: "2026-09-01T15:00:00.000Z",
    endsAt: "2026-09-01T15:30:00.000Z",
    status: "CONFIRMED",
    patient: { id: `p-${id}`, name: "Paciente" },
    doctor: doctor ?? undefined,
    resourceId: null,
  } as unknown as AgendaAppointmentDTO;
}

/* ─────────────── legendDoctors: la lista que hay que cubrir ─────────── */

test("lista el padrón activo, en su orden", () => {
  const list = legendDoctors(
    [doc("a", "Dra. Ana", true), doc("b", "Dr. Beto", true), doc("c", "Dra. Cris", true)],
    [],
    [],
    FALLBACK,
  );
  assert.deepEqual(list.map((d) => d.id), ["a", "b", "c"]);
  assert.deepEqual(list.map((d) => d.present), [false, false, false]);
});

test("un doctor de BAJA con citas hoy entra igual: su color está pintado", () => {
  const list = legendDoctors(
    [doc("a", "Dra. Ana", true), doc("z", "Dr. Zeta", false)],
    [appt("1", { id: "z", shortName: "Dr. Zeta" })],
    [],
    FALLBACK,
  );
  assert.deepEqual(list.map((d) => d.id), ["a", "z"]);
  assert.equal(list.find((d) => d.id === "z")!.present, true);
});

test("un doctor de baja SIN citas no entra (no hay color suyo en pantalla)", () => {
  const list = legendDoctors(
    [doc("a", "Dra. Ana", true), doc("z", "Dr. Zeta", false)],
    [],
    [],
    FALLBACK,
  );
  assert.deepEqual(list.map((d) => d.id), ["a"]);
});

test("doctor que NO está en state.doctors pero sí en una cita: entra con el nombre de la cita", () => {
  const list = legendDoctors(
    [doc("a", "Dra. Ana", true)],
    [appt("1", { id: "x", shortName: "Dr. Equis" })],
    [],
    FALLBACK,
  );
  const x = list.find((d) => d.id === "x");
  assert.ok(x, "el doctor huérfano tiene que estar");
  assert.equal(x!.name, "Dr. Equis");
  assert.equal(x!.initials, doctorInitials("Dr. Equis"));
});

test("sin nombre por ningún lado cae al texto de respaldo, nunca al id crudo", () => {
  const list = legendDoctors([], [appt("1", { id: "x", shortName: "" })], [], FALLBACK);
  assert.equal(list[0]!.name, FALLBACK);
});

test("INVARIANTE: todo doctor con cita tiene entrada en la leyenda", () => {
  const appts = [
    appt("1", { id: "a", shortName: "Dra. Ana" }),
    appt("2", { id: "z", shortName: "Dr. Zeta" }),
    appt("3", { id: "x", shortName: "Dr. Equis" }),
    appt("4", null),
  ];
  const list = legendDoctors([doc("a", "Dra. Ana", true), doc("z", "Dr. Zeta", false)], appts, [], FALLBACK);
  const cubiertos = new Set(list.map((d) => d.id));
  for (const a of appts) {
    if (!a.doctor?.id) continue;
    assert.ok(cubiertos.has(a.doctor.id), `sin entrada para ${a.doctor.id}`);
  }
});

test("el seleccionado NO desaparece de la lista aunque el filtro lo deje sin citas", () => {
  // Filtro = [a, z]; el fetch ya volvió con solo las citas de "a".
  const list = legendDoctors(
    [doc("a", "Dra. Ana", true), doc("z", "Dr. Zeta", false)],
    [appt("1", { id: "a", shortName: "Dra. Ana" })],
    ["a", "z"],
    FALLBACK,
  );
  assert.deepEqual(list.map((d) => d.id), ["a", "z"]);
  // El contador del filtro (2) y la lista (2) dicen lo mismo.
  assert.equal(list.filter((d) => d.selected).length, 2);
});

test("el color y las iniciales salen de doctor-color, no de una copia", () => {
  const list = legendDoctors([doc("a", "Dra. Ana Ruiz", true, "#123456")], [], [], FALLBACK);
  assert.equal(list[0]!.color, doctorColorFor("a", "#123456"));
  assert.equal(list[0]!.color, "#123456");
  // Iniciales desde shortName, igual que la card.
  assert.equal(list[0]!.initials, doctorInitials("Dra. Ana Ruiz"));
  // Sin users.color, el mismo hash que usa la card.
  const sinColor = legendDoctors([doc("b", "Dr. Beto", true)], [], [], FALLBACK);
  assert.equal(sinColor[0]!.color, doctorColorFor("b", null));
});

test("la tinta del chip es la que readableTextOn decide (negro o blanco)", () => {
  const claro = legendDoctors([doc("a", "Dra. Ana", true, "#FFFF00")], [], [], FALLBACK);
  assert.equal(claro[0]!.ink, "#000000");
  const oscuro = legendDoctors([doc("b", "Dr. Beto", true, "#101010")], [], [], FALLBACK);
  assert.equal(oscuro[0]!.ink, "#FFFFFF");
});

test("sin duplicados aunque el doctor esté activo, con citas y filtrado a la vez", () => {
  const list = legendDoctors(
    [doc("a", "Dra. Ana", true)],
    [appt("1", { id: "a", shortName: "Dra. Ana" }), appt("2", { id: "a", shortName: "Dra. Ana" })],
    ["a"],
    FALLBACK,
  );
  assert.equal(list.length, 1);
});

/* ─────────────── orderLegendStrip: qué va delante ─────────────── */

test("delante los filtrados, luego los que tienen citas, al final el resto", () => {
  const list = legendDoctors(
    [
      doc("a", "Dra. Ana", true),
      doc("b", "Dr. Beto", true),
      doc("c", "Dra. Cris", true),
      doc("d", "Dr. Dani", true),
    ],
    [appt("1", { id: "c", shortName: "Dra. Cris" })],
    ["d"],
    FALLBACK,
  );
  assert.deepEqual(orderLegendStrip(list).map((x) => x.id), ["d", "c", "a", "b"]);
});

test("dentro de cada grupo se respeta el orden del padrón (estable)", () => {
  const list = legendDoctors(
    [doc("a", "Dra. Ana", true), doc("b", "Dr. Beto", true), doc("c", "Dra. Cris", true)],
    [appt("1", { id: "a", shortName: "Dra. Ana" }), appt("2", { id: "c", shortName: "Dra. Cris" })],
    [],
    FALLBACK,
  );
  assert.deepEqual(orderLegendStrip(list).map((x) => x.id), ["a", "c", "b"]);
});

test("un doctor filtrado nunca se va detrás del '+N'", () => {
  const doctors = Array.from({ length: 15 }, (_, i) => doc(`d${i}`, `Dr. ${i}`, true));
  const orden = orderLegendStrip(legendDoctors(doctors, [], ["d14"], FALLBACK));
  assert.equal(orden[0]!.id, "d14");
});

/* ─────────────── fitLegendChips: la tira no crece ─────────────── */

const G = LEGEND_CHIP_GAP_PX;

test("si caben todos, no se reserva nada para el '+N'", () => {
  // 3 chips de 100 + 2 gaps = 308.
  assert.equal(fitLegendChips(308, [100, 100, 100], 40, G), 3);
  assert.equal(fitLegendChips(1000, [100, 100, 100], 40, G), 3);
});

test("si no caben todos, el '+N' se reserva y se pinta menos", () => {
  // 307 < 308 → hay que reservar 40 + gap. 100 + 4 + 40 = 144 ≤ 307;
  // 204 + 4 + 40 = 248 ≤ 307; 308 + 4 + 40 = 352 > 307 → 2 chips.
  assert.equal(fitLegendChips(307, [100, 100, 100], 40, G), 2);
});

test("cuando ni un chip cabe con el '+N', la tira se queda solo con el '+N'", () => {
  assert.equal(fitLegendChips(100, [100, 100], 40, G), 0);
});

test("ancho 0 o negativo (tira exprimida) no pinta nada, y no revienta", () => {
  assert.equal(fitLegendChips(0, [100], 40, G), 0);
  assert.equal(fitLegendChips(-50, [100], 40, G), 0);
  assert.equal(fitLegendChips(500, [], 40, G), 0);
});

test("nunca devuelve más chips de los que hay", () => {
  for (const avail of [0, 37, 120, 500, 4000]) {
    const n = fitLegendChips(avail, [80, 90, 70], 40, G);
    assert.ok(n >= 0 && n <= 3, `avail=${avail} → ${n}`);
  }
});

test("el resultado crece de forma monótona con el ancho (sin parpadeo)", () => {
  const widths = [80, 95, 70, 110, 60];
  let prev = 0;
  for (let avail = 0; avail <= 900; avail += 7) {
    const n = fitLegendChips(avail, widths, 42, G);
    assert.ok(n >= prev, `en ${avail}px bajó de ${prev} a ${n}`);
    prev = n;
  }
  assert.equal(prev, widths.length);
});

test("una clínica de 15 doctores con nombre: en 380px caben 3 y el resto va al '+N'", () => {
  // Chip con nombre ≈ 34px de estructura (borde + paddings 2/9 + avatar de
  // 16 + gap de 5) más el nombre: ~100px con un nombre corriente. "+N" ≈ 42.
  const widths = Array.from({ length: 15 }, () => 100);
  const n = fitLegendChips(380, widths, 42, G);
  assert.equal(n, 3);
  assert.equal(widths.length - n, 12); // "+12"
});

test("los mismos 15 en compacto (la container query se lleva el nombre) caben 12", () => {
  // Sin nombre el chip es el avatar y sus paddings: ~24px.
  const widths = Array.from({ length: 15 }, () => 24);
  assert.equal(fitLegendChips(380, widths, 42, G), 12);
});

/* ─────────────── legendAppliesTo: dónde se pinta ─────────────── */

test("Semana SIEMPRE (las columnas son días: nada dice de quién es el color)", () => {
  assert.equal(legendAppliesTo("week", "doctor"), true);
  assert.equal(legendAppliesTo("week", "resource"), true);
  assert.equal(legendAppliesTo("week", "unified"), true);
});

test("Día + Sillones y Día unificado SÍ; Día + Doctores NO (la cabecera ya lo dice)", () => {
  assert.equal(legendAppliesTo("day", "resource"), true);
  assert.equal(legendAppliesTo("day", "unified"), true);
  assert.equal(legendAppliesTo("day", "doctor"), false);
});

test("Mes y Lista NO: ahí la cita se pinta por ESTADO, no por doctor", () => {
  for (const cm of ["doctor", "resource", "unified"] as const) {
    assert.equal(legendAppliesTo("month", cm), false);
    assert.equal(legendAppliesTo("list", cm), false);
  }
});

test("la premisa de arriba se comprueba en el código de la vista Mes", () => {
  // Si alguien cambia el mes a color por doctor, este test cae y obliga a
  // decidir la leyenda ahí también (una leyenda de colores que la pantalla
  // no usa engaña; una pantalla con colores sin leyenda es el bug que
  // arreglamos).
  const src = readFileSync(
    join(process.cwd(), "src/components/dashboard/agenda/agenda-month-view.tsx"),
    "utf8",
  );
  assert.ok(src.includes("MONTH_STATUS_COLOR"), "el mes pinta por estado");
  assert.ok(
    !src.includes("doctorColorFor"),
    "el mes NO usa el color del doctor: si empieza a usarlo, revisa legendAppliesTo",
  );
});
