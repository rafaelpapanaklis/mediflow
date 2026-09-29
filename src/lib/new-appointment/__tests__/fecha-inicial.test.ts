import { test } from "node:test";
import assert from "node:assert/strict";
import { diaDeLaAgendaVisible, diaInicialDeNuevaCita, esDiaISO } from "../fecha-inicial";

test("valida días de calendario", () => {
  assert.equal(esDiaISO("2026-09-29"), true);
  assert.equal(esDiaISO("2026-02-31"), false);
  assert.equal(esDiaISO("29-09-2026"), false);
  assert.equal(esDiaISO(null), false);
});

test("lee el día de la agenda solo estando en la agenda", () => {
  assert.equal(diaDeLaAgendaVisible("/dashboard/agenda", "?date=2026-09-29&view=day"), "2026-09-29");
  assert.equal(diaDeLaAgendaVisible("/dashboard/patients", "?date=2026-09-29"), null);
  assert.equal(diaDeLaAgendaVisible("/dashboard/agenda", "?date=basura"), null);
  assert.equal(diaDeLaAgendaVisible("/dashboard/agenda", ""), null);
});

test("abre con el día visto; sin él, hoy; nunca uno pasado", () => {
  const hoy = "2026-09-28";
  assert.equal(diaInicialDeNuevaCita({ visible: "2026-09-29", hoy }), "2026-09-29");
  assert.equal(diaInicialDeNuevaCita({ visible: null, hoy }), hoy);
  assert.equal(diaInicialDeNuevaCita({ visible: "2026-09-01", hoy }), hoy);
  assert.equal(diaInicialDeNuevaCita({ pedido: "2026-10-05", visible: "2026-09-29", hoy }), "2026-10-05");
});
