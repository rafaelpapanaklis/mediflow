/**
 * Google Calendar → agenda (WS1-T9): las decisiones puras.
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoVigente,
  canalPorRenovar,
  clasificarErrorEntrante,
  decidirAvisoCita,
  decidirEvento,
  direccionDelAviso,
  doctorDelEvento,
  esEventoDeDaleControl,
  etiquetaRejilla,
  eventoOcupa,
  mismoSecreto,
  MOTIVO_GOOGLE,
  rangoDeEvento,
  tocaCompleta,
  type EventoGoogle,
} from "../entrante-core";

const ZONA = "America/Mexico_City"; // UTC-6 todo el año (sin horario de verano desde 2022)
const AHORA = new Date("2026-10-20T15:00:00Z");
const DOCTORES = [
  { id: "doc-ana", email: "ana@clinica.mx" },
  { id: "doc-luis", email: "Luis@Clinica.mx" },
];

const ev = (x: Partial<EventoGoogle> = {}): EventoGoogle => ({
  id: "abc123",
  status: "confirmed",
  summary: "Junta con proveedor",
  start: { dateTime: "2026-10-21T10:00:00-06:00" },
  end: { dateTime: "2026-10-21T11:00:00-06:00" },
  updated: "2026-10-20T14:00:00.000Z",
  ...x,
});

/* ═══ 1 · qué cierra la agenda ═════════════════════════════════════════ */

test("un evento ocupado cierra; «disponible», cancelado, ubicación de trabajo y cumpleaños no", () => {
  assert.equal(eventoOcupa(ev()), true);
  assert.equal(eventoOcupa(ev({ transparency: "opaque" })), true);
  assert.equal(eventoOcupa(ev({ transparency: "transparent" })), false);
  assert.equal(eventoOcupa(ev({ status: "cancelled" })), false);
  assert.equal(eventoOcupa(ev({ eventType: "workingLocation" })), false);
  assert.equal(eventoOcupa(ev({ eventType: "birthday" })), false);
  assert.equal(eventoOcupa(ev({ eventType: "outOfOffice" })), true);
});

test("el eco: los eventos de las citas de DaleControl se reconocen por la marca o por el id determinista", () => {
  assert.equal(esEventoDeDaleControl(ev({ extendedProperties: { private: { dalecontrolClinicId: "c1" } } })), true);
  assert.equal(esEventoDeDaleControl(ev({ extendedProperties: { private: { dalecontrolAppointmentId: "a1" } } })), true);
  assert.equal(esEventoDeDaleControl(ev({ id: "dc" + "a".repeat(40) })), true);
  assert.equal(esEventoDeDaleControl(ev({ id: "dc" + "a".repeat(39) })), false);
  assert.equal(esEventoDeDaleControl(ev()), false);
  assert.equal(esEventoDeDaleControl(ev({ extendedProperties: { private: { otraApp: "x" } } })), false);
});

test("rango con hora: instantes tal cual", () => {
  const r = rangoDeEvento(ev(), ZONA)!;
  assert.equal(r.startsAt.toISOString(), "2026-10-21T16:00:00.000Z");
  assert.equal(r.endsAt.toISOString(), "2026-10-21T17:00:00.000Z");
  assert.equal(r.allDay, false);
});

test("todo el día: de medianoche a medianoche EN LA ZONA DE LA CLÍNICA, fin exclusivo como Google", () => {
  const r = rangoDeEvento(ev({ start: { date: "2026-10-21" }, end: { date: "2026-10-22" } }), ZONA)!;
  assert.equal(r.allDay, true);
  assert.equal(r.startsAt.toISOString(), "2026-10-21T06:00:00.000Z");
  assert.equal(r.endsAt.toISOString(), "2026-10-22T06:00:00.000Z");
  // Tres días.
  const r3 = rangoDeEvento(ev({ start: { date: "2026-10-21" }, end: { date: "2026-10-24" } }), ZONA)!;
  assert.equal(r3.endsAt.toISOString(), "2026-10-24T06:00:00.000Z");
});

test("rango ilegible, al revés o de duración cero → null; uno de más de un año se recorta", () => {
  assert.equal(rangoDeEvento(ev({ start: null }), ZONA), null);
  assert.equal(rangoDeEvento(ev({ start: { dateTime: "nada" } }), ZONA), null);
  assert.equal(rangoDeEvento(ev({ end: { dateTime: "2026-10-21T10:00:00-06:00" } }), ZONA), null);
  const largo = rangoDeEvento(ev({ start: { date: "2026-01-01" }, end: { date: "2028-01-01" } }), ZONA)!;
  assert.equal((largo.endsAt.getTime() - largo.startsAt.getTime()) / 86_400_000, 366);
});

