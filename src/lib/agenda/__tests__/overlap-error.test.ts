import { test } from "node:test";
import assert from "node:assert/strict";
import { isAppointmentOverlapError } from "../transitions";

/**
 * Hallazgo 32 (mitad servidor). La base tiene `EXCLUDE USING gist`
 * (`appt_doctor_no_overlap`, SQLSTATE 23P01) que impide dos citas solapadas
 * del mismo doctor. Verificado en la app real: cita A 07:30–08:30 (201) y
 * luego B 08:15–08:45 con la misma doctora → **HTTP 500 internal_error**,
 * no el 409 `appointment_overlap` con el mensaje amable.
 *
 * Causa: Postgres no tiene mapeo Prisma para 23P01, así que el error NO llega
 * con `.code`; llega como PrismaClientUnknownRequestError con el SQLSTATE y el
 * nombre de la constraint DENTRO de `.message`. El detector solo miraba
 * `.code`, no acertaba, y el catch caía al 500 genérico.
 *
 * La forma correcta ya estaba al lado, en el vertical de barbería:
 * `isBarberOverlapError` (src/lib/barber/agenda.ts) reconoce las TRES formas.
 * Este es su gemelo dental.
 */

test("reconoce el 23P01 en su forma de query raw (P2010 + meta.code)", () => {
  assert.equal(isAppointmentOverlapError({ code: "P2010", meta: { code: "23P01" } }), true);
});

test("reconoce el 23P01 cuando llega como code pelado", () => {
  assert.equal(isAppointmentOverlapError({ code: "23P01" }), true);
});

test("reconoce el 23P01 que Prisma solo deja en el message (el caso real del 500)", () => {
  // Forma literal con la que el ORM propaga el rechazo de la constraint en un
  // `prisma.appointment.create()` — la que producía el 500 en producción.
  const err = {
    name: "PrismaClientUnknownRequestError",
    message:
      "Invalid `prisma.appointment.create()` invocation:\n\n" +
      "Error occurred during query execution:\n" +
      "ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(" +
      'PostgresError { code: "23P01", message: "conflicting key value violates ' +
      'exclusion constraint \\"appt_doctor_no_overlap\\"", severity: "ERROR" }), ' +
      "transient: false })",
  };
  assert.equal(isAppointmentOverlapError(err), true);
});

test("reconoce el texto de Postgres aunque cambie el nombre de la constraint", () => {
  // Hay más de una EXCLUDE sobre appointments (doctor y recurso); el detector
  // no debe depender del nombre exacto.
  assert.equal(
    isAppointmentOverlapError({
      message: 'conflicting key value violates exclusion constraint "appt_resource_no_overlap"',
    }),
    true,
  );
});

test("no confunde otros errores con un solape", () => {
  assert.equal(isAppointmentOverlapError({ code: "P2002" }), false);
  assert.equal(isAppointmentOverlapError({ code: "P2025" }), false);
  assert.equal(isAppointmentOverlapError({ code: "P2010", meta: { code: "23505" } }), false);
  assert.equal(isAppointmentOverlapError({ message: "connection timeout" }), false);
  assert.equal(isAppointmentOverlapError(new Error("boom")), false);
  assert.equal(isAppointmentOverlapError(null), false);
  assert.equal(isAppointmentOverlapError(undefined), false);
  assert.equal(isAppointmentOverlapError("23P01"), false);
});
