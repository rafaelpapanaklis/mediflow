// ws1-t1 (ronda de arreglos de la auditoría de uso, C-94 y C-97) — el panel de la cita dice su estado y si
// nació de la fila de espera.
// Con el código de antes: el subtítulo era «Cita agendada en la clínica» fijo (también en una cancelada o en un
// walk-in «En consulta»), y appointmentToDTO fijaba `isWalkIn: false` sin mirar la fila.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORIGEN_WALK_IN, origenCorto, subtituloDeLaCita } from "../origen-cita";
import { emparejarPorInicio } from "@/lib/walk-in/citas-de-walk-in";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 el subtítulo cambia con el estado", () => {
  assert.equal(subtituloDeLaCita("Agendada", "STAFF", false), "Agendada · en la clínica");
  assert.equal(subtituloDeLaCita("Cancelada", "STAFF", false), "Cancelada · en la clínica");
  assert.equal(subtituloDeLaCita("Confirmada", "WHATSAPP", false), "Confirmada · por WhatsApp");
  assert.equal(subtituloDeLaCita("En consulta", "STAFF", true), "En consulta · sin cita (fila de espera)");
  assert.equal(origenCorto("WEBSITE"), "Desde la web");
  assert.equal(ORIGEN_WALK_IN, "Sin cita (fila de espera)");
});

test("sin la columna de la liga, la fila y su cita se emparejan por paciente + instante de inicio", () => {
  const t = new Date("2026-10-03T23:01:00.000Z");
  const citas = [
    { id: "walk", patientId: "p1", startedAt: t.toISOString() },
    { id: "otra-hora", patientId: "p1", startedAt: "2026-10-03T23:02:00.000Z" },
    { id: "otro-paciente", patientId: "p2", startedAt: t },
    { id: "sin-iniciar", patientId: "p1", startedAt: null },
  ];
  const filas = [{ patientId: "p1", startedAt: t }, { patientId: null, startedAt: t }];
  assert.deepEqual([...emparejarPorInicio(citas, filas)], ["walk"]);
});

test("🔴→🟢 la agenda marca isWalkIn con la fila, en los dos cargadores, sin una consulta por tarjeta", () => {
  const server = leer("lib/agenda/server.ts");
  assert.equal((server.match(/citasDeWalkIn\(filter\.clinicId, rows\)/g) ?? []).length, 2);
  assert.equal((server.match(/return conWalkIn\(/g) ?? []).length, 2);
  const lib = leer("lib/walk-in/citas-de-walk-in.ts");
  assert.match(lib, /WHERE "clinicId" = \$\{clinicId\} AND "appointmentId" = ANY/);
  assert.match(lib, /g\.__walkInSinLiga = true/, "sin la columna, una sola vez por proceso");
  const panel = leer("components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /subtituloDeLaCita\(cita\.chip, dto\.source, dto\.isWalkIn === true\)/);
  assert.match(panel, /dto\.isWalkIn \? ORIGEN_WALK_IN : origenCorto\(dto\.source\)/);
});