test("el doctor: el ÚNICO doctor invitado (sin mayúsculas); ninguno o varios → toda la clínica; el que rechazó no cuenta", () => {
  assert.equal(doctorDelEvento(ev({ attendees: [{ email: "ANA@clinica.mx" }] }), DOCTORES), "doc-ana");
  assert.equal(doctorDelEvento(ev({ attendees: [{ email: "luis@clinica.mx" }, { email: "x@gmail.com" }] }), DOCTORES), "doc-luis");
  assert.equal(doctorDelEvento(ev({ attendees: [{ email: "ana@clinica.mx" }, { email: "luis@clinica.mx" }] }), DOCTORES), null);
  assert.equal(doctorDelEvento(ev({ attendees: [] }), DOCTORES), null);
  assert.equal(doctorDelEvento(ev(), DOCTORES), null);
  assert.equal(doctorDelEvento(ev({ attendees: [{ email: "ana@clinica.mx", responseStatus: "declined" }] }), DOCTORES), null);
});

test("el título NO va al motivo: el motivo es genérico (el bot se lo dice al paciente)", () => {
  assert.equal(MOTIVO_GOOGLE, "Ocupado (Google)");
  assert.equal(etiquetaRejilla("Cita con el abogado"), "Ocupado (Google) · Cita con el abogado");
  assert.equal(etiquetaRejilla(""), "Ocupado (Google)");
});

/* ═══ 2 · decidir un evento ════════════════════════════════════════════ */

const ctx = (existente: Parameters<typeof decidirEvento>[1]["existente"] = null) => ({ zona: ZONA, ahora: AHORA, existente, doctores: DOCTORES });

test("nuevo y ocupado → crear, con título, doctor y la serie", () => {
  const d = decidirEvento(ev({ recurringEventId: "serie1", attendees: [{ email: "ana@clinica.mx" }] }), ctx());
  assert.equal(d.accion, "crear");
  if (d.accion !== "crear") return;
  assert.equal(d.datos.title, "Junta con proveedor");
  assert.equal(d.datos.doctorId, "doc-ana");
  assert.equal(d.datos.recurringEventId, "serie1");
  assert.equal(d.datos.startsAt.toISOString(), "2026-10-21T16:00:00.000Z");
});

test("lo que ya terminó o está a más de 400 días no se crea", () => {
  assert.equal(decidirEvento(ev({ start: { dateTime: "2026-10-19T10:00:00-06:00" }, end: { dateTime: "2026-10-19T11:00:00-06:00" } }), ctx()).accion, "nada");
  assert.equal(decidirEvento(ev({ start: { dateTime: "2028-01-10T10:00:00-06:00" }, end: { dateTime: "2028-01-10T11:00:00-06:00" } }), ctx()).accion, "nada");
});

test("los de DaleControl nunca crean bloqueo (eco); si por algo existía, se retira", () => {
  const nuestro = ev({ extendedProperties: { private: { dalecontrolClinicId: "c1" } } });
  assert.equal(decidirEvento(nuestro, ctx()).accion, "nada");
  const existente = { blockId: "b1", activo: true, doctorId: null, startsAt: new Date(), endsAt: new Date(), title: "x", allDay: false };
  assert.deepEqual(decidirEvento(nuestro, ctx(existente)), { accion: "inactivar", blockId: "b1" });
});

test("idempotente: el mismo evento con el mismo bloqueo → nada", () => {
  const r = rangoDeEvento(ev(), ZONA)!;
  const existente = { blockId: "b1", activo: true, doctorId: null, startsAt: r.startsAt, endsAt: r.endsAt, title: "Junta con proveedor", allDay: false };
  assert.equal(decidirEvento(ev(), ctx(existente)).accion, "nada");
});

test("se movió, cambió de título o volvió tras borrarse → actualizar (y reactivar)", () => {
  const r = rangoDeEvento(ev(), ZONA)!;
  const base = { blockId: "b1", activo: true, doctorId: null, startsAt: r.startsAt, endsAt: r.endsAt, title: "Junta con proveedor", allDay: false };
  const movido = ev({ start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } });
  assert.equal(decidirEvento(movido, ctx(base)).accion, "actualizar");
  assert.equal(decidirEvento(ev({ summary: "Otra cosa" }), ctx(base)).accion, "actualizar");
  assert.equal(decidirEvento(ev(), ctx({ ...base, activo: false })).accion, "actualizar");
});

