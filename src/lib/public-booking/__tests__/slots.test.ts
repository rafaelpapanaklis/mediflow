/**
 * Huecos por SOLAPE de la reserva pública (P1-10).
 *
 * Run: npm run test:public-slots
 *
 * El caso que rompía producción: cita 10:00–11:00 → el cálculo viejo (por
 * igualdad de hora de inicio) dejaba "10:30" como disponible, el público la
 * elegía y el INSERT moría contra appt_doctor_no_overlap con un 500 crudo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tzLocalToUtc } from "../../agenda/time-utils";
import { partitionSlotsByOverlap, slotOverlapsBusy } from "../slots";

const TZ = "America/Mexico_City";
const DAY = "2026-08-10"; // lunes

function busyInterval(startHHMM: string, endHHMM: string) {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return {
    startsAt: tzLocalToUtc(DAY, sh, sm, TZ),
    endsAt: tzLocalToUtc(DAY, eh, em, TZ),
  };
}

const MORNING = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];

test("una cita de 10:00–11:00 tapa 10:00 Y 10:30 (no solo su hora de inicio)", () => {
  const { available, taken } = partitionSlotsByOverlap(
    MORNING, DAY, TZ, 30, [busyInterval("10:00", "11:00")],
  );
  assert.deepEqual(taken, ["10:00", "10:30"]);
  assert.deepEqual(available, ["09:00", "09:30", "11:00", "11:30"]);
});

test("una cita de 90 min (09:30–11:00) tapa 09:30, 10:00 y 10:30", () => {
  const { available, taken } = partitionSlotsByOverlap(
    MORNING, DAY, TZ, 30, [busyInterval("09:30", "11:00")],
  );
  assert.deepEqual(taken, ["09:30", "10:00", "10:30"]);
  assert.deepEqual(available, ["09:00", "11:00", "11:30"]);
});

test("cita que empieza a mitad de slot (10:15–10:45) tapa 10:00 y 10:30", () => {
  const { taken } = partitionSlotsByOverlap(
    MORNING, DAY, TZ, 30, [busyInterval("10:15", "10:45")],
  );
  assert.deepEqual(taken, ["10:00", "10:30"]);
});

test("los intervalos son [inicio, fin): tocar el borde NO es solape", () => {
  // Cita 10:00–10:30 → el slot 10:30 queda libre (empieza justo cuando acaba).
  const { available, taken } = partitionSlotsByOverlap(
    MORNING, DAY, TZ, 30, [busyInterval("10:00", "10:30")],
  );
  assert.deepEqual(taken, ["10:00"]);
  assert.ok(available.includes("10:30"));
  assert.ok(available.includes("09:30"));
});

test("sin citas ocupadas todo queda disponible; varias citas se acumulan", () => {
  const empty = partitionSlotsByOverlap(MORNING, DAY, TZ, 30, []);
  assert.deepEqual(empty.available, MORNING);
  assert.deepEqual(empty.taken, []);

  const dos = partitionSlotsByOverlap(MORNING, DAY, TZ, 30, [
    busyInterval("09:00", "09:30"),
    busyInterval("11:00", "12:00"),
  ]);
  assert.deepEqual(dos.taken, ["09:00", "11:00", "11:30"]);
  assert.deepEqual(dos.available, ["09:30", "10:00", "10:30"]);
});

test("slotOverlapsBusy compara en UTC real (tz de la clínica, no del server)", () => {
  const slotStart = tzLocalToUtc(DAY, 10, 0, TZ);
  assert.equal(slotOverlapsBusy(slotStart, 30, [busyInterval("10:00", "11:00")]), true);
  assert.equal(slotOverlapsBusy(slotStart, 30, [busyInterval("10:30", "11:00")]), false);
});
