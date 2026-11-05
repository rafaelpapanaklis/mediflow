/**
 * Cita «Sin doctor» y Google Calendar (ws1-t10 · fase 2 · P3). Rafael: «revisa
 * que funcione bien con Google Calendar y no vayas a desconectar las cuentas».
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 * El NÚCLEO real de la salida (`sincronizarCita`) con sus puertos doblados y la
 * Google falsa de google-sync.test.ts. Sin red, sin base.
 *  · alta «Sin doctor»: el evento nace sin «Doctor/a:» y sin invitar a nadie del equipo;
 *  · asignarle doctor: la descripción lo dice; NO se le invita (D10: Google no
 *    le manda correos) y el patch no toca attendees;
 *  · quitárselo: la línea desaparece;
 *  · en ningún paso se guardan tokens, se marca la conexión caída ni cambia el
 *    calendario de la clínica.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sincronizarCita, type CitaParaGoogle, type ClinicaGoogle, type PuertosEnBloque } from "../google-sync-nucleo";
import { idEventoDeCita } from "../../google-calendar";
import { armarContenidoEventoGoogle } from "../../google-calendar-contenido";
import { esErrorDeAutorizacionGoogle } from "../../google-calendar-estado";
import { GoogleFalsa } from "./google-falsa";

const C1 = "seed-clinica-salamanca";
const CITA = "dentalink-cita-48213"; // importada de Dentalink: id que no es uuid
const ZONA = "America/Mexico_City";

function mundo() {
  const google = new GoogleFalsa();
  const clinica: ClinicaGoogle = {
    id: C1, name: "Centro Dental Salamanca QA", address: "Calle 1", timezone: ZONA, enabled: true,
    accessToken: "at-viejo", refreshToken: "rt-1", calendarId: null, cuentaEmail: "clinica@gmail.com",
  };
  const cita: CitaParaGoogle & { clinicId: string } = {
    id: CITA, clinicId: C1, type: "Limpieza", status: "SCHEDULED",
    startsAt: new Date("2026-11-10T16:00:00Z"), endsAt: new Date("2026-11-10T16:30:00Z"),
    googleEventId: null, patientName: "Ana García López", doctorName: null, doctorEmail: null, patientEmail: null,
  };
  const efectos = { tokens: 0, caidas: 0, calendarios: [] as string[] };
  const puertos: PuertosEnBloque = {
    leerClinica: async (id) => (id === C1 ? { ...clinica } : null),
    leerAjustes: async () => ({ invitarPaciente: true, caidoDesde: null }),
    guardarAccessToken: async () => { efectos.tokens++; },
    fijarCalendarioId: async (_c, calId, esperado) => {
      if (clinica.calendarId === esperado) { clinica.calendarId = calId; efectos.calendarios.push(calId); }
      return clinica.calendarId ?? calId;
    },
    leerCita: async (clinicId, id) => (clinicId === C1 && id === CITA ? { ...cita } : null),
    guardarEventoId: async (_c, _id, eventId) => { cita.googleEventId = eventId; },
    abrirCalendar: () => google,
    armarContenido: armarContenidoEventoGoogle,
    esErrorDeAutorizacion: esErrorDeAutorizacionGoogle,
    marcarCaido: async () => { efectos.caidas++; },
    log: () => undefined,
    ahora: () => new Date("2026-11-04T00:00:00Z"),
    listarFuturasSinEvento: async () => [],
    contarFuturasSinEvento: async () => 0,
    contarFuturasConEvento: async () => 0,
  };
  return { google, clinica, cita, puertos, efectos };
}

test("🔴 alta, asignar y quitar el doctor: la descripción lo sigue, nadie se invita, la conexión no se toca", async () => {
  const w = mundo();

  // 1 · Alta «Sin doctor».
  assert.deepEqual(await sincronizarCita(w.puertos, C1, CITA), { estado: "creado" });
  const calId = w.clinica.calendarId!;
  const id = idEventoDeCita(C1, CITA);
  let ev = w.google.eventoEn(calId, id)!;
  assert.doesNotMatch(ev.description, /Doctor\/a:/, ev.description);
  assert.match(ev.description, /Tipo: Limpieza/);
  assert.deepEqual(ev.attendees ?? [], [], "sin doctor no se invita a nadie");

  // 2 · Se le asigna doctor (llegó / inició / «Editar cita»).
  w.cita.doctorName = "Luis Ruiz";
  w.cita.doctorEmail = "luis@clinica.mx";
  assert.equal((await sincronizarCita(w.puertos, C1, CITA)).estado, "actualizado");
  ev = w.google.eventoEn(calId, id)!;
  assert.match(ev.description, /Doctor\/a: Luis Ruiz/);
  assert.deepEqual(ev.attendees ?? [], [], "D10: al asignarlo después NO se le invita (Google no le manda correo)");
  const patch = w.google.llamadas.filter((l) => l.op === "events.patch").at(-1)!.args;
  assert.equal("attendees" in patch.requestBody, false, "el patch no toca attendees");
  assert.equal(patch.sendUpdates, "none");

  // 3 · Se le quita (vuelve a «Sin doctor»).
  w.cita.doctorName = null;
  w.cita.doctorEmail = null;
  assert.equal((await sincronizarCita(w.puertos, C1, CITA)).estado, "actualizado");
  ev = w.google.eventoEn(calId, id)!;
  assert.doesNotMatch(ev.description, /Doctor\/a:/);

  // Ni tokens, ni «conexión caída», ni otro calendario: un solo evento, el mismo.
  assert.equal(w.efectos.tokens, 0, "no se guardó ningún token");
  assert.equal(w.efectos.caidas, 0, "la conexión no se marcó caída");
  assert.deepEqual(w.efectos.calendarios, [calId], "el calendario de la clínica se fijó una vez y no cambió");
  assert.equal(w.clinica.enabled, true);
  assert.equal(w.clinica.refreshToken, "rt-1");
  assert.equal(w.google.activos().length, 1, "sin duplicar el evento");
});

test("con doctor desde el alta, el evento sale como siempre (descripción e invitación)", async () => {
  const w = mundo();
  w.cita.doctorName = "Luis Ruiz";
  w.cita.doctorEmail = "luis@clinica.mx";
  await sincronizarCita(w.puertos, C1, CITA);
  const ev = w.google.eventoEn(w.clinica.calendarId!, idEventoDeCita(C1, CITA))!;
  assert.match(ev.description, /Doctor\/a: Luis Ruiz/);
  assert.deepEqual(ev.attendees.map((a: any) => a.email), ["luis@clinica.mx"]);
});

test("cancelar una «Sin doctor» borra su evento como cualquier otra", async () => {
  const w = mundo();
  await sincronizarCita(w.puertos, C1, CITA);
  w.cita.status = "CANCELLED";
  const r = await sincronizarCita(w.puertos, C1, CITA);
  assert.equal(r.estado, "borrado");
  assert.equal(w.google.activos().length, 0);
  assert.equal(w.efectos.caidas, 0);
});
