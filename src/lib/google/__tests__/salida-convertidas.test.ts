/**
 * Google Calendar (WS1-T9, revisión t8 G4/G6 y segunda vuelta): la
 * sincronización de SALIDA con una cita que vino de un evento de Google
 * («Convertir en cita»). Con la Google falsa de la salida (mezcla en patch,
 * delete deja `cancelled`) y un vínculo en memoria que se comporta como
 * `vinculoParaSalida` + `guardarSalidaConvertida`.
 *
 *   · el evento CONSERVA su título, descripción, ubicación e invitados: solo
 *     toma la hora de la cita (decisión del gerente, privacidad del paciente);
 *   · con un aviso sin decidir, ni la hora ni el estado (y no se recrea);
 *   · cancelar NO borra el evento ni avisa a sus invitados: «Cancelada en DaleControl · <título>»;
 *   · mover dos veces seguidas deja el evento a la hora de la cita y sin aviso falso (N-G1);
 *   · sin la entrada (bandera apagada) manda DaleControl (N-G9);
 *   · un 404 no crea otro evento, salvo tras «Mantener», y sin invitaciones (N-G11);
 *   · cada salida buena deja su firma para que el cron reintente lo que no llegó (N-G12);
 *   · las citas normales siguen como siempre (cancelar = borrar).
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firmaSalidaConvertida,
  PREFIJO_CANCELADA,
  sincronizarCita,
  tituloCancelada,
  tituloSinCancelada,
  type CitaParaGoogle,
  type Puertos,
} from "@/lib/agenda/google-sync-nucleo";
import { armarContenidoEventoGoogle } from "@/lib/google-calendar-contenido";
import { decidirAvisoCita } from "@/lib/google/entrante-core";
import { GoogleFalsa } from "@/lib/agenda/__tests__/google-falsa";

const C1 = "clinica-1";
const CAL = "cal1@group.calendar.google.com";
const ZONA = "America/Mexico_City";
const EV = "evento-de-recepcion";
const TITULO = "Valoración Sra. López";
const h = (iso: string) => new Date(iso);

/** El vínculo (agenda_block_google) de la cita convertida. */
interface Vinculo {
  title: string;
  eventStartsAt: Date;
  eventEndsAt: Date;
  eventDeletedAt: Date | null;
  avisoPendiente: boolean;
  /** «Mantener la cita» tras «se eliminó». */
  mantenerEliminado: boolean;
  salidaFirma: string | null;
  /** La bandera de la clínica (google_agenda_imports.enabled). */
  entradaActiva: boolean;
}

