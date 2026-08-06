/**
 * Las TRES puertas que escriben `status: COMPLETED` (Ola crítica · P1-1).
 *
 * Run: npm run test:close-appointment
 *
 * PATCH /status, PATCH /[id]/complete y POST /api/teleconsulta/end cierran la
 * misma cita. Sólo la primera validaba el estado de origen: `/complete` tenía
 * gate de ROL pero no de ESTADO (un DOCTOR "completaba" —y FIRMABA la nota,
 * NOM-004— una cita ya CANCELLED o NO_SHOW) y `/end` no tenía ninguno.
 *
 * Aquí se fija que las tres cuenten la misma historia, y que apretarlas NO
 * rompa el flujo vivo de la clínica.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, canCloseTeleconsulta } from "../transitions";
import type { AppointmentStatus } from "../types";

const NOW = new Date("2026-08-06T18:00:00.000Z");
const STARTED_1H_AGO = new Date("2026-08-06T17:00:00.000Z");

const TERMINALES: AppointmentStatus[] = ["CANCELLED", "NO_SHOW", "COMPLETED", "CHECKED_OUT"];

// ── PATCH /[id]/complete ─────────────────────────────────────────────────

test("/complete: el flujo vivo sigue funcionando (IN_PROGRESS → COMPLETED)", () => {
  // El ÚNICO caller (patient-detail-client.tsx) solo arma el botón de cerrar
  // cuando la cita está IN_PROGRESS. Si esto se rompe, se rompe la consulta.
  for (const role of ["DOCTOR", "ADMIN", "SUPER_ADMIN"] as const) {
    assert.equal(
      canTransition("IN_PROGRESS", "COMPLETED", role, NOW, STARTED_1H_AGO).ok,
      true,
      `${role} debe poder cerrar una consulta en curso`,
    );
  }
  // El atajo de la consulta corta en sillón también.
  assert.equal(canTransition("IN_CHAIR", "COMPLETED", "DOCTOR", NOW, STARTED_1H_AGO).ok, true);
});

test("/complete: cerrar (y FIRMAR) una cita ya terminal se rechaza — el bug P1-1", () => {
  for (const from of TERMINALES) {
    const r = canTransition(from, "COMPLETED", "DOCTOR", NOW, STARTED_1H_AGO);
    assert.equal(r.ok, false, `un DOCTOR no debe poder completar una cita ${from}`);
    // Estado inválido = 409, no 403: el problema es el QUÉ, no el QUIÉN.
    assert.notEqual(r.code, "forbidden_role");
  }
});

test("/complete: cerrar dos veces la misma cita se rechaza", () => {
  const r = canTransition("COMPLETED", "COMPLETED", "DOCTOR", NOW, STARTED_1H_AGO);
  assert.equal(r.ok, false);
  assert.equal(r.code, "same_status");
});

test("/complete: ni siquiera un SUPER_ADMIN resucita una cancelada a COMPLETED", () => {
  // Su escape es CANCELLED → SCHEDULED, no CANCELLED → COMPLETED. Si alguien
  // quiere cerrarla, primero la reagenda: queda rastro de las dos.
  assert.equal(canTransition("CANCELLED", "COMPLETED", "SUPER_ADMIN", NOW, STARTED_1H_AGO).ok, false);
  assert.equal(canTransition("CANCELLED", "SCHEDULED", "SUPER_ADMIN", NOW, STARTED_1H_AGO).ok, true);
});

// ── POST /api/teleconsulta/end ───────────────────────────────────────────

test("teleconsulta: colgar cierra la cita desde donde de verdad está", () => {
  // Nada en el flujo de teleconsulta mueve la cita a IN_PROGRESS, así que al
  // colgar sigue en SCHEDULED o CONFIRMED. Si esto fallara, TODA teleconsulta
  // quedaría abierta para siempre (el cliente ni mira la respuesta).
  for (const from of ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] as const) {
    assert.equal(
      canCloseTeleconsulta(from, "DOCTOR", NOW, STARTED_1H_AGO).ok,
      true,
      `colgar desde ${from} debe cerrar la cita`,
    );
  }
});

test("teleconsulta: NO se puede cerrar una cita terminal — el agujero que se cerró", () => {
  for (const from of TERMINALES) {
    assert.equal(
      canCloseTeleconsulta(from, "DOCTOR", NOW, STARTED_1H_AGO).ok,
      false,
      `colgar no debe reabrir/cerrar una cita ${from}`,
    );
  }
});

test("teleconsulta: el doble salto NO afloja la matriz para nadie más", () => {
  // La ruta ya exige ser el doctor asignado, pero el rol se valida igual: una
  // recepcionista no cierra una consulta por esta puerta, igual que no la
  // cierra por /status.
  assert.equal(canCloseTeleconsulta("SCHEDULED", "RECEPTIONIST", NOW, STARTED_1H_AGO).ok, false);
  assert.equal(canCloseTeleconsulta("IN_PROGRESS", "RECEPTIONIST", NOW, STARTED_1H_AGO).ok, false);
  assert.equal(canCloseTeleconsulta("SCHEDULED", "READONLY", NOW, STARTED_1H_AGO).ok, false);

  // Y el atajo sigue sin existir por la puerta normal: cerrar directo desde
  // SCHEDULED por /status o /complete se rechaza, aunque teleconsulta pueda.
  assert.equal(canTransition("SCHEDULED", "COMPLETED", "DOCTOR", NOW, STARTED_1H_AGO).ok, false);
});

test("teleconsulta: el rechazo por rol se distingue del rechazo por estado", () => {
  // La ruta mapea forbidden_role → 403 y el resto → 409. Si el código se
  // perdiera, un problema de estado se reportaría como falta de permiso.
  const porRol = canCloseTeleconsulta("SCHEDULED", "READONLY", NOW, STARTED_1H_AGO);
  assert.equal(porRol.code, "forbidden_role");
  const porEstado = canCloseTeleconsulta("CANCELLED", "DOCTOR", NOW, STARTED_1H_AGO);
  assert.equal(porEstado.code, "not_allowed");
});
