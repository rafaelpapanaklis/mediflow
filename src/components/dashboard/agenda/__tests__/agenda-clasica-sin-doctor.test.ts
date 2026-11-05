/**
 * La agenda de siempre (`AgendaShell`) con la cita «Sin doctor» (ws1-t11 · fase 2 · P2,
 * PLAN §1.4, §2.3 y §2.5; decisiones D1, D2 y D3).
 *
 * Run: node_modules/.bin/tsx --test src/components/dashboard/agenda/__tests__/agenda-clasica-sin-doctor.test.ts
 *
 *  · Día + «Doctores»: columna «Sin doctor» a la IZQUIERDA cuando la clínica puede agendar así o
 *    hay alguna cargada; sin el SQL y sin ninguna, las columnas son las de antes (antes de esto la
 *    cita sin doctor no tenía columna y desaparecía de la vista Día).
 *  · Clínica con un solo doctor: dos columnas, «Sin doctor» y la del doctor, iguales.
 *  · El hueco de «Sin doctor» abre «Nueva cita» con `doctorId: null`; el de un doctor, con él.
 *  · Un DOCTOR con una «Sin doctor»: llegada, sillón e iniciar sí; confirmar, cancelar,
 *    no-asistió y reabrir no (el servidor le daría 403).
 *
 * Con el código de f4d8fe31d falla: `columnas-dia.ts` y `quien-mira.tsx` no existían y la
 * vista Día filtraba por `a.doctor?.id === column.doctorId`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  columnaDeDoctorDe,
  columnasPorDoctor,
  doctorDelHuecoDe,
  esColumnaSinDoctor,
  type EntradaColumnasPorDoctor,
} from "@/components/dashboard/agenda/columnas-dia";
import { esDoctorConCitaSinDoctor, estadoPermitidoConSinDoctor, pasoPermitido } from "@/components/dashboard/agenda/quien-mira";
import { avisoAlQuitarDoctor } from "@/components/dashboard/agenda/aviso-quitar-doctor";
import { FILTRO_SIN_DOCTOR } from "@/lib/agenda/sin-doctor";
import { resolveDropTarget } from "@/lib/agenda/reschedule-flow";
import type { AgendaAppointmentDTO, DoctorColumnDTO } from "@/lib/agenda/types";

const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra
const DIA = "2026-11-05";
const TZ = "America/Mexico_City";

function doc(id: string, shortName: string, activeInAgenda = true): DoctorColumnDTO {
  return { id, displayName: shortName, shortName, color: null, activeInAgenda };
}

function cita(
  id: string,
  doctor: { id: string; shortName: string } | null,
  extra: Partial<AgendaAppointmentDTO> = {},
): AgendaAppointmentDTO {
  return {
    id,
    // 10:00 en la Ciudad de México.
    startsAt: `${DIA}T16:00:00.000Z`,
    endsAt: `${DIA}T16:30:00.000Z`,
    status: "CONFIRMED",
    patient: { id: `p-${id}`, name: "Paciente" },
    doctor: doctor ?? undefined,
    resourceId: null,
    ...extra,
  } as unknown as AgendaAppointmentDTO;
}

function entrada(p: Partial<EntradaColumnasPorDoctor>): EntradaColumnasPorDoctor {
  return {
    doctors: [doc(DRA, "Dra. Ana"), doc(DR_SIEMBRA, "Dr. Siembra")],
    appointments: [],
    dayISO: DIA,
    timezone: TZ,
    sinDoctorDisponible: false,
    slotsAvailablePerColumn: 48,
    slotMinutes: 15,
    nombreSinDoctor: "Sin doctor",
    nombreProfesional: "Profesional",
    ...p,
  };
}

test("sin el SQL y sin ninguna cita sin doctor, las columnas son las de siempre", () => {
  const cols = columnasPorDoctor(entrada({ appointments: [cita("a1", { id: DRA, shortName: "Dra. Ana" })] }));
  assert.deepEqual(cols.map((c) => c.doctorId), [DRA, DR_SIEMBRA]);
  assert.ok(!cols.some((c) => c.sinDoctor));
});

test("una cita sin doctor (importada de Dentalink) tiene columna, a la izquierda, y cae en ella", () => {
  const sinDoctor = cita("dentalink-appt-88231", null);
  const cols = columnasPorDoctor(
    entrada({ appointments: [sinDoctor, cita("a1", { id: DRA, shortName: "Dra. Ana" })] }),
  );
  assert.deepEqual(cols.map((c) => c.doctorId), [FILTRO_SIN_DOCTOR, DRA, DR_SIEMBRA]);
  const primera = cols[0]!;
  assert.equal(primera.sinDoctor, true);
  assert.equal(primera.title, "Sin doctor");
  assert.equal(primera.type, "doctor");
  assert.equal(primera.citas, 1);
  assert.match(String(primera.color), /^var\(--/, "gris del tema, sin hex nuevo");
  // La tarjeta va a la columna «Sin doctor» y a ninguna otra.
  assert.equal(columnaDeDoctorDe(sinDoctor), primera.doctorId);
  assert.ok(cols.slice(1).every((c) => c.doctorId !== columnaDeDoctorDe(sinDoctor)));
});

test("con el SQL pegado sale aunque ese día no haya ninguna (D2), y cuenta solo las vivas del día", () => {
  const vacia = columnasPorDoctor(entrada({ sinDoctorDisponible: true }));
  assert.equal(vacia[0]?.doctorId, FILTRO_SIN_DOCTOR);
  assert.equal(vacia[0]?.citas, 0);

  const cols = columnasPorDoctor(
    entrada({
      sinDoctorDisponible: true,
      appointments: [
        cita("s1", null),
        cita("s2", null, { status: "CANCELLED" } as Partial<AgendaAppointmentDTO>),
        cita("s3", null, { startsAt: "2026-11-06T16:00:00.000Z", endsAt: "2026-11-06T16:30:00.000Z" }),
      ],
    }),
  );
  assert.equal(cols[0]?.citas, 1);
});

test("clínica con UN solo doctor: «Sin doctor» + su columna, sin huérfanos ni columnas de más", () => {
  const cols = columnasPorDoctor(
    entrada({
      doctors: [doc(DRA, "Dra. Ana")],
      sinDoctorDisponible: true,
      appointments: [cita("s1", null), cita("a1", { id: DRA, shortName: "Dra. Ana" })],
    }),
  );
  assert.deepEqual(cols.map((c) => c.key), [`doctor:${FILTRO_SIN_DOCTOR}`, `doctor:${DRA}`]);
  // Claves únicas (React) y ninguna con el id virtual disfrazado de doctor.
  assert.equal(new Set(cols.map((c) => c.key)).size, cols.length);
});

test("el hueco de «Sin doctor» abre «Nueva cita» en «Sin doctor»; el de un doctor, con él", () => {
  assert.equal(doctorDelHuecoDe({ doctorId: FILTRO_SIN_DOCTOR }), null);
  assert.equal(doctorDelHuecoDe({ doctorId: DRA }), DRA);
  assert.equal(doctorDelHuecoDe({ doctorId: null }), undefined);
  assert.equal(esColumnaSinDoctor(FILTRO_SIN_DOCTOR), true);
  assert.equal(esColumnaSinDoctor(DR_SIEMBRA), false);
});

test("soltar en la columna «Sin doctor» le quita el doctor; en la de un doctor, se lo pone", () => {
  const conDoctor = cita("a1", { id: DRA, shortName: "Dra. Ana" });
  const quita = resolveDropTarget(conDoctor, { kind: "doctor-col", columnKey: `doctor:${FILTRO_SIN_DOCTOR}`, doctorId: FILTRO_SIN_DOCTOR, resourceId: null }, DIA);
  assert.equal(quita.newDoctorId, null);
  const pone = resolveDropTarget(cita("dentalink-appt-88231", null), { kind: "doctor-col", columnKey: `doctor:${DR_SIEMBRA}`, doctorId: DR_SIEMBRA, resourceId: null }, DIA);
  assert.equal(pone.newDoctorId, DR_SIEMBRA);
});

test("un DOCTOR con una «Sin doctor»: pasa al sillón e inicia; no confirma, cancela ni la marca no-asistió", () => {
  const base = { role: "DOCTOR", userId: DRA, citaDoctorId: null };
  for (const destino of ["IN_CHAIR", "IN_PROGRESS"]) {
    assert.equal(estadoPermitidoConSinDoctor({ ...base, destino }), true, destino);
    assert.equal(pasoPermitido({ ...base, desde: "SCHEDULED", destino: destino as any }), true, destino);
  }
  // v2 (m1): «Llegó» es de recepción por la tabla de roles (transitions.ts): a un DOCTOR no se le ofrece, ni en
  // una «Sin doctor» ni en las suyas (el servidor le daría 403). Recepción sí la ve.
  assert.equal(pasoPermitido({ ...base, desde: "SCHEDULED", destino: "CHECKED_IN" }), false);
  assert.equal(pasoPermitido({ ...base, citaDoctorId: DRA, desde: "CONFIRMED", destino: "CHECKED_IN" }), false);
  assert.equal(pasoPermitido({ role: "RECEPTIONIST", userId: "u", citaDoctorId: null, desde: "SCHEDULED", destino: "CHECKED_IN" }), true);
  assert.equal(pasoPermitido({ role: undefined, userId: undefined, citaDoctorId: null, desde: "SCHEDULED", destino: "CHECKED_IN" }), true, "sin rol: lo de siempre");
  for (const destino of ["CONFIRMED", "CANCELLED", "NO_SHOW", "SCHEDULED"]) {
    assert.equal(estadoPermitidoConSinDoctor({ ...base, destino }), false, destino);
  }
  // Su propia cita y los demás roles: como siempre (no se filtra nada).
  assert.equal(estadoPermitidoConSinDoctor({ ...base, citaDoctorId: DRA, destino: "CANCELLED" }), true);
  assert.equal(estadoPermitidoConSinDoctor({ role: "RECEPTIONIST", userId: "u", citaDoctorId: null, destino: "CANCELLED" }), true);
  // Sin rol conocido (montado fuera de la agenda): lo de siempre.
  assert.equal(estadoPermitidoConSinDoctor({ role: undefined, userId: undefined, citaDoctorId: null, destino: "NO_SHOW" }), true);

  assert.equal(esDoctorConCitaSinDoctor("DOCTOR", { doctor: null }), true);
  assert.equal(esDoctorConCitaSinDoctor("DOCTOR", { doctor: { id: DRA } }), false);
  assert.equal(esDoctorConCitaSinDoctor("ADMIN", { doctor: null }), false);
});

test("v2 (M2, m4): soltar en «Sin doctor» una cita que no puede quedarse sin doctor da su aviso y no se mueve", () => {
  const conDoctor = (extra: Record<string, unknown> = {}) => ({ doctor: { id: DRA }, status: "SCHEDULED", isTeleconsult: false, ...extra });
  assert.equal(avisoAlQuitarDoctor(conDoctor(), null, "DOCTOR"), "agenda.sinDoctor.avisos.doctorPropia");
  assert.equal(avisoAlQuitarDoctor(conDoctor({ isTeleconsult: true }), null, "ADMIN"), "agenda.sinDoctor.avisos.teleconsulta");
  assert.equal(avisoAlQuitarDoctor(conDoctor({ status: "IN_PROGRESS" }), null, "RECEPTIONIST"), "agenda.sinDoctor.avisos.enConsulta");
  // Recepción sí la deja «Sin doctor»; cambiar de doctor o mover una «Sin doctor» no avisa.
  assert.equal(avisoAlQuitarDoctor(conDoctor(), null, "RECEPTIONIST"), null);
  assert.equal(avisoAlQuitarDoctor(conDoctor(), DR_SIEMBRA, "DOCTOR"), null);
  assert.equal(avisoAlQuitarDoctor({ doctor: null, status: "SCHEDULED" }, null, "DOCTOR"), null);
});