function mundo(cita: Partial<CitaParaGoogle> = {}, vinculo: Partial<Vinculo> = {}) {
  const google = new GoogleFalsa();
  google.sembrarCalendario(CAL, "Clínica", "Agenda de Clínica");
  // El evento ORIGINAL de la clínica: con descripción, ubicación e invitados de fuera.
  google.eventos.set(`${CAL}/${EV}`, {
    id: EV,
    status: "confirmed",
    summary: TITULO,
    description: "Tel. 555 123 4567 · trae radiografías",
    location: "https://meet.google.com/abc-defg-hij",
    attendees: [{ email: "proveedor@lab.mx" }],
    start: { dateTime: "2026-10-21T10:00:00-06:00", timeZone: ZONA },
    end: { dateTime: "2026-10-21T11:00:00-06:00", timeZone: ZONA },
  });
  const c: CitaParaGoogle = {
    id: "a1", type: "Limpieza", status: "SCHEDULED",
    startsAt: h("2026-10-21T16:00:00Z"), endsAt: h("2026-10-21T17:00:00Z"),
    googleEventId: EV, patientName: "Ana García", doctorName: "Luis Ruiz",
    doctorEmail: "doc@clinica.mx", patientEmail: "ana@correo.mx",
    ...cita,
  };
  const v: Vinculo = {
    title: TITULO,
    eventStartsAt: h("2026-10-21T16:00:00Z"),
    eventEndsAt: h("2026-10-21T17:00:00Z"),
    eventDeletedAt: null,
    avisoPendiente: false,
    mantenerEliminado: false,
    salidaFirma: null,
    entradaActiva: true,
    ...vinculo,
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
    // Igual que `vinculoParaSalida`: sin la entrada, ni aviso ni «última vista».
    leerCita: async () => ({
      ...c,
      desdeGoogle: c.googleEventId === EV
        ? v.entradaActiva
          ? {
              tituloOriginal: v.title,
              avisoPendiente: v.avisoPendiente,
              eventoVisto: { startsAt: v.eventStartsAt, endsAt: v.eventEndsAt, eliminado: !!v.eventDeletedAt },
              mantenerEliminado: v.mantenerEliminado,
            }
          : { tituloOriginal: v.title, avisoPendiente: false }
        : null,
    }),
    guardarEventoId: async (_c, _a, id) => { guardados.push(id); c.googleEventId = id; },
    // Igual que `guardarSalidaConvertida` (la hora, solo si nadie la cambió mientras).
    marcarSalidaConvertida: async (_c, _a, eventId, d) => {
      if (eventId !== EV) return;
      if (d.visto && (!d.visto.antes || (d.visto.antes.startsAt.getTime() === v.eventStartsAt.getTime() && d.visto.antes.endsAt.getTime() === v.eventEndsAt.getTime()))) {
        Object.assign(v, { eventStartsAt: d.visto.startsAt, eventEndsAt: d.visto.endsAt, eventDeletedAt: null });
      }
      if (d.firma) v.salidaFirma = d.firma;
    },
    abrirCalendar: () => google,
    armarContenido: armarContenidoEventoGoogle,
    esErrorDeAutorizacion: () => false,
    marcarCaido: async () => undefined,
    log: () => undefined,
    ahora: () => h("2026-10-20T00:00:00Z"),
  };
  const evento = () => google.eventoEn(CAL, EV)!;
  /** La entrada lee el evento (lo que haría la siguiente pasada) y dice si saldría un aviso. */
  const entrada = () => {
    const e = evento();
    const cambios = decidirAvisoCita(
      e as any,
      { eventStartsAt: v.eventStartsAt, eventEndsAt: v.eventEndsAt, eventDeletedAt: v.eventDeletedAt, avisoTipo: null },
      { status: c.status, startsAt: c.startsAt, endsAt: c.endsAt, googleEventId: c.googleEventId },
      { zona: ZONA, ahora: h("2026-10-20T00:00:00Z") },
    );
    if (cambios.eventStartsAt) v.eventStartsAt = cambios.eventStartsAt;
    if (cambios.eventEndsAt) v.eventEndsAt = cambios.eventEndsAt;
    return cambios.avisoTipo ?? null;
  };
  const mover = (ini: string, fin: string) => { c.startsAt = h(ini); c.endsAt = h(fin); };
  return { google, p, c, v, evento, guardados, entrada, mover };
}

const patches = (g: GoogleFalsa) => g.llamadas.filter((l) => l.op === "events.patch");

test("G6 (decisión del gerente): mover la convertida solo cambia la HORA; título, descripción, ubicación e invitados se quedan", async () => {
  const w = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  const e = w.evento();
  assert.equal(e.summary, TITULO, "nunca «🏥 Limpieza — Ana G.»: lo verían los invitados de fuera");
  assert.equal(e.start.dateTime, "2026-10-21T11:00:00-06:00");
  assert.equal(e.description, "Tel. 555 123 4567 · trae radiografías");
  assert.equal(e.location, "https://meet.google.com/abc-defg-hij");
  assert.deepEqual(e.attendees, [{ email: "proveedor@lab.mx" }]);
  const [patch] = patches(w.google);
  assert.equal(patch.args.sendUpdates, "none");
  for (const k of ["summary", "description", "location", "attendees", "extendedProperties"]) {
    assert.equal(k in patch.args.requestBody, false, `${k} no viaja`);
  }
});