test("eliminado, cancelado o pasado a «disponible» → el bloqueo se RETIRA (no se borra); sin bloqueo, nada", () => {
  const base = { blockId: "b1", activo: true, doctorId: null, startsAt: new Date(), endsAt: new Date(), title: "x", allDay: false };
  assert.deepEqual(decidirEvento(ev({ status: "cancelled" }), ctx(base)), { accion: "inactivar", blockId: "b1" });
  assert.deepEqual(decidirEvento(ev({ transparency: "transparent" }), ctx(base)), { accion: "inactivar", blockId: "b1" });
  assert.equal(decidirEvento(ev({ status: "cancelled" }), ctx({ ...base, activo: false })).accion, "nada");
  assert.equal(decidirEvento(ev({ status: "cancelled" }), ctx()).accion, "nada");
});

/* ═══ 3 · la cita convertida: avisar, nunca mover ni cancelar ══════════ */

const T10 = new Date("2026-10-21T16:00:00Z");
const T11 = new Date("2026-10-21T17:00:00Z");
const vinculo = (x = {}) => ({ eventStartsAt: T10, eventEndsAt: T11, eventDeletedAt: null as Date | null, avisoTipo: null as string | null, ...x });
const cita = (x = {}) => ({ status: "SCHEDULED", startsAt: T10, endsAt: T11, ...x });

test("Google movió el evento → aviso «movido» con la hora nueva; la cita no se toca", () => {
  const c = decidirAvisoCita(ev({ start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } }), vinculo(), cita(), { zona: ZONA, ahora: AHORA });
  assert.equal(c.avisoTipo, "movido");
  assert.equal(c.avisoStartsAt?.toISOString(), "2026-10-21T18:00:00.000Z");
  assert.equal(c.eventStartsAt?.toISOString(), "2026-10-21T18:00:00.000Z");
});

test("nuestro propio parche (Google quedó igual que la cita) → sin aviso", () => {
  // DaleControl movió la cita a las 12; el parche llevó el evento a las 12.
  const c12 = cita({ startsAt: new Date("2026-10-21T18:00:00Z"), endsAt: new Date("2026-10-21T19:00:00Z") });
  const c = decidirAvisoCita(ev({ start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } }), vinculo(), c12, { zona: ZONA, ahora: AHORA });
  assert.equal(c.avisoTipo, null);
  assert.equal(c.eventStartsAt?.toISOString(), "2026-10-21T18:00:00.000Z");
});

test("la cita se movió en DaleControl pero el parche aún no llega (o falló): Google sin cambios → NO hay aviso falso", () => {
  const c12 = cita({ startsAt: new Date("2026-10-21T18:00:00Z"), endsAt: new Date("2026-10-21T19:00:00Z") });
  assert.deepEqual(decidirAvisoCita(ev(), vinculo(), c12, { zona: ZONA, ahora: AHORA }), {});
});

test("Google eliminó el evento → aviso «eliminado»; con la cita ya cancelada, solo se anota", () => {
  const c = decidirAvisoCita(ev({ status: "cancelled" }), vinculo(), cita(), { zona: ZONA, ahora: AHORA });
  assert.equal(c.avisoTipo, "eliminado");
  assert.equal(c.eventDeletedAt?.toISOString(), AHORA.toISOString());
  const c2 = decidirAvisoCita(ev({ status: "cancelled" }), vinculo(), cita({ status: "CANCELLED" }), { zona: ZONA, ahora: AHORA });
  assert.equal(c2.avisoTipo, undefined);
  assert.ok(c2.eventDeletedAt);
  // Repetir el mismo borrado no cambia nada.
  assert.deepEqual(decidirAvisoCita(ev({ status: "cancelled" }), vinculo({ eventDeletedAt: AHORA }), cita(), { zona: ZONA, ahora: AHORA }), {});
});

test("el evento eliminado vuelve → se quita el aviso «eliminado»", () => {
  const c = decidirAvisoCita(ev(), vinculo({ eventDeletedAt: AHORA, avisoTipo: "eliminado" }), cita(), { zona: ZONA, ahora: AHORA });
  assert.equal(c.eventDeletedAt, null);
  assert.equal(c.avisoTipo, null);
});

