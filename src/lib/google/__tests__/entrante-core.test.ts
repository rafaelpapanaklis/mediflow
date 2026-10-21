/**
 * Google Calendar → agenda (WS1-T9): las decisiones puras.
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bloqueosSinMantener,
  duenoDeLaCuenta,
  firmaEquipo,
  SIN_MANTENER_RETIRA_MS,
  avisoVigente,
  calendarioImportable,
  canalPorRenovar,
  clasificarErrorEntrante,
  decidirAvisoCita,
  decidirEvento,
  direccionDelAviso,
  esEventoDeDaleControl,
  etiquetaRejilla,
  eventoOcupa,
  mismoSecreto,
  MENSAJE_PACIENTE_GOOGLE,
  MOTIVO_GOOGLE,
  puedeVerTitulo,
  rangoDeEvento,
  tocaCompleta,
  type EventoGoogle,
} from "../entrante-core";

const ZONA = "America/Mexico_City"; // UTC-6 todo el año (sin horario de verano desde 2022)
const AHORA = new Date("2026-10-20T15:00:00Z");
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

test("N-G6: el título «🏥 tipo — paciente» o el pie «Agendado desde DaleControl» SOLOS ya no son eco (un duplicado a mano los copia)", () => {
  // Lo que sí es eco lo decide quien llama: una cita ligada a ese evento (`eventosDeCitas`).
  assert.equal(esEventoDeDaleControl(ev({ description: "Tipo: Limpieza\nClínica: X\n\nAgendado desde DaleControl" })), false);
  assert.equal(esEventoDeDaleControl(ev({ summary: "🏥 Limpieza — Ana G." })), false);
  const duplicado = ev({ summary: "🏥 Limpieza — Ana G.", description: "Agendado desde DaleControl", attendees: [{ email: "ana@clinica.mx" }] });
  const d = decidirEvento(duplicado, { zona: ZONA, ahora: new Date("2026-10-20T00:00:00Z"), existente: null, dueno: "doc-ana" });
  assert.equal(d.accion, "crear");
});

test("solo se lee el calendario PROPIO de la clínica: un primary o un correo personal no (G14)", () => {
  assert.equal(calendarioImportable("abc123@group.calendar.google.com"), true);
  assert.equal(calendarioImportable("ABC@GROUP.CALENDAR.GOOGLE.COM"), true);
  assert.equal(calendarioImportable("primary"), false);
  assert.equal(calendarioImportable("dra.ruiz@gmail.com"), false);
  assert.equal(calendarioImportable(null), false);
  assert.equal(calendarioImportable(""), false);
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

test("G1: el título solo a quien ve la agenda de ESE doctor; los de toda la clínica, solo a quien ve toda la agenda", () => {
  const ana = { role: "DOCTOR", userId: "doc-ana" };
  assert.equal(puedeVerTitulo(ana, { doctorId: "doc-ana" }), true);
  assert.equal(puedeVerTitulo(ana, { doctorId: "doc-luis" }), false);
  assert.equal(puedeVerTitulo(ana, { doctorId: null }), false);
  for (const role of ["RECEPTIONIST", "ADMIN", "SUPER_ADMIN"]) {
    assert.equal(puedeVerTitulo({ role, userId: "x" }, { doctorId: null }), true);
    assert.equal(puedeVerTitulo({ role, userId: "x" }, { doctorId: "doc-luis" }), true);
  }
});

test("el título NO va al motivo: el motivo es genérico (el bot se lo dice al paciente)", () => {
  assert.equal(MOTIVO_GOOGLE, "Ocupado (Google)");
  assert.equal(etiquetaRejilla("Cita con el abogado"), "Ocupado (Google) · Cita con el abogado");
  assert.equal(etiquetaRejilla(""), "Ocupado (Google)");
  // G9: el bot ni siquiera dice «Google».
  assert.doesNotMatch(MENSAJE_PACIENTE_GOOGLE, /google/i);
  assert.equal(MENSAJE_PACIENTE_GOOGLE, "Ese horario no está disponible");
});

/* ═══ 2 · decidir un evento ════════════════════════════════════════════ */

