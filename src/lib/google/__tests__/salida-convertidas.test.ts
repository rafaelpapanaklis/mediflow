/**
 * Google Calendar (WS1-T9, revisión t8 G4/G6): la sincronización de SALIDA con
 * una cita que vino de un evento de Google («Convertir en cita»). Con la Google
 * falsa de la salida (mezcla en patch, delete deja `cancelled`).
 *
 *   · nunca se pisan la descripción, la ubicación ni los invitados del evento;
 *   · con un aviso sin decidir, ni la hora ni el estado (y no se recrea);
 *   · cancelar NO borra el evento ni avisa a sus invitados: «Cancelada en DaleControl · <título>»;
 *   · las citas normales siguen como siempre (cancelar = borrar).
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREFIJO_CANCELADA,
  sincronizarCita,
  tituloCancelada,
  type CitaParaGoogle,
  type Puertos,
} from "@/lib/agenda/google-sync-nucleo";
import { armarContenidoEventoGoogle } from "@/lib/google-calendar-contenido";
import { GoogleFalsa } from "@/lib/agenda/__tests__/google-falsa";

const C1 = "clinica-1";
const CAL = "cal1@group.calendar.google.com";
const ZONA = "America/Mexico_City";
const EV = "evento-de-recepcion";

function mundo(cita: Partial<CitaParaGoogle>) {
  const google = new GoogleFalsa();
  google.sembrarCalendario(CAL, "Clínica", "Agenda de Clínica");
  // El evento ORIGINAL de la clínica: con descripción, ubicación e invitados.
  google.eventos.set(`${CAL}/${EV}`, {
    id: EV,
    status: "confirmed",
    summary: "Valoración Sra. López",
    description: "Tel. 555 123 4567 · trae radiografías",
    location: "https://meet.google.com/abc-defg-hij",
    attendees: [{ email: "proveedor@lab.mx" }],
    start: { dateTime: "2026-10-21T10:00:00-06:00", timeZone: ZONA },
    end: { dateTime: "2026-10-21T11:00:00-06:00", timeZone: ZONA },
  });
  const c: CitaParaGoogle = {
    id: "a1", type: "Limpieza", status: "SCHEDULED",
    startsAt: new Date("2026-10-21T16:00:00Z"), endsAt: new Date("2026-10-21T17:00:00Z"),
    googleEventId: EV, patientName: "Ana García", doctorName: "Luis Ruiz",
    doctorEmail: "doc@clinica.mx", patientEmail: "ana@correo.mx",
    desdeGoogle: { tituloOriginal: "Valoración Sra. López", avisoPendiente: false, eventoVisto: { startsAt: new Date("2026-10-21T16:00:00Z"), endsAt: new Date("2026-10-21T17:00:00Z"), eliminado: false } },
    ...cita,
  };
  const guardados: (string | null)[] = [];
  const p: Puertos = {
    leerClinica: async () => ({
      id: C1, name: "Clínica", address: "Calle 1", timezone: ZONA, enabled: true,
      accessToken: "at", refreshToken: "rt", calendarId: CAL,
    }),
    leerAjustes: async () => ({ invitarPaciente: true, caidoDesde: null }),
    guardarAccessToken: async () => undefined,
    fijarCalendarioId: async (_c, id) => id,
    leerCita: async () => ({ ...c }),
    guardarEventoId: async (_c, _a, id) => { guardados.push(id); c.googleEventId = id; },
    abrirCalendar: () => google,
    armarContenido: armarContenidoEventoGoogle,
    esErrorDeAutorizacion: () => false,
    marcarCaido: async () => undefined,
    log: () => undefined,
    ahora: () => new Date("2026-10-20T00:00:00Z"),
  };
  const evento = () => google.eventoEn(CAL, EV)!;
  return { google, p, c, evento, guardados };
}

test("convertida, sin aviso: toma el título y la hora de la cita, pero CONSERVA descripción, ubicación e invitados", async () => {
  const w = mundo({ startsAt: new Date("2026-10-21T17:00:00Z"), endsAt: new Date("2026-10-21T18:00:00Z") });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  const e = w.evento();
  assert.match(e.summary, /^🏥 Limpieza — /);
  assert.equal(e.start.dateTime, "2026-10-21T11:00:00-06:00");
  assert.equal(e.description, "Tel. 555 123 4567 · trae radiografías");
  assert.equal(e.location, "https://meet.google.com/abc-defg-hij");
  assert.deepEqual(e.attendees, [{ email: "proveedor@lab.mx" }]);
  const patch = w.google.llamadas.find((l) => l.op === "events.patch")!;
  assert.equal(patch.args.sendUpdates, "none");
  assert.equal("description" in patch.args.requestBody, false);
  assert.equal("location" in patch.args.requestBody, false);
  assert.equal("attendees" in patch.args.requestBody, false);
});

test("G4: con un aviso sin decidir (Google movió el evento), corregir la cita NO devuelve el evento a la hora vieja", async () => {
  const w = mundo({ desdeGoogle: { tituloOriginal: "Valoración Sra. López", avisoPendiente: true } });
  w.evento().start = { dateTime: "2026-10-21T12:00:00-06:00", timeZone: ZONA };
  w.evento().end = { dateTime: "2026-10-21T13:00:00-06:00", timeZone: ZONA };
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  const patch = w.google.llamadas.find((l) => l.op === "events.patch")!;
  assert.deepEqual(Object.keys(patch.args.requestBody), ["summary"], "solo el título");
  assert.equal(w.evento().start.dateTime, "2026-10-21T12:00:00-06:00", "la hora de Google se queda");
});

test("G4: con el aviso «se eliminó» pendiente, NO se resucita ni se recrea el evento", async () => {
  const w = mundo({ desdeGoogle: { tituloOriginal: "Valoración Sra. López", avisoPendiente: true } });
  w.evento().status = "cancelled";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().status, "cancelled");
  assert.equal(w.google.cuantas("events.insert"), 0);
  // Y si Google ya ni lo tiene (404), tampoco se crea otro.
  const w2 = mundo({ desdeGoogle: { tituloOriginal: "x", avisoPendiente: true } });
  w2.google.eventos.clear();
  assert.deepEqual(await sincronizarCita(w2.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(w2.google.cuantas("events.insert"), 0);
  assert.deepEqual(w2.guardados, [], "el id del evento no se toca");
});

test("G6: cancelar una cita que vino de Google NO borra el evento ni avisa a sus invitados: le marca el título", async () => {
  const w = mundo({ status: "CANCELLED" });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  assert.equal(w.google.cuantas("events.delete"), 0);
  const e = w.evento();
  assert.equal(e.status, "confirmed");
  assert.equal(e.summary, "Cancelada en DaleControl · Valoración Sra. López");
  assert.equal(e.description, "Tel. 555 123 4567 · trae radiografías");
  assert.deepEqual(e.attendees, [{ email: "proveedor@lab.mx" }]);
  const patch = w.google.llamadas.find((l) => l.op === "events.patch")!;
  assert.equal(patch.args.sendUpdates, "none");
  assert.deepEqual(w.guardados, [], "la cita sigue ligada a su evento (si se reactiva, no se duplica)");
  // Repetir no duplica el prefijo.
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().summary, "Cancelada en DaleControl · Valoración Sra. López");
  assert.equal(tituloCancelada(`${PREFIJO_CANCELADA}X`), `${PREFIJO_CANCELADA}X`);
  assert.equal(tituloCancelada(""), "Cancelada en DaleControl");
});

test("G6: «no asistió» en una cita que vino de Google → el evento se deja como está", async () => {
  const w = mundo({ status: "NO_SHOW" });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(w.google.cuantas("events.delete") + w.google.cuantas("events.patch"), 0);
});

test("reactivar la cita cancelada: el MISMO evento vuelve con el título de la cita (sin duplicado)", async () => {
  const w = mundo({ status: "CANCELLED" });
  await sincronizarCita(w.p, C1, "a1");
  w.c.status = "SCHEDULED";
  await sincronizarCita(w.p, C1, "a1");
  assert.match(w.evento().summary, /^🏥 Limpieza — /);
  assert.equal(w.google.cuantas("events.insert"), 0);
  assert.equal(w.google.activos(CAL).length, 1);
});

test("carrera: Google movió el evento y la entrada aún no lo vio → al copiar la cita solo va el título (no se deshace el cambio)", async () => {
  const w = mundo({});
  w.evento().start = { dateTime: "2026-10-21T13:00:00-06:00", timeZone: ZONA };
  w.evento().end = { dateTime: "2026-10-21T14:00:00-06:00", timeZone: ZONA };
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.google.cuantas("events.get"), 1);
  const patch = w.google.llamadas.find((l) => l.op === "events.patch")!;
  assert.deepEqual(Object.keys(patch.args.requestBody), ["summary"]);
  assert.equal(w.evento().start.dateTime, "2026-10-21T13:00:00-06:00");
});

test("carrera: lo borraron en Google y la entrada aún no lo vio → NO se resucita", async () => {
  const w = mundo({});
  w.evento().status = "cancelled";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().status, "cancelled");
  assert.equal(w.google.cuantas("events.insert"), 0);
});

test("«Mantener la cita» tras «se eliminó» (la entrada ya lo vio borrado) → SÍ se restaura con la hora de la cita", async () => {
  const w = mundo({ desdeGoogle: { tituloOriginal: "x", avisoPendiente: false, eventoVisto: { startsAt: new Date("2026-10-21T16:00:00Z"), endsAt: new Date("2026-10-21T17:00:00Z"), eliminado: true } } });
  w.evento().status = "cancelled";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().status, "confirmed");
});

test("«Mantener» tras pasarlo a TODO EL DÍA en Google (la entrada ya lo vio así) → vuelve a la hora de la cita", async () => {
  // La entrada guardó el día completo en la zona de la clínica (00:00–00:00 = 06:00Z–06:00Z).
  const w = mundo({ desdeGoogle: { tituloOriginal: "x", avisoPendiente: false, eventoVisto: { startsAt: new Date("2026-10-21T06:00:00Z"), endsAt: new Date("2026-10-22T06:00:00Z"), eliminado: false } } });
  w.evento().start = { date: "2026-10-21" };
  w.evento().end = { date: "2026-10-22" };
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().start.dateTime, "2026-10-21T10:00:00-06:00");
});

test("las citas NORMALES siguen como siempre: cancelar borra su evento", async () => {
  const w = mundo({ status: "CANCELLED", desdeGoogle: null });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "borrado" });
  assert.equal(w.evento().status, "cancelled");
  assert.deepEqual(w.guardados, [null]);
});