test("G6: ya a la hora de la cita y con su título → no se toca nada", async () => {
  const w = mundo();
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(patches(w.google).length, 0);
});

test("G4: con un aviso sin decidir (Google movió el evento), corregir la cita NO devuelve el evento a la hora vieja", async () => {
  const w = mundo({}, { avisoPendiente: true });
  w.evento().start = { dateTime: "2026-10-21T12:00:00-06:00", timeZone: ZONA };
  w.evento().end = { dateTime: "2026-10-21T13:00:00-06:00", timeZone: ZONA };
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(patches(w.google).length, 0);
  assert.equal(w.evento().start.dateTime, "2026-10-21T12:00:00-06:00", "la hora de Google se queda");
});

test("G4: con el aviso «se eliminó» pendiente, NO se resucita ni se recrea el evento", async () => {
  const w = mundo({}, { avisoPendiente: true });
  w.evento().status = "cancelled";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().status, "cancelled");
  assert.equal(w.google.cuantas("events.insert"), 0);
  // Y si Google ya ni lo tiene (404), tampoco se crea otro.
  const w2 = mundo({}, { avisoPendiente: true });
  w2.google.eventos.clear();
  assert.deepEqual(await sincronizarCita(w2.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(w2.google.cuantas("events.insert"), 0);
  assert.deepEqual(w2.guardados, [], "el id del evento no se toca");
});

test("G6: cancelar NO borra el evento ni avisa a sus invitados: le antepone «Cancelada en DaleControl · » a SU título", async () => {
  const w = mundo({ status: "CANCELLED" });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  assert.equal(w.google.cuantas("events.delete"), 0);
  const e = w.evento();
  assert.equal(e.status, "confirmed");
  assert.equal(e.summary, `Cancelada en DaleControl · ${TITULO}`);
  assert.equal(e.description, "Tel. 555 123 4567 · trae radiografías");
  assert.deepEqual(e.attendees, [{ email: "proveedor@lab.mx" }]);
  const [patch] = patches(w.google);
  assert.equal(patch.args.sendUpdates, "none");
  assert.deepEqual(Object.keys(patch.args.requestBody), ["summary"]);
  assert.deepEqual(w.guardados, [], "la cita sigue ligada a su evento (si se reactiva, no se duplica)");
  // Repetir no duplica el prefijo (ni vuelve a escribir).
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().summary, `Cancelada en DaleControl · ${TITULO}`);
  assert.equal(patches(w.google).length, 1);
  assert.equal(tituloCancelada(`${PREFIJO_CANCELADA}X`), `${PREFIJO_CANCELADA}X`);
  assert.equal(tituloCancelada(""), "Cancelada en DaleControl");
  assert.equal(tituloSinCancelada(`${PREFIJO_CANCELADA}${PREFIJO_CANCELADA}X`), "X");
  assert.equal(tituloSinCancelada("Cancelada en DaleControl"), "");
});

test("G6: si en Google le cambiaron el título, cancelar marca ESE título (no el de cuando se convirtió)", async () => {
  const w = mundo({ status: "CANCELLED" });
  w.evento().summary = "Valoración Sra. López (2ª)";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().summary, "Cancelada en DaleControl · Valoración Sra. López (2ª)");
});

test("G6: «no asistió» en una cita que vino de Google → el evento se deja como está", async () => {
  const w = mundo({ status: "NO_SHOW" });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(w.google.cuantas("events.delete") + w.google.cuantas("events.patch"), 0);
});

test("G6: reactivar la cita cancelada → el MISMO evento recupera SU título (sin «Cancelada…» y sin el de la cita)", async () => {
  const w = mundo({ status: "CANCELLED" });
  await sincronizarCita(w.p, C1, "a1");
  w.c.status = "SCHEDULED";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().summary, TITULO);
  assert.equal(w.google.cuantas("events.insert"), 0);
  assert.equal(w.google.activos(CAL).length, 1);
});

