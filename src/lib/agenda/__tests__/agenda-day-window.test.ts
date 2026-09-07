import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agendaDayFetchRange,
  dayRangeUtc,
  slotIndexToUtc,
  slotsPerDay,
  type ClinicTimeConfig,
} from "../time-utils";
import { buildOccupiedSlotSet } from "../overlap-client";
import type { AgendaAppointmentDTO } from "../types";

/**
 * Hallazgos 40 y 32 (mitad picker). La agenda leía el día con `dayRangeUtc`,
 * que NO es el día natural sino la VENTANA DE HORARIO (`dayStart`–`dayEnd`,
 * 08–20 por defecto). Consecuencias verificadas en la app real:
 *
 *  · 40 — una cita de 23:30 no aparece en la rejilla de su propio día, y una
 *    de 07:30 tampoco, aunque el contador "CITAS HOY" sí las cuenta.
 *  · 32 — el SlotGridPicker pide `/api/appointments?date=` para saber qué
 *    está ocupado. Como la cita de 07:30–08:30 nunca llega en esa respuesta,
 *    el picker pinta las 08:00 como libres y al guardar revienta contra la
 *    constraint EXCLUDE.
 *
 * La forma correcta ya estaba al lado: la SSR de la agenda
 * (src/app/dashboard/agenda/page.tsx) usa `viewRangeUtc("day", …)` = día
 * calendario completo `[00:00, 24:00)`, con un comentario que explica que
 * usar `[dayStart, dayEnd)` desincronizaba contadores y render ("Bug B").
 * `agendaDayFetchRange` es esa misma ventana, aplicada a la lectura del día.
 */

const CONFIG: ClinicTimeConfig = {
  timezone: "America/Mexico_City",
  slotMinutes: 30,
  dayStart: 8,
  dayEnd: 20,
};
const DIA = "2026-09-08";

// Las tres citas del QA en la clínica de prueba, en UTC (MX = UTC-6):
const CITA_0730 = new Date("2026-09-08T13:30:00Z"); // 07:30 local — antes de abrir
const CITA_1000 = new Date("2026-09-08T16:00:00Z"); // 10:00 local — dentro
const CITA_2330 = new Date("2026-09-09T05:30:00Z"); // 23:30 local — después de cerrar

function dentro(range: { startUtc: Date; endUtc: Date }, t: Date): boolean {
  return t >= range.startUtc && t < range.endUtc;
}

test("40: el día que la agenda LEE es el natural, no el horario de atención", () => {
  const nuevo = agendaDayFetchRange(DIA, CONFIG);
  assert.ok(dentro(nuevo, CITA_0730), "la cita de 07:30 debe entrar en el día");
  assert.ok(dentro(nuevo, CITA_1000), "la cita de 10:00 debe entrar en el día");
  assert.ok(dentro(nuevo, CITA_2330), "la cita de 23:30 debe entrar en el día");
});

test("40: la ventana de HORARIO (dayRangeUtc) sigue siendo lo que era", () => {
  // No se toca: `dayRangeUtc` es la ventana de atención y la usan el eje y las
  // validaciones de horario. Lo que cambia es cuál de las dos LEE las citas.
  const horario = dayRangeUtc(DIA, CONFIG);
  assert.equal(dentro(horario, CITA_0730), false);
  assert.equal(dentro(horario, CITA_1000), true);
  assert.equal(dentro(horario, CITA_2330), false);
});

test("40: la cita que cruza medianoche pertenece al día en que empieza", () => {
  // 23:30 del 8 → 00:15 del 9. Debe salir en la agenda del 8 (hoy no sale en
  // ninguna de las dos), y NO debe colarse en la del 7.
  const dia8 = agendaDayFetchRange("2026-09-08", CONFIG);
  const dia7 = agendaDayFetchRange("2026-09-07", CONFIG);
  assert.ok(dentro(dia8, CITA_2330));
  assert.equal(dentro(dia7, CITA_2330), false);
});

test("32: el picker marca 08:00 OCUPADO por una cita de 07:30–08:30", () => {
  const doctorId = "doc-1";
  const cita: AgendaAppointmentDTO = {
    id: "a-0730",
    startsAt: CITA_0730.toISOString(),
    endsAt: new Date("2026-09-08T14:30:00Z").toISOString(), // 08:30 local
    status: "SCHEDULED",
    patient: { id: "p1", name: "Paciente QA" },
    doctor: { id: doctorId, shortName: "Dra. QA" },
    resourceId: null,
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
  } as AgendaAppointmentDTO;

  const total = slotsPerDay(CONFIG);
  const dayStartUtcMs = slotIndexToUtc(0, DIA, CONFIG).getTime(); // 08:00 local

  // Lo que el picker RECIBE es exactamente lo que la ventana de lectura deja
  // pasar. Con la ventana vieja la cita no llegaba nunca.
  const visibleAntes = [cita].filter((a) =>
    dentro(dayRangeUtc(DIA, CONFIG), new Date(a.startsAt)),
  );
  const visibleAhora = [cita].filter((a) =>
    dentro(agendaDayFetchRange(DIA, CONFIG), new Date(a.startsAt)),
  );

  assert.equal(visibleAntes.length, 0, "así se perdía la cita de 07:30");
  assert.equal(visibleAhora.length, 1);

  const ocupadoAntes = buildOccupiedSlotSet(
    visibleAntes, { doctorId }, dayStartUtcMs, CONFIG.slotMinutes, total,
  );
  const ocupadoAhora = buildOccupiedSlotSet(
    visibleAhora, { doctorId }, dayStartUtcMs, CONFIG.slotMinutes, total,
  );

  // slot 0 = 08:00. Es el hueco que el picker ofrecía y que reventaba al guardar.
  assert.equal(ocupadoAntes.has(0), false, "el bug: 08:00 se pintaba libre");
  assert.equal(ocupadoAhora.has(0), true, "el arreglo: 08:00 sale ocupado");
});