const ctx = (existente: Parameters<typeof decidirEvento>[1]["existente"] = null) => ({ zona: ZONA, ahora: AHORA, existente, dueno: "doc-ana" });

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
  const existente = { blockId: "b1", activo: true, doctorId: "doc-ana", alcance: null, startsAt: r.startsAt, endsAt: r.endsAt, title: "Junta con proveedor", allDay: false };
  assert.equal(decidirEvento(ev(), ctx(existente)).accion, "nada");
  // Los invitados no cambian a quién bloquea (WS1-T3): invitar a alguien no lo toca.
  assert.equal(decidirEvento(ev({ attendees: [{ email: "x@gmail.com" }, { email: "luis@clinica.mx" }] }), ctx(existente)).accion, "nada");
});

test("se movió, cambió de título o volvió tras borrarse → actualizar (y reactivar)", () => {
  const r = rangoDeEvento(ev(), ZONA)!;
  const base = { blockId: "b1", activo: true, doctorId: "doc-ana", alcance: null, startsAt: r.startsAt, endsAt: r.endsAt, title: "Junta con proveedor", allDay: false };
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

test("un «movido» ya resuelto (la cita está a la hora del evento) se limpia aunque la hora de Google no cambie", () => {
  const t12 = new Date("2026-10-21T18:00:00Z");
  const t13 = new Date("2026-10-21T19:00:00Z");
  const evento12 = ev({ summary: "otro título", start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } });
  const c = decidirAvisoCita(evento12, vinculo({ eventStartsAt: t12, eventEndsAt: t13, avisoTipo: "movido" }), cita({ startsAt: t12, endsAt: t13 }), { zona: ZONA, ahora: AHORA });
  assert.equal(c.avisoTipo, null);
  // Sin resolver (la cita sigue en su hora), el aviso se queda.
  const d = decidirAvisoCita(evento12, vinculo({ eventStartsAt: t12, eventEndsAt: t13, avisoTipo: "movido" }), cita(), { zona: ZONA, ahora: AHORA });
  assert.equal(d.avisoTipo, undefined);
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

/* ═══ Segunda vuelta de la revisión t8 ════════════════════════════════════ */

const EQUIPO = [
  { id: "doc-ana", email: "ana@clinica.mx", correoGoogle: "maria.ruiz.g@gmail.com", recibeCitas: true },
  { id: "doc-luis", email: "luis@clinica.mx", recibeCitas: true },
  { id: "rec-eva", email: "recepcion@clinica.mx", correoGoogle: "clinica.salamanca@gmail.com", recibeCitas: false },
  { id: "doc-ido", email: "ido@clinica.mx", recibeCitas: false },
];

test("N-G5: la huella del equipo cambia con correos y «recibe citas»; no con el orden", () => {
  const base = firmaEquipo(EQUIPO);
  assert.equal(firmaEquipo([...EQUIPO].reverse()), base);
  assert.notEqual(firmaEquipo(EQUIPO.map((u) => (u.id === "doc-ido" ? { ...u, recibeCitas: true } : u))), base);
  assert.notEqual(firmaEquipo([...EQUIPO, { id: "n", email: "nueva@clinica.mx", recibeCitas: true }]), base);
  assert.notEqual(firmaEquipo(EQUIPO.map((u) => (u.id === "rec-eva" ? { ...u, email: "eva@clinica.mx" } : u))), base);
  assert.notEqual(firmaEquipo(EQUIPO.map((u) => (u.id === "doc-luis" ? { ...u, correoGoogle: "luis.gmail@gmail.com" } : u))), base);
  assert.ok(base.length <= 40, "cabe en la columna");
});

test("G3/N-G3: un día sin una pasada buena retira los bloqueos, sea cual sea la causa; «parcial» no; sin token, ya", () => {
  const ahora = new Date("2026-10-20T12:00:00Z");
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000);
  const base = { conToken: true, ultimaBuena: hace(1), encendidaDesde: hace(500), ultimoError: null };
  assert.equal(bloqueosSinMantener(base, ahora), false);
  for (const ultimoError of [null, "autorizacion", "permisos", "calendario", "calendario_personal", "calendario_compartido", "google"]) {
    assert.equal(bloqueosSinMantener({ ...base, ultimaBuena: hace(24), ultimoError }, ahora), true, String(ultimoError));
    assert.equal(bloqueosSinMantener({ ...base, ultimaBuena: hace(23), ultimoError }, ahora), false, String(ultimoError));
  }
  // «parcial» indulta solo con la conexión activa y menos de 72 h sin una pasada buena.
  assert.equal(bloqueosSinMantener({ ...base, conexionActiva: true, ultimaBuena: hace(48), ultimoError: "parcial" }, ahora), false);
  assert.equal(bloqueosSinMantener({ ...base, conexionActiva: true, ultimaBuena: hace(72), ultimoError: "parcial" }, ahora), true);
  assert.equal(bloqueosSinMantener({ ...base, conexionActiva: false, ultimaBuena: hace(25), ultimoError: "parcial" }, ahora), true, "caída: nadie reescribe «parcial»");
  assert.equal(bloqueosSinMantener({ ...base, conToken: false }, ahora), true);
  // Nunca sincronizó bien: cuenta desde que se encendió.
  assert.equal(bloqueosSinMantener({ ...base, ultimaBuena: null, encendidaDesde: hace(30) }, ahora), true);
  assert.equal(bloqueosSinMantener({ ...base, ultimaBuena: null, encendidaDesde: hace(2) }, ahora), false);
  assert.equal(SIN_MANTENER_RETIRA_MS, 24 * 3_600_000);
});

test("segunda vuelta: el evento borrado VUELVE a su hora de antes pero la cita se movió mientras → aviso «movido» (no quedan distintos en silencio)", () => {
  const ZONA_ = "America/Mexico_City";
  const vinculo = { eventStartsAt: new Date("2026-10-21T16:00:00Z"), eventEndsAt: new Date("2026-10-21T17:00:00Z"), eventDeletedAt: new Date("2026-10-20T00:00:00Z"), avisoTipo: "eliminado" };
  const cita = { status: "SCHEDULED", startsAt: new Date("2026-10-21T18:00:00Z"), endsAt: new Date("2026-10-21T19:00:00Z") };
  const c = decidirAvisoCita(
    ev({ start: { dateTime: "2026-10-21T10:00:00-06:00" }, end: { dateTime: "2026-10-21T11:00:00-06:00" } }),
    vinculo, cita, { zona: ZONA_, ahora: new Date("2026-10-20T12:00:00Z") },
  );
  assert.equal(c.eventDeletedAt, null);
  assert.equal(c.avisoTipo, "movido");
  assert.equal(c.avisoStartsAt?.toISOString(), "2026-10-21T16:00:00.000Z");
  // Si vuelve a la hora de la cita, sin aviso.
  const igual = decidirAvisoCita(
    ev({ start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } }),
    { ...vinculo, eventStartsAt: cita.startsAt, eventEndsAt: cita.endsAt }, cita, { zona: ZONA_, ahora: new Date("2026-10-20T12:00:00Z") },
  );
  assert.equal(igual.avisoTipo, null);
});

/* ═══ WS1-T3: un evento de Google bloquea SOLO al dueño de la cuenta (la tabla de casos) ═══
 * Decisión de Rafael (21-oct-2026): «NO quiero que se cierre toda la clínica nunca desde Google
 * Calendar… solo quiero que se bloquee el horario de ese correo que tiene ligado Google Calendar». */

/** «Rafael Clinica»: rafa papa (SUPER_ADMIN que atiende) + 3 doctores sin Google propio + recepción. */
const RAFAEL = [
  { id: "u-rafa", email: "rafaelpapanaklis@gmail.com", correoGoogle: "rafaelpapanaklis@gmail.com", recibeCitas: true },
  { id: "u-d", email: "d@gmail.com", recibeCitas: true },
  { id: "u-jg", email: "jg@gmail.com", recibeCitas: true },
  { id: "u-jm", email: "jorgemar@gmail.com", correoGoogle: "jorge.mar.personal@gmail.com", recibeCitas: true },
  { id: "u-rec", email: "recepcion@rafael.mx", recibeCitas: false },
];
const PACIENTE = "paciente.juan@hotmail.com";
const conInvitados = (...emails: (string | { email: string; responseStatus?: string; displayName?: string })[]) =>
  ev({ attendees: emails.map((e) => (typeof e === "string" ? { email: e } : e)) });

test("WS1-T3 · ¿de quién es la cuenta conectada? De UNA persona que recibe citas: por su correo de acceso o por el Google que conectó", () => {
  assert.equal(duenoDeLaCuenta("RafaelPapanaklis@gmail.com ", RAFAEL), "u-rafa", "sin mayúsculas ni espacios");
  // Por el Google que conectó (users.googleCalendarEmail), si nadie entra con ese correo.
  assert.equal(duenoDeLaCuenta("jorge.mar.personal@gmail.com", RAFAEL), "u-jm");
  // El correo de ACCESO manda sobre el Google conectado de otro.
  const conflicto = [...RAFAEL, { id: "u-x", email: "x@gmail.com", correoGoogle: "d@gmail.com", recibeCitas: true }];
  assert.equal(duenoDeLaCuenta("d@gmail.com", conflicto), "u-d");
  // Cuenta general: nadie que atienda la tiene, o es de recepción.
  assert.equal(duenoDeLaCuenta("consultorio@gmail.com", RAFAEL), null);
  assert.equal(duenoDeLaCuenta("recepcion@rafael.mx", RAFAEL), null);
  assert.equal(duenoDeLaCuenta(null, RAFAEL), null);
  assert.equal(duenoDeLaCuenta("", RAFAEL), null);
  // Un superadmin con «Aparece en la agenda» APAGADO no recibe citas → cuenta general.
  assert.equal(duenoDeLaCuenta("rafaelpapanaklis@gmail.com", RAFAEL.map((u) => (u.id === "u-rafa" ? { ...u, recibeCitas: false } : u))), null);
  // Dos personas que atienden con ese correo: no se sabe de quién es.
  assert.equal(duenoDeLaCuenta("d@gmail.com", [...RAFAEL, { id: "u-d2", email: "d@gmail.com", recibeCitas: true }]), null);
  assert.equal(duenoDeLaCuenta("compartido@gmail.com", [...RAFAEL, { id: "a", email: "a@x.mx", correoGoogle: "compartido@gmail.com", recibeCitas: true }, { id: "b", email: "b@x.mx", correoGoogle: "compartido@gmail.com", recibeCitas: true }]), null);
  // Una cuenta vieja (no recibe citas) con ese mismo correo no estorba.
  assert.equal(duenoDeLaCuenta("d@gmail.com", [...RAFAEL, { id: "u-d-vieja", email: "d@gmail.com", recibeCitas: false }]), "u-d");
});

test("WS1-T3 · cuenta de un doctor → TODO evento ocupado bloquea solo su agenda; los invitados no cambian nada", () => {
  const c = { zona: ZONA, ahora: AHORA, existente: null, dueno: "u-rafa" };
  const doctorDe = (e: EventoGoogle) => {
    const d = decidirEvento(e, c);
    return d.accion === "crear" ? [d.datos.doctorId, d.datos.alcance] : d.accion;
  };
  // El caso exacto de Rafael: «Evento Social - Comida», Ocupado, con un paciente invitado.
  assert.deepEqual(doctorDe(conInvitados(PACIENTE)), ["u-rafa", null]);
  // Sin invitados (antes «sin_invitados» → toda la clínica).
  assert.deepEqual(doctorDe(ev()), ["u-rafa", null]);
  // Con otros doctores invitados (antes «varios» → toda la clínica), aceptados o no.
  assert.deepEqual(doctorDe(conInvitados("d@gmail.com", { email: "jg@gmail.com", responseStatus: "accepted" })), ["u-rafa", null]);
  // Con recepción, un laboratorio o un correo desconocido (antes «no_reconocido»).
  assert.deepEqual(doctorDe(conInvitados("recepcion@rafael.mx", "pedidos@laboratorio.mx", "quien.sea@gmail.com")), ["u-rafa", null]);
  // Un invitado que se llama como otro doctor tampoco.
  assert.deepEqual(doctorDe(conInvitados({ email: PACIENTE, displayName: "Jorge Mar" })), ["u-rafa", null]);
});

test("WS1-T3 · cuenta GENERAL (recepción, Gmail de la clínica) → no bloquea a nadie, nunca toda la clínica", () => {
  const c = { zona: ZONA, ahora: AHORA, existente: null, dueno: null };
  // Recepción sin invitados (antes: toda la clínica).
  assert.deepEqual(decidirEvento(ev(), c), { accion: "nada" });
  // Aunque invite a un doctor: los invitados no deciden.
  assert.deepEqual(decidirEvento(conInvitados("jg@gmail.com"), c), { accion: "nada" });
  assert.deepEqual(decidirEvento(conInvitados(PACIENTE), c), { accion: "nada" });
});

test("WS1-T3 · D: lo que no cambia — el eco de las citas no bloquea, «disponible» tampoco, y el título solo a quien debe", () => {
  const c = { zona: ZONA, ahora: AHORA, existente: null, dueno: "u-rafa" };
  assert.deepEqual(decidirEvento(ev({ id: "dc" + "b".repeat(40) }), c), { accion: "nada" });
  assert.deepEqual(decidirEvento(ev({ extendedProperties: { private: { dalecontrolAppointmentId: "a1" } } }), c), { accion: "nada" });
  assert.deepEqual(decidirEvento(ev({ transparency: "transparent" }), c), { accion: "nada" });
  const d = decidirEvento(conInvitados(PACIENTE), c);
  assert.equal(d.accion === "crear" && d.datos.title, "Junta con proveedor");
  // Los demás doctores ven «Ocupado (Google)» sin título; rafa y el admin, el título.
  assert.equal(puedeVerTitulo({ role: "DOCTOR", userId: "u-d" }, { doctorId: "u-rafa" }), false);
  assert.equal(puedeVerTitulo({ role: "SUPER_ADMIN", userId: "u-rafa" }, { doctorId: "u-rafa" }), true);
  assert.equal(puedeVerTitulo({ role: "RECEPTIONIST", userId: "u-rec" }, { doctorId: "u-rafa" }), true);
});

test("WS1-T3 · E: los bloqueos que ya eran de toda la clínica se REASIGNAN al dueño, o se RETIRAN con una cuenta general (sin borrar)", () => {
  const r = rangoDeEvento(ev(), ZONA)!;
  const deTodos = { blockId: "b1", activo: true, doctorId: null, alcance: "no_reconocido" as const, startsAt: r.startsAt, endsAt: r.endsAt, title: "Junta con proveedor", allDay: false };
  const d = decidirEvento(conInvitados(PACIENTE), { zona: ZONA, ahora: AHORA, existente: deTodos, dueno: "u-rafa" });
  assert.equal(d.accion, "actualizar");
  assert.equal(d.accion === "actualizar" && d.blockId, "b1", "el mismo bloqueo");
  assert.equal(d.accion === "actualizar" && d.datos.doctorId, "u-rafa");
  assert.equal(d.accion === "actualizar" && d.datos.alcance, null);
  // Ya reasignado, la siguiente pasada no lo toca.
  assert.deepEqual(
    decidirEvento(conInvitados(PACIENTE), { zona: ZONA, ahora: AHORA, existente: { ...deTodos, doctorId: "u-rafa", alcance: null }, dueno: "u-rafa" }),
    { accion: "nada" },
  );
  // Cuenta general: se retira (deletedAt), no se borra.
  assert.deepEqual(decidirEvento(ev(), { zona: ZONA, ahora: AHORA, existente: deTodos, dueno: null }), { accion: "inactivar", blockId: "b1" });
  assert.deepEqual(decidirEvento(ev(), { zona: ZONA, ahora: AHORA, existente: { ...deTodos, activo: false }, dueno: null }), { accion: "nada" });
  // Y si después se conecta la cuenta de un doctor, vuelve a ser suyo (se reactiva el mismo).
  const vuelve = decidirEvento(ev(), { zona: ZONA, ahora: AHORA, existente: { ...deTodos, activo: false }, dueno: "u-rafa" });
  assert.equal(vuelve.accion === "actualizar" && vuelve.datos.doctorId, "u-rafa");
});

test("WS1-T3 · E: la huella cambia con la regla y con la cuenta conectada (reconectar con otra cuenta reasigna)", () => {
  const sin = firmaEquipo(RAFAEL);
  const conRafa = firmaEquipo(RAFAEL, "rafaelpapanaklis@gmail.com");
  assert.notEqual(conRafa, sin);
  assert.equal(firmaEquipo(RAFAEL, " RafaelPapanaklis@gmail.com"), conRafa, "sin mayúsculas ni espacios");
  assert.notEqual(firmaEquipo(RAFAEL, "consultorio@gmail.com"), conRafa);
  assert.ok(conRafa.length <= 40, "cabe en la columna");
});