test("N-G1: mover la convertida DOS veces seguidas (sin que pase la entrada) → el evento acaba a la hora de la cita y sin aviso falso", async () => {
  const w = mundo();
  w.mover("2026-10-21T17:00:00Z", "2026-10-21T18:00:00Z"); // 10:00 → 11:00
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  w.mover("2026-10-21T16:00:00Z", "2026-10-21T17:30:00Z"); // la regresan y la alargan
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  assert.equal(w.evento().start.dateTime, "2026-10-21T10:00:00-06:00");
  assert.equal(w.evento().end.dateTime, "2026-10-21T11:30:00-06:00");
  // Una tercera, ya sin cambios, no toca nada.
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "sin_cambios" });
  // Y cuando la entrada lee el evento, no hay nada que avisar.
  assert.equal(w.entrada(), null);
});

test("N-G1: si la entrada vio OTRA hora mientras tanto, la salida no le pisa la «última vista»", async () => {
  const w = mundo();
  w.mover("2026-10-21T17:00:00Z", "2026-10-21T18:00:00Z");
  const original = w.p.marcarSalidaConvertida!;
  w.p.marcarSalidaConvertida = async (...args) => {
    // Justo entre el parche y la anotación, la entrada guardó otra hora.
    w.v.eventStartsAt = h("2026-10-21T19:00:00Z");
    w.v.eventEndsAt = h("2026-10-21T20:00:00Z");
    return original(...args);
  };
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.v.eventStartsAt.toISOString(), "2026-10-21T19:00:00.000Z");
  assert.equal(w.v.salidaFirma, firmaSalidaConvertida(w.c));
});

test("carrera: Google movió el evento y la entrada aún no lo vio → no se deshace el cambio", async () => {
  const w = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") });
  w.evento().start = { dateTime: "2026-10-21T13:00:00-06:00", timeZone: ZONA };
  w.evento().end = { dateTime: "2026-10-21T14:00:00-06:00", timeZone: ZONA };
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.google.cuantas("events.get"), 1);
  assert.equal(patches(w.google).length, 0);
  assert.equal(w.evento().start.dateTime, "2026-10-21T13:00:00-06:00");
});

test("carrera: lo borraron en Google y la entrada aún no lo vio → NO se resucita", async () => {
  const w = mundo();
  w.evento().status = "cancelled";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().status, "cancelled");
  assert.equal(w.google.cuantas("events.insert"), 0);
});

test("«Mantener la cita» tras «se eliminó» (la entrada ya lo vio borrado) → SÍ se restaura, con la hora de la cita y su título", async () => {
  const w = mundo({}, { eventDeletedAt: h("2026-10-20T00:00:00Z"), mantenerEliminado: true });
  w.evento().status = "cancelled";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().status, "confirmed");
  assert.equal(w.evento().summary, TITULO);
  assert.equal(w.v.eventDeletedAt, null, "la última vista ya lo sabe vivo");
});

test("«Mantener» tras pasarlo a TODO EL DÍA en Google (la entrada ya lo vio así) → vuelve a la hora de la cita", async () => {
  // La entrada guardó el día completo en la zona de la clínica (00:00–00:00 = 06:00Z–06:00Z).
  const w = mundo({}, { eventStartsAt: h("2026-10-21T06:00:00Z"), eventEndsAt: h("2026-10-22T06:00:00Z") });
  w.evento().start = { date: "2026-10-21" };
  w.evento().end = { date: "2026-10-22" };
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().start.dateTime, "2026-10-21T10:00:00-06:00");
});

