// ws1-t1 (auditoría BEVADENT, F7) — «Reagendar próxima» mueve la cita que ya existe; sin ella, «Nueva cita» llega
// prellenada; y «Nuevo plan de tratamiento» deja de proponer `doctors[0]`.
// Con el código de antes: no existe `reagendar-proxima`, la cabecera llama a `openNewAppointmentForPatient` y el
// plan nace con `doctors?.[0]?.id`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  citaParaReagendar,
  doctorParaNuevoPlan,
  dtoParaMoverCita,
  prellenadoDeNuevaCita,
  ultimaCitaDelPaciente,
} from "../reagendar-proxima";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const ZONA = "America/Mexico_City";
// 3-oct-2026, 12:00 en Ciudad de México.
const AHORA = new Date("2026-10-03T18:00:00.000Z");

const cita = (id: string, startsAt: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  startsAt,
  status,
  doctorId: (extra.doctorId as string) ?? "doc_a",
  ...extra,
});

// Llegan como las manda la ficha: de la más lejana a la más vieja.
const CITAS = [
  cita("futura_lejana", "2026-10-20T16:00:00.000Z", "SCHEDULED", { doctorId: "doc_b" }),
  cita("futura_proxima", "2026-10-07T16:00:00.000Z", "CONFIRMED", { doctorId: "doc_b", resourceId: "sillon_2" }),
  cita("cancelada_reciente", "2026-10-01T16:00:00.000Z", "CANCELLED", { doctorId: "doc_z" }),
  cita("ultima", "2026-09-25T16:00:00.000Z", "COMPLETED", {
    doctorId: "doc_c",
    resourceId: "sillon_1",
    type: "Limpieza dental",
  }),
  cita("vieja", "2026-08-01T16:00:00.000Z", "COMPLETED", { doctorId: "doc_d", resourceId: "sillon_3", type: "Resina" }),
];

test("con una cita por delante, «Reagendar próxima» abre la más próxima (no la más lejana)", () => {
  assert.equal(citaParaReagendar(CITAS, AHORA, ZONA)?.id, "futura_proxima");
});

test("la de hoy aún sin atender cuenta; una en la que el paciente ya está no se reagenda", () => {
  const hoy = [cita("hoy", "2026-10-03T22:00:00.000Z", "SCHEDULED"), ...CITAS];
  assert.equal(citaParaReagendar(hoy, AHORA, ZONA)?.id, "hoy");
  const enConsulta = [cita("en_consulta", "2026-10-03T17:30:00.000Z", "IN_PROGRESS"), ...CITAS];
  assert.equal(citaParaReagendar(enConsulta, AHORA, ZONA)?.id, "futura_proxima");
});

test("sin nada por delante no hay cita que mover", () => {
  const pasadas = CITAS.filter((c) => !c.id.startsWith("futura"));
  assert.equal(citaParaReagendar(pasadas, AHORA, ZONA), null);
});

test("la última cita: la más reciente que ya empezó, sin contar canceladas", () => {
  assert.equal(ultimaCitaDelPaciente(CITAS, AHORA)?.id, "ultima");
  assert.equal(ultimaCitaDelPaciente([], AHORA), null);
});

test("«Nueva cita» prellenada con el doctor, el consultorio y el motivo de su última cita, y luego el tratante", () => {
  assert.deepEqual(prellenadoDeNuevaCita(CITAS, { ahora: AHORA, tratanteId: "doc_t" }), {
    initialDoctorIds: ["doc_c", "doc_t"],
    initialResourceId: "sillon_1",
    initialReason: "Limpieza dental",
  });
  // Paciente nuevo: solo el tratante; sin consultorio ni motivo inventados.
  assert.deepEqual(prellenadoDeNuevaCita([], { ahora: AHORA, tratanteId: "doc_t" }), { initialDoctorIds: ["doc_t"] });
  assert.deepEqual(prellenadoDeNuevaCita([], { ahora: AHORA }), { initialDoctorIds: [] });
});

test("plan nuevo: el doctor de su última cita; si no atiende, el usuario en sesión; si tampoco, el primero", () => {
  const doctorIds = ["doc_x", "doc_c", "doc_yo"];
  assert.equal(doctorParaNuevoPlan(CITAS, { ahora: AHORA, usuarioId: "doc_yo", doctorIds }), "doc_c");
  assert.equal(doctorParaNuevoPlan([], { ahora: AHORA, usuarioId: "doc_yo", doctorIds }), "doc_yo");
  assert.equal(doctorParaNuevoPlan(CITAS, { ahora: AHORA, usuarioId: "recepcion", doctorIds: ["doc_x", "doc_yo"] }), "doc_x");
  assert.equal(doctorParaNuevoPlan([], { ahora: AHORA, usuarioId: "recepcion", doctorIds: [] }), "");
});

test("la cita de la ficha en la forma que lee la ventana de mover", () => {
  const dto = dtoParaMoverCita(
    { ...CITAS[1], endsAt: "2026-10-07T16:45:00.000Z", type: "Control" },
    { id: "pac_1", nombre: "Paciente Ficticio" },
  );
  assert.equal(dto?.id, "futura_proxima");
  assert.equal(dto?.endsAt, "2026-10-07T16:45:00.000Z");
  assert.equal(dto?.doctor?.id, "doc_b");
  assert.equal(dto?.resourceId, "sillon_2");
  assert.equal(dto?.reason, "Control");
  assert.equal(dtoParaMoverCita(null, { id: "p", nombre: "x" }), null);
});

test("la ficha usa la regla: la cabecera reagenda y el plan ya no nace con doctors[0]", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /onReschedule=\{reagendarProxima\}/);
  assert.doesNotMatch(ficha, /onReschedule=\{openNewAppointmentForPatient\}/);
  assert.match(ficha, /doctorId: doctorParaNuevoPlan\(appointments,/);
  assert.doesNotMatch(ficha, /doctorId: doctors\?\.\[0\]\?\.id/);
  // Sin rediseño también se mueve: la página carga la agenda siempre.
  assert.doesNotMatch(leer("app/dashboard/patients/[id]/page.tsx"), /const agendaCitas = rediseno/);

  const dialogo = leer("components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(dialogo, /\.\.\.\(params\?\.initialDoctorIds \?\? \[\]\)/);
  assert.match(dialogo, /params\?\.initialResourceId/);
});
