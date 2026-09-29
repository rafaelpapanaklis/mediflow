import { test } from "node:test";
import assert from "node:assert/strict";
import { visitasConHojas } from "../visitas-con-hojas";

const zona = "America/Mexico_City";
const d = (s: string) => new Date(s);

test("un control firmado sin cita cuenta como visita", () => {
  assert.equal(visitasConHojas({ citasCompletadas: [], hojasFirmadas: [{ appointmentId: null, visitDate: d("2026-09-28T19:00:00Z") }], zona }), 1);
});
test("una hoja firmada cuya cita nadie marcó atendida cuenta (Adulto Debe)", () => {
  assert.equal(visitasConHojas({ citasCompletadas: [], hojasFirmadas: [{ appointmentId: "cita-1", visitDate: d("2026-09-28T19:00:00Z") }], zona }), 1);
});
test("la hoja y su cita completada son la misma visita, no dos", () => {
  const r = visitasConHojas({
    citasCompletadas: [{ id: "cita-1", startsAt: d("2026-09-28T19:00:00Z") }],
    hojasFirmadas: [{ appointmentId: "cita-1", visitDate: d("2026-09-28T19:00:00Z") }],
    zona,
  });
  assert.equal(r, 1);
});
test("una hoja suelta del mismo día que una cita atendida no suma; de otro día, sí", () => {
  const citas = [{ id: "c", startsAt: d("2026-09-28T16:00:00Z") }];
  assert.equal(visitasConHojas({ citasCompletadas: citas, hojasFirmadas: [{ appointmentId: null, visitDate: d("2026-09-28T20:00:00Z") }], zona }), 1);
  assert.equal(visitasConHojas({ citasCompletadas: citas, hojasFirmadas: [{ appointmentId: null, visitDate: d("2026-09-29T20:00:00Z") }], zona }), 2);
});
test("dos hojas sueltas del mismo día son una sola visita", () => {
  const h = (t: string) => ({ appointmentId: null, visitDate: d(t) });
  assert.equal(visitasConHojas({ citasCompletadas: [], hojasFirmadas: [h("2026-09-28T16:00:00Z"), h("2026-09-28T20:00:00Z")], zona }), 1);
});