test("N-G9: sin la entrada (bandera apagada o calendario que no se lee) manda DaleControl: la hora SÍ se copia aunque Google la cambiara", async () => {
  const w = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") }, { entradaActiva: false });
  w.evento().start = { dateTime: "2026-10-21T13:00:00-06:00", timeZone: ZONA };
  w.evento().end = { dateTime: "2026-10-21T14:00:00-06:00", timeZone: ZONA };
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  assert.equal(w.evento().start.dateTime, "2026-10-21T11:00:00-06:00");
  assert.equal(w.evento().summary, TITULO, "el título sigue siendo el suyo");
  // Y cancelar sigue siendo «solo el título».
  w.c.status = "CANCELLED";
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.google.cuantas("events.delete"), 0);
  assert.match(w.evento().summary, /^Cancelada en DaleControl · /);
});

test("N-G11: Google ya no tiene el evento (404, p. ej. lo pasaron a otro calendario) → NO se crea otro ni se invita a nadie", async () => {
  const w = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") });
  w.google.eventos.clear();
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(w.google.cuantas("events.insert"), 0);
  assert.deepEqual(w.guardados, []);
});

test("N-G11: tras «Mantener» un evento que Google ya no tiene → uno NUEVO, sin invitados (ni invitación ahora ni cancelación después)", async () => {
  const w = mundo({}, { eventDeletedAt: h("2026-10-20T00:00:00Z"), mantenerEliminado: true });
  w.google.eventos.clear();
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "creado" });
  const ins = w.google.llamadas.find((l) => l.op === "events.insert")!;
  assert.equal(ins.args.sendUpdates, "none");
  assert.deepEqual(ins.args.requestBody.attendees, []);
  assert.equal(w.guardados.length, 1);
});

test("N-G11: la entrada lo vio borrado pero NADIE pulsó «Mantener» (p. ej. se reactivó la cita) → ni se resucita ni se crea otro", async () => {
  const w = mundo({}, { eventDeletedAt: h("2026-10-20T00:00:00Z") });
  w.evento().status = "cancelled";
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(w.evento().status, "cancelled");
  const w2 = mundo({}, { eventDeletedAt: h("2026-10-20T00:00:00Z") });
  w2.google.eventos.clear();
  assert.deepEqual(await sincronizarCita(w2.p, C1, "a1"), { estado: "sin_cambios" });
  assert.equal(w2.google.cuantas("events.insert"), 0);
  // Y sin la entrada (bandera apagada) tampoco: un evento borrado en Google no vuelve solo.
  const w3 = mundo({}, { entradaActiva: false });
  w3.evento().status = "cancelled";
  await sincronizarCita(w3.p, C1, "a1");
  assert.equal(w3.evento().status, "cancelled");
});

test("N-G12: cada salida buena deja la firma de la cita (estado y hora); un fallo no la deja", async () => {
  const w = mundo({ status: "CANCELLED" });
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.v.salidaFirma, "CANCELLED|2026-10-21T16:00:00.000Z|2026-10-21T17:00:00.000Z");
  const w2 = mundo({ status: "CANCELLED" });
  w2.google.fallar("events.patch", Object.assign(new Error("Service Unavailable"), { response: { status: 503 } }), 1);
  const r = await sincronizarCita(w2.p, C1, "a1");
  assert.equal(r.estado, "fallo");
  assert.equal(w2.v.salidaFirma, null, "sin firma: el cron la reintenta");
  // El reintento (lo que hace el cron) sí llega.
  await sincronizarCita(w2.p, C1, "a1");
  assert.match(w2.evento().summary, /^Cancelada en DaleControl · /);
  assert.equal(w2.v.salidaFirma, firmaSalidaConvertida(w2.c));
});

test("N-G12: si la hora NO se copió porque falta decidir (aviso) o que la entrada vea el cambio, no se firma: el cron vuelve a pasar", async () => {
  const w = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") }, { avisoPendiente: true });
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.v.salidaFirma, null);
  const w2 = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") });
  w2.evento().start = { dateTime: "2026-10-21T13:00:00-06:00", timeZone: ZONA };
  w2.evento().end = { dateTime: "2026-10-21T14:00:00-06:00", timeZone: ZONA };
  await sincronizarCita(w2.p, C1, "a1");
  assert.equal(w2.v.salidaFirma, null);
});

