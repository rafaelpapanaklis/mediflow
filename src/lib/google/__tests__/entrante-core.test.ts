/**
 * Google Calendar → agenda (WS1-T9): las decisiones puras.
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asignarEvento,
  bloqueosSinMantener,
  firmaEquipo,
  normalizarNombre,
  SIN_MANTENER_RETIRA_MS,
  avisoVigente,
  calendarioImportable,
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
  MENSAJE_PACIENTE_GOOGLE,
  MOTIVO_GOOGLE,
  puedeVerTitulo,
  rangoDeEvento,
  tocaCompleta,
  type EventoGoogle,
} from "../entrante-core";

const ZONA = "America/Mexico_City"; // UTC-6 todo el año (sin horario de verano desde 2022)
const AHORA = new Date("2026-10-20T15:00:00Z");
const DOCTORES = [
  { id: "doc-ana", email: "ana@clinica.mx", recibeCitas: true },
  { id: "doc-luis", email: "Luis@Clinica.mx", recibeCitas: true },
];
/** Toda la clínica: también quien no recibe citas (revisión t8, G1). */
const USUARIOS = [
  ...DOCTORES,
  { id: "rec-eva", email: "recepcion@clinica.mx", recibeCitas: false },
  { id: "doc-baja", email: "ruiz@clinica.mx", recibeCitas: false },
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

test("N-G6: el título «🏥 tipo — paciente» o el pie «Agendado desde DaleControl» SOLOS ya no son eco (un duplicado a mano los copia)", () => {
  // Lo que sí es eco lo decide quien llama: una cita ligada a ese evento (`eventosDeCitas`).
  assert.equal(esEventoDeDaleControl(ev({ description: "Tipo: Limpieza\nClínica: X\n\nAgendado desde DaleControl" })), false);
  assert.equal(esEventoDeDaleControl(ev({ summary: "🏥 Limpieza — Ana G." })), false);
  const duplicado = ev({ summary: "🏥 Limpieza — Ana G.", description: "Agendado desde DaleControl", attendees: [{ email: "ana@clinica.mx" }] });
  const d = decidirEvento(duplicado, { zona: ZONA, ahora: new Date("2026-10-20T00:00:00Z"), existente: null, usuarios: USUARIOS });
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

test("el doctor: el ÚNICO doctor invitado (sin mayúsculas); ninguno o varios → toda la clínica", () => {
  assert.equal(doctorDelEvento(ev({ attendees: [{ email: "ANA@clinica.mx" }] }), USUARIOS), "doc-ana");
  assert.equal(doctorDelEvento(ev({ attendees: [{ email: "luis@clinica.mx" }, { email: "x@gmail.com" }] }), USUARIOS), "doc-luis");
  assert.deepEqual(asignarEvento(ev({ attendees: [{ email: "ana@clinica.mx" }, { email: "luis@clinica.mx" }] }), USUARIOS), { doctorId: null, alcance: "varios" });
  assert.deepEqual(asignarEvento(ev({ attendees: [] }), USUARIOS), { doctorId: null, alcance: "sin_invitados" });
  assert.deepEqual(asignarEvento(ev(), USUARIOS), { doctorId: null, alcance: "sin_invitados" });
});

test("G1: un invitado que no es de la clínica (el Gmail personal de la Dra.) → toda la clínica, y se dice por qué", () => {
  assert.deepEqual(asignarEvento(ev({ attendees: [{ email: "dra.ruiz@gmail.com" }] }), USUARIOS), { doctorId: null, alcance: "no_reconocido" });
});

test("G1: alguien de la clínica que NO recibe citas (recepción, doctor de baja o sin agenda) → a su nombre: no cierra a nadie más", () => {
  assert.deepEqual(asignarEvento(ev({ attendees: [{ email: "ruiz@clinica.mx" }] }), USUARIOS), { doctorId: "doc-baja", alcance: null });
  assert.deepEqual(asignarEvento(ev({ attendees: [{ email: "recepcion@clinica.mx" }] }), USUARIOS), { doctorId: "rec-eva", alcance: null });
  // Si además hay un doctor que atiende, manda el doctor.
  assert.deepEqual(asignarEvento(ev({ attendees: [{ email: "recepcion@clinica.mx" }, { email: "ana@clinica.mx" }] }), USUARIOS), { doctorId: "doc-ana", alcance: null });
});

test("G1: el que rechazó cuenta solo si no queda nadie más (su «Quirófano» sigue siendo suyo, no de toda la clínica)", () => {
  assert.deepEqual(asignarEvento(ev({ attendees: [{ email: "ana@clinica.mx", responseStatus: "declined" }] }), USUARIOS), { doctorId: "doc-ana", alcance: null });
  assert.deepEqual(
    asignarEvento(ev({ attendees: [{ email: "ana@clinica.mx", responseStatus: "declined" }, { email: "luis@clinica.mx", responseStatus: "accepted" }] }), USUARIOS),
    { doctorId: "doc-luis", alcance: null },
  );
});

test("G1: con el correo repetido (cuenta de baja y cuenta nueva) manda la que recibe citas", () => {
  const dup = [
    { id: "vieja", email: "ana@clinica.mx", recibeCitas: false },
    { id: "nueva", email: "ANA@clinica.mx", recibeCitas: true },
  ];
  assert.deepEqual(asignarEvento(ev({ attendees: [{ email: "ana@clinica.mx" }] }), dup), { doctorId: "nueva", alcance: null });
  // A igualdad, el id menor, llegue en el orden que llegue (el bloqueo no oscila).
  const dos = [{ id: "z", email: "ana@clinica.mx", recibeCitas: true }, { id: "a", email: "ana@clinica.mx", recibeCitas: true }];
  assert.equal(asignarEvento(ev({ attendees: [{ email: "ana@clinica.mx" }] }), dos).doctorId, "a");
  assert.equal(asignarEvento(ev({ attendees: [{ email: "ana@clinica.mx" }] }), [...dos].reverse()).doctorId, "a");
});

test("G1: el propio calendario (self) y las salas (resource) no son invitados", () => {
  assert.deepEqual(
    asignarEvento(ev({ attendees: [{ email: "abc@group.calendar.google.com", self: true }, { email: "sala1@resource.calendar.google.com", resource: true }] }), USUARIOS),
    { doctorId: null, alcance: "sin_invitados" },
  );
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

const ctx = (existente: Parameters<typeof decidirEvento>[1]["existente"] = null) => ({ zona: ZONA, ahora: AHORA, existente, usuarios: USUARIOS });

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
  const existente = { blockId: "b1", activo: true, doctorId: null, alcance: "sin_invitados" as const, startsAt: r.startsAt, endsAt: r.endsAt, title: "Junta con proveedor", allDay: false };
  assert.equal(decidirEvento(ev(), ctx(existente)).accion, "nada");
  // Cambia el porqué (alguien invitó a un correo de fuera) → se pone al día.
  assert.equal(decidirEvento(ev({ attendees: [{ email: "x@gmail.com" }] }), ctx(existente)).accion, "actualizar");
});

test("se movió, cambió de título o volvió tras borrarse → actualizar (y reactivar)", () => {
  const r = rangoDeEvento(ev(), ZONA)!;
  const base = { blockId: "b1", activo: true, doctorId: null, alcance: "sin_invitados" as const, startsAt: r.startsAt, endsAt: r.endsAt, title: "Junta con proveedor", allDay: false };
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
  { id: "doc-ana", email: "ana@clinica.mx", recibeCitas: true, rol: "DOCTOR", nombre: "María Ruiz Gómez", otrosCorreos: ["maria.ruiz.g@gmail.com"] },
  { id: "doc-luis", email: "luis@clinica.mx", recibeCitas: true, rol: "DOCTOR", nombre: "Luis Pérez" },
  { id: "rec-eva", email: "recepcion@clinica.mx", recibeCitas: false, rol: "RECEPTIONIST", nombre: "Eva Soto", otrosCorreos: ["clinica.salamanca@gmail.com"] },
  // La cuenta VIEJA de la Dra. Ruiz (dada de baja), con otro correo.
  { id: "ana-vieja", email: "mruiz@correo-viejo.mx", recibeCitas: false, rol: "DOCTOR", nombre: "Dra. María Ruiz Gómez" },
  // Un doctor que ya se fue (nadie con su nombre atiende hoy).
  { id: "doc-ido", email: "ido@clinica.mx", recibeCitas: false, rol: "DOCTOR", nombre: "Pedro Ido" },
];
const inv = (...emails: (string | { email: string; displayName?: string; responseStatus?: string })[]) =>
  ev({ attendees: emails.map((e) => (typeof e === "string" ? { email: e } : e)) });

test("N-G2: recepción + un Gmail que no se sabe de quién es → toda la clínica (antes: «de recepción», no cerraba a nadie)", () => {
  assert.deepEqual(asignarEvento(inv("recepcion@clinica.mx", "alguien.mas@gmail.com"), EQUIPO), { doctorId: null, alcance: "no_reconocido" });
  // Solo recepción (todos de la clínica, nadie atiende): sigue siendo suyo.
  assert.deepEqual(asignarEvento(inv("recepcion@clinica.mx"), EQUIPO), { doctorId: "rec-eva", alcance: null });
});

test("N-G2: recepción + el Gmail con el que la Dra. conectó Google → la agenda de la Dra.", () => {
  assert.deepEqual(asignarEvento(inv("recepcion@clinica.mx", "Maria.Ruiz.G@gmail.com"), EQUIPO), { doctorId: "doc-ana", alcance: null });
});

test("N-G2: recepción + la cuenta VIEJA de la Dra. (mismo nombre) → la agenda de la Dra.", () => {
  assert.deepEqual(asignarEvento(inv("recepcion@clinica.mx", "mruiz@correo-viejo.mx"), EQUIPO), { doctorId: "doc-ana", alcance: null });
  // Cuenta vieja + su Gmail desconocido: igual de ella.
  assert.deepEqual(asignarEvento(inv("mruiz@correo-viejo.mx", "otro.gmail.suyo@gmail.com"), EQUIPO), { doctorId: "doc-ana", alcance: null });
});

test("N-G2: un correo desconocido cuyo nombre en Google es el de una doctora → suya; si el nombre es de dos, no", () => {
  assert.deepEqual(
    asignarEvento(inv("recepcion@clinica.mx", { email: "x123@gmail.com", displayName: "Dra. María Ruiz Gómez" }), EQUIPO),
    { doctorId: "doc-ana", alcance: null },
  );
  const gemelos = [...EQUIPO, { id: "doc-otra", email: "otra@clinica.mx", recibeCitas: true, rol: "DOCTOR", nombre: "Maria Ruiz Gomez" }];
  assert.deepEqual(
    asignarEvento(inv("recepcion@clinica.mx", { email: "x123@gmail.com", displayName: "María Ruiz Gómez" }), gemelos),
    { doctorId: null, alcance: "no_reconocido" },
  );
});

test("N-G2: el Gmail de la clínica que conectó recepción NO vuelve «de recepción» un evento (otros correos solo para quien atiende)", () => {
  assert.deepEqual(asignarEvento(inv("clinica.salamanca@gmail.com"), EQUIPO), { doctorId: null, alcance: "no_reconocido" });
});

test("N-G2: un doctor con la agenda apagada (cuenta activa) → a su nombre, como en G1; con un desconocido, toda la clínica", () => {
  assert.deepEqual(asignarEvento(inv("ido@clinica.mx"), EQUIPO), { doctorId: "doc-ido", alcance: null });
  assert.deepEqual(asignarEvento(inv("ido@clinica.mx", "pedro.ido@gmail.com"), EQUIPO), { doctorId: null, alcance: "no_reconocido" });
});

test("N-G2: una cuenta DADA DE BAJA de quien atendía, con un nombre que no es de nadie de hoy («María Ruiz» → «María Ruiz Gómez») → toda la clínica", () => {
  const equipo = [...EQUIPO, { id: "vieja2", email: "maria@viejo.mx", recibeCitas: false, rol: "DOCTOR", nombre: "María Ruiz", activo: false }];
  assert.deepEqual(asignarEvento(inv("recepcion@clinica.mx", "maria@viejo.mx"), equipo), { doctorId: null, alcance: "no_reconocido" });
  assert.deepEqual(asignarEvento(inv("maria@viejo.mx"), equipo), { doctorId: null, alcance: "no_reconocido" });
});

test("N-G2: recepción RECHAZÓ y el Gmail de la Dra. no ha respondido → toda la clínica (no «de recepción»)", () => {
  assert.deepEqual(
    asignarEvento(inv({ email: "recepcion@clinica.mx", responseStatus: "declined" }, "dra.desconocida@gmail.com"), EQUIPO),
    { doctorId: null, alcance: "no_reconocido" },
  );
});

test("N-G2: un Gmail que conectaron DOS doctores no dice de quién es → toda la clínica", () => {
  const equipo = EQUIPO.map((u) => (u.id === "doc-luis" ? { ...u, otrosCorreos: ["maria.ruiz.g@gmail.com"] } : u));
  assert.deepEqual(asignarEvento(inv("recepcion@clinica.mx", "maria.ruiz.g@gmail.com"), equipo), { doctorId: null, alcance: "no_reconocido" });
});

test("N-G2: un invitado de fuera (laboratorio) no le quita el evento a la doctora", () => {
  assert.deepEqual(asignarEvento(inv("luis@clinica.mx", "pedidos@laboratorio.mx"), EQUIPO), { doctorId: "doc-luis", alcance: null });
});

test("N-G5: con el correo repetido y empate en «recibe citas», gana el DOCTOR; luego el id menor", () => {
  const dup = [
    { id: "a-admin", email: "ana@clinica.mx", recibeCitas: true, rol: "ADMIN" },
    { id: "z-doctor", email: "ana@clinica.mx", recibeCitas: true, rol: "DOCTOR" },
  ];
  assert.equal(asignarEvento(inv("ana@clinica.mx"), dup).doctorId, "z-doctor");
  assert.equal(asignarEvento(inv("ana@clinica.mx"), [...dup].reverse()).doctorId, "z-doctor");
});

test("N-G5: la huella del equipo cambia con correos, roles y «recibe citas»; no con el orden", () => {
  const base = firmaEquipo(EQUIPO);
  assert.equal(firmaEquipo([...EQUIPO].reverse()), base);
  assert.notEqual(firmaEquipo(EQUIPO.map((u) => (u.id === "doc-ido" ? { ...u, recibeCitas: true } : u))), base);
  assert.notEqual(firmaEquipo([...EQUIPO, { id: "n", email: "nueva@clinica.mx", recibeCitas: true }]), base);
  assert.notEqual(firmaEquipo(EQUIPO.map((u) => (u.id === "rec-eva" ? { ...u, email: "eva@clinica.mx" } : u))), base);
  assert.ok(base.length <= 40, "cabe en la columna");
  assert.equal(normalizarNombre("Dra.  María Ruiz-Gómez"), "maria ruiz gomez");
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
