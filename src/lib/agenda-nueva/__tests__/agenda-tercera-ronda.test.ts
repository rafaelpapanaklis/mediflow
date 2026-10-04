// ws1-t1 (tercera ronda, segunda auditoría de uso) — Agenda: C-96 (nombre a 0 px en la tarjeta), N-36 (Semana
// de 12 832 px con 22 profesionales) y C-91 (canceladas que estiran la rejilla, citas fuera de horario sin aviso).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { responsablesConCarril } from "../carriles-semana";
import { citasFueraDeHorario, minutoDeEntrada, textoFueraDeHorario } from "../entrada-dia";
import { paintedAgendaWindow } from "@/lib/agenda/clinic-hours";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 C-96: en una tarjeta angosta la hora y el chip ceden el sitio al nombre", () => {
  const css = leer("components/dashboard/agenda-nueva/agenda-nueva.module.css");
  assert.match(css, /\.tarjeta \{\s*container-type: inline-size;\s*\}/);
  const q = css.slice(css.indexOf("@container (max-width: 210px)"));
  assert.match(q, /\.tarjetaHora \{\s*display: none;/);
  assert.match(q, /\.tarjetaChip \{\s*font-size: 0;/);
  assert.match(q, /\.tarjetaHoraEstrecha \{\s*display: inline;/);
  assert.match(leer("components/dashboard/agenda-nueva/tarjeta-cita.tsx"), /className=\{s\.tarjetaHoraEstrecha\}>\{cita\.horaInicio\} · </);
});

test("🔴→🟢 N-36: con muchos responsables, un día solo abre carril a quien tiene citas ese día", () => {
  const docs = Array.from({ length: 22 }, (_, i) => ({ id: `d${i}` }));
  assert.deepEqual(responsablesConCarril(docs, new Set(["d3", "d7"])).map((d) => d.id), ["d3", "d7"]);
  assert.equal(responsablesConCarril(docs, new Set()).length, 0, "un día vacío: un solo carril (lo pone la vista)");
  // Con pocos (≤3), cada uno conserva su carril, como siempre.
  assert.equal(responsablesConCarril(docs.slice(0, 3), new Set()).length, 3);
  const semana = leer("components/dashboard/agenda-nueva/vista-semana.tsx");
  assert.match(semana, /responsablesConCarril\(responsables, conCitas\)/);
  assert.ok(!/let maxCarriles = Math\.max\(1, responsables\.length\);/.test(semana), "ya no arranca en 22 carriles");
});

test("🔴→🟢 C-91: una cita CANCELADA no estira el eje; una viva sí", () => {
  const base = {
    fallback: { dayStart: 8, dayEnd: 20 },
    schedules: [{ dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "19:00" }],
    visibleDays: [0],
    onlyDayISO: "2026-10-05",
    timezone: "America/Mexico_City",
  };
  const cancelada = { startsAt: "2026-10-05T08:53:00Z", endsAt: "2026-10-05T09:23:00Z", status: "CANCELLED" }; // 02:53
  assert.equal(paintedAgendaWindow({ ...base, appointments: [cancelada] }).dayStart, 9);
  assert.equal(paintedAgendaWindow({ ...base, appointments: [{ ...cancelada, status: "SCHEDULED" }] }).dayStart, 2);
});

test("🔴→🟢 C-91: la rejilla entra en la apertura (o en la primera cita viva si es antes) y avisa de las de fuera", () => {
  const citas = [
    { id: "a", inicioMin: 18 * 60 + 51, estado: "COMPLETED" },
    { id: "b", inicioMin: 23 * 60 + 1, estado: "COMPLETED" },
    { id: "c", inicioMin: 2 * 60 + 53, estado: "CANCELLED" },
    { id: "d", inicioMin: 10 * 60, estado: "SCHEDULED" },
  ];
  assert.equal(minutoDeEntrada(citas, 9 * 60), 9 * 60, "la cancelada de las 02:53 no cuenta");
  assert.equal(minutoDeEntrada([{ id: "x", inicioMin: 7 * 60, estado: "CONFIRMED" }], 9 * 60), 7 * 60);
  assert.deepEqual(citasFueraDeHorario(citas, 9 * 60, 14 * 60).map((c) => c.hora), ["18:51", "23:01"]);
  assert.equal(textoFueraDeHorario(2), "2 citas fuera del horario:");
  const cuadricula = leer("components/dashboard/agenda-nueva/cuadricula.tsx");
  assert.match(cuadricula, /onClick=\{\(\) => irAMinuto\(c\.minuto\)\}/);
  assert.match(leer("components/dashboard/agenda-nueva/vista-dia.tsx"), /fueraDeHorario=\{entrada\.fuera\}/);
});