test("avisoVigente: descartado, cita cerrada o ya movida a esa hora → no se enseña", () => {
  const nueva = { avisoTipo: "movido", avisoStartsAt: new Date("2026-10-21T18:00:00Z"), avisoEndsAt: new Date("2026-10-21T19:00:00Z"), avisoDescartadoAt: null };
  assert.equal(avisoVigente(nueva, cita())?.tipo, "movido");
  assert.equal(avisoVigente({ ...nueva, avisoDescartadoAt: AHORA }, cita()), null);
  assert.equal(avisoVigente(nueva, cita({ status: "CANCELLED" })), null);
  assert.equal(avisoVigente(nueva, cita({ startsAt: nueva.avisoStartsAt, endsAt: nueva.avisoEndsAt })), null);
  assert.equal(avisoVigente({ avisoTipo: "eliminado", avisoStartsAt: null, avisoEndsAt: null, avisoDescartadoAt: null }, cita())?.tipo, "eliminado");
  assert.equal(avisoVigente({ avisoTipo: null, avisoStartsAt: null, avisoEndsAt: null, avisoDescartadoAt: null }, cita()), null);
});

/* ═══ 4 · sincronización y canal ═══════════════════════════════════════ */

test("completa: sin token, calendario nuevo o pasada una semana", () => {
  const base = { syncToken: "t", calendarIdGuardado: "cal", calendarIdActual: "cal", lastFullSyncAt: AHORA, ahora: AHORA };
  assert.equal(tocaCompleta(base), false);
  assert.equal(tocaCompleta({ ...base, syncToken: null }), true);
  assert.equal(tocaCompleta({ ...base, calendarIdActual: "otro" }), true);
  assert.equal(tocaCompleta({ ...base, lastFullSyncAt: new Date(AHORA.getTime() - 8 * 86_400_000) }), true);
});

test("canal: se renueva sin canal, con menos de 2 días o si cambió el calendario", () => {
  const exp = (dias: number) => new Date(AHORA.getTime() + dias * 86_400_000);
  assert.equal(canalPorRenovar({ channelId: null, channelExpiresAt: null, calendarIdCanal: "cal" }, "cal", AHORA), true);
  assert.equal(canalPorRenovar({ channelId: "c", channelExpiresAt: exp(5), calendarIdCanal: "cal" }, "cal", AHORA), false);
  assert.equal(canalPorRenovar({ channelId: "c", channelExpiresAt: exp(1), calendarIdCanal: "cal" }, "cal", AHORA), true);
  assert.equal(canalPorRenovar({ channelId: "c", channelExpiresAt: exp(5), calendarIdCanal: "viejo" }, "cal", AHORA), true);
});

test("la dirección del aviso exige https (Google no avisa a http)", () => {
  assert.equal(direccionDelAviso("https://www.dalecontrol.com"), "https://www.dalecontrol.com/api/google/avisos");
  assert.equal(direccionDelAviso("http://127.0.0.1:3000"), null);
  assert.equal(direccionDelAviso(undefined), null);
  assert.equal(direccionDelAviso("no es url"), null);
});

test("token del canal: comparación exacta", () => {
  assert.equal(mismoSecreto("abc", "abc"), true);
  assert.equal(mismoSecreto("abc", "abd"), false);
  assert.equal(mismoSecreto("abc", "abcd"), false);
  assert.equal(mismoSecreto("", ""), false);
  assert.equal(mismoSecreto(null, "abc"), false);
});

test("errores: falta de permiso para LEER → «permisos» (pide reconectar); token muerto → «autorizacion»", () => {
  const g = (status: number, reason: string) => ({ response: { status, data: { error: { errors: [{ reason }] } } } });
  assert.equal(clasificarErrorEntrante(g(403, "insufficientPermissions")), "permisos");
  assert.equal(clasificarErrorEntrante({ message: "Request had insufficient authentication scopes. ACCESS_TOKEN_SCOPE_INSUFFICIENT" }), "permisos");
  assert.equal(clasificarErrorEntrante({ response: { status: 400, data: { error: "invalid_grant" } } }), "autorizacion");
  assert.equal(clasificarErrorEntrante(g(401, "authError")), "autorizacion");
  assert.equal(clasificarErrorEntrante(g(404, "notFound")), "calendario");
  assert.equal(clasificarErrorEntrante(g(500, "backendError")), "google");
  assert.equal(clasificarErrorEntrante(g(403, "rateLimitExceeded")), "google");
});