test("N-G12: un 4xx que no se arregla reintentando (403 de no organizador) SÍ se firma: el cron no lo repite cada 5 minutos", async () => {
  const w = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") });
  w.google.fallar("events.patch", Object.assign(new Error("Forbidden"), { response: { status: 403, data: { error: { errors: [{ reason: "forbiddenForNonOrganizer" }] } } } }), 1);
  const r = await sincronizarCita(w.p, C1, "a1");
  assert.equal(r.estado, "fallo");
  assert.equal(w.v.salidaFirma, firmaSalidaConvertida(w.c));
});

test("N-G1: la cita se mueve OTRA vez mientras se copiaba la primera (dos cambios casi a la vez) → otra vuelta: Google acaba a la hora nueva y sin aviso", async () => {
  const w = mundo();
  w.mover("2026-10-21T17:00:00Z", "2026-10-21T18:00:00Z");
  let primero = true;
  w.google.antes = (op) => {
    if (op === "events.patch" && primero) {
      primero = false;
      w.mover("2026-10-21T19:00:00Z", "2026-10-21T20:00:00Z"); // el segundo cambio llega a la base mientras tanto
    }
  };
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "actualizado" });
  assert.equal(w.evento().start.dateTime, "2026-10-21T13:00:00-06:00");
  assert.equal(w.v.eventStartsAt.toISOString(), "2026-10-21T19:00:00.000Z");
  assert.equal(w.v.salidaFirma, firmaSalidaConvertida(w.c));
  assert.equal(w.entrada(), null);
});

test("N-G12: un 403 PASAJERO (cuota de Google) no se firma: el cron lo vuelve a intentar", async () => {
  const w = mundo({ status: "CANCELLED" });
  w.google.fallar("events.patch", Object.assign(new Error("Rate Limit Exceeded"), { response: { status: 403, data: { error: { errors: [{ reason: "rateLimitExceeded" }] } } } }), 1);
  assert.equal((await sincronizarCita(w.p, C1, "a1")).estado, "fallo");
  assert.equal(w.v.salidaFirma, null);
});

test("G6: copiar la hora no le cambia el estado a un evento «tentativo» de la clínica, ni le recorta el título", async () => {
  const w = mundo({ startsAt: h("2026-10-21T17:00:00Z"), endsAt: h("2026-10-21T18:00:00Z") });
  (w.evento() as { status: string }).status = "tentative";
  w.evento().summary = "  Valoración ";
  await sincronizarCita(w.p, C1, "a1");
  const [patch] = patches(w.google);
  assert.equal("status" in patch.args.requestBody, false);
  assert.equal("summary" in patch.args.requestBody, false);
  assert.equal(w.evento().status, "tentative");
});

test("un evento sin fecha legible no deja al cron leyéndolo cada 5 minutos: manda la cita y se firma", async () => {
  const w = mundo();
  w.evento().start = {};
  w.evento().end = {};
  await sincronizarCita(w.p, C1, "a1");
  assert.equal(w.evento().start.dateTime, "2026-10-21T10:00:00-06:00");
  assert.equal(w.v.salidaFirma, firmaSalidaConvertida(w.c));
});

test("las citas NORMALES siguen como siempre: cancelar borra su evento", async () => {
  const w = mundo({ status: "CANCELLED", googleEventId: "otro-evento" });
  w.google.eventos.set(`${CAL}/otro-evento`, { id: "otro-evento", status: "confirmed", summary: "x", start: {}, end: {} });
  assert.deepEqual(await sincronizarCita(w.p, C1, "a1"), { estado: "borrado" });
  assert.equal(w.google.eventoEn(CAL, "otro-evento").status, "cancelled");
  assert.deepEqual(w.guardados, [null]);
});
