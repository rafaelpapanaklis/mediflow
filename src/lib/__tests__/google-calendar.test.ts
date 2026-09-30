import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIMEOUT_GOOGLE_MS, borrarEvento, buscarOCrearCalendarioDeClinica, crearClienteCalendar, estadoHttpDeError,
  idEventoDeCita, insertarEvento, marcaCalendarioDeClinica, parcharEvento, razonDeError, signState, verifyState,
  type DatosEvento,
} from "../google-calendar";
import { GoogleFalsa, errorGoogle } from "../agenda/__tests__/google-falsa";

const datos = (extra: Partial<DatosEvento> = {}): DatosEvento => ({
  calendarId: "cal", eventId: idEventoDeCita("c1", "a1"),
  contenido: { summary: "🏥 Limpieza — Ana G.", description: "Tipo: Limpieza", location: "Calle 1", attendees: [{ email: "a@b.mx" }] },
  startsAt: new Date("2026-10-15T16:00:00Z"), endsAt: new Date("2026-10-15T16:30:00Z"),
  timeZone: "America/Mexico_City", clinicId: "c1", appointmentId: "a1", ...extra,
});

test("idEventoDeCita: base32hex válido para Google, estable, y distinto por clínica y por cita", () => {
  const id = idEventoDeCita("clinica-1", "cita-1");
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(id, idEventoDeCita("clinica-1", "cita-1"));
  assert.notEqual(id, idEventoDeCita("clinica-2", "cita-1"));
  assert.notEqual(id, idEventoDeCita("clinica-1", "cita-2"));
  // un cuid real (letras w-z incluidas) no podría ir tal cual: por eso se hashea
  assert.match(idEventoDeCita("cmn6soeaw0000t17xgljxc2iq", "cmxyz9wvuts"), /^[a-v0-9]+$/);
});

test("el state firmado sigue verificándose igual (no se rompió con el rediseño)", () => {
  const s = signState("user-1");
  assert.equal(verifyState(s), "user-1");
  assert.equal(verifyState(s.replace("user-1", "user-2")), null);
});

test("estadoHttpDeError / razonDeError leen los errores de googleapis y gaxios", () => {
  assert.equal(estadoHttpDeError(errorGoogle(404)), 404);
  assert.equal(estadoHttpDeError({ code: 410 }), 410);
  assert.equal(estadoHttpDeError({ response: { status: 409 } }), 409);
  assert.equal(estadoHttpDeError({ code: "ECONNRESET" }), null);
  assert.equal(estadoHttpDeError(new Error("x")), null);
  assert.equal(estadoHttpDeError(null), null);
  assert.equal(razonDeError(errorGoogle(403, "accessNotConfigured")), "accessNotConfigured");
  assert.equal(razonDeError(new Error("x")), null);
});

test("calendario: recorre todas las páginas de la lista antes de decidir que no existe", async () => {
  const g = new GoogleFalsa();
  const pagina2 = { id: "el-mio", summary: "Clínica", description: `x — ${marcaCalendarioDeClinica("c1")}` };
  let llamada = 0;
  g.calendarList.list = async () => {
    llamada++;
    return llamada === 1
      ? { data: { items: [{ id: "otro", summary: "Otro", description: "" }], nextPageToken: "p2" } }
      : { data: { items: [pagina2] } };
  };
  const r = await buscarOCrearCalendarioDeClinica(g, { clinicId: "c1", clinicName: "Clínica", timezone: "America/Mexico_City" });
  assert.deepEqual(r, { id: "el-mio", creado: false });
  assert.equal(g.cuantas("calendars.insert"), 0);
});

test("calendario nuevo: lleva la zona de la clínica y la marca; si falla el color igual queda creado", async () => {
  const g = new GoogleFalsa();
  g.fallar("calendarList.patch", errorGoogle(500));
  const r = await buscarOCrearCalendarioDeClinica(g, { clinicId: "c1", clinicName: "Clínica", timezone: "America/Tijuana" });
  assert.equal(r.creado, true);
  const cal = g.calendarios.get(r.id)!;
  assert.equal(cal.timeZone, "America/Tijuana");
  assert.ok(cal.description.includes(marcaCalendarioDeClinica("c1")));
});

test("calendario: si Google falla, LANZA (antes se tragaba el error y las citas iban al calendario personal)", async () => {
  const g = new GoogleFalsa();
  g.fallar("calendars.insert", errorGoogle(403, "forbidden"));
  await assert.rejects(() => buscarOCrearCalendarioDeClinica(g, { clinicId: "c1", clinicName: "C", timezone: "America/Mexico_City" }));
});

test("parcharEvento: 404 y 410 = «ya no existe»; otro error se propaga", async () => {
  const g = new GoogleFalsa();
  g.sembrarCalendario("cal", "C", "");
  assert.equal(await parcharEvento(g, datos()), "no_existe");
  g.fallar("events.patch", errorGoogle(410), 1);
  assert.equal(await parcharEvento(g, datos()), "no_existe");
  g.fallar("events.patch", errorGoogle(500), 1);
  await assert.rejects(() => parcharEvento(g, datos()), /500/);
});

test("insertarEvento: 409 reanuda con patch; si el patch tampoco lo encuentra, propaga el 409", async () => {
  const g = new GoogleFalsa();
  g.sembrarCalendario("cal", "C", "");
  assert.equal(await insertarEvento(g, datos(), { avisarInvitados: true }), "creado");
  assert.equal(await insertarEvento(g, datos(), { avisarInvitados: true }), "reanudado");
  assert.equal(g.activos().length, 1);

  const h = new GoogleFalsa();
  h.sembrarCalendario("cal", "C", "");
  h.fallar("events.insert", errorGoogle(409));
  await assert.rejects(() => insertarEvento(h, datos(), { avisarInvitados: true }), /409/);
});

test("insertarEvento: sendUpdates según haya invitados y se pida avisar", async () => {
  const g = new GoogleFalsa();
  g.sembrarCalendario("cal", "C", "");
  await insertarEvento(g, datos({ eventId: "e1" }), { avisarInvitados: true });
  await insertarEvento(g, datos({ eventId: "e2" }), { avisarInvitados: false });
  await insertarEvento(g, datos({ eventId: "e3", contenido: { summary: "s", description: "d", attendees: [] } }), { avisarInvitados: true });
  assert.deepEqual(g.llamadas.filter((l) => l.op === "events.insert").map((l) => l.args.sendUpdates), ["all", "none", "none"]);
});

test("borrarEvento: 404 y 410 cuentan como borrado; un 500 se propaga", async () => {
  const g = new GoogleFalsa();
  g.sembrarCalendario("cal", "C", "");
  await insertarEvento(g, datos(), { avisarInvitados: false });
  assert.equal(await borrarEvento(g, { calendarId: "cal", eventId: datos().eventId }, { avisarInvitados: true }), "borrado");
  assert.equal(await borrarEvento(g, { calendarId: "cal", eventId: datos().eventId }, { avisarInvitados: true }), "no_existia"); // 410
  assert.equal(await borrarEvento(g, { calendarId: "cal", eventId: "nunca" }, { avisarInvitados: true }), "no_existia"); // 404
  g.fallar("events.delete", errorGoogle(500));
  await assert.rejects(() => borrarEvento(g, { calendarId: "cal", eventId: datos().eventId }, { avisarInvitados: true }), /500/);
});

test("el cliente real: tiene tope de tiempo y avisa del access token renovado", () => {
  assert.ok(TIMEOUT_GOOGLE_MS > 0 && TIMEOUT_GOOGLE_MS <= 15_000);
  const renovados: string[] = [];
  const cal: any = crearClienteCalendar({ accessToken: null, refreshToken: "rt", alRenovarToken: (t) => renovados.push(t) });
  const auth = cal.context._options.auth;
  assert.equal(auth.credentials.refresh_token, "rt");
  assert.equal(auth.credentials.access_token, undefined, "sin access token guardado, la librería lo pide con el refresh");
  assert.equal(auth.transporter.defaults.timeout, TIMEOUT_GOOGLE_MS, "la renovación del token también tiene tope");
  assert.equal(cal.context._options.timeout, TIMEOUT_GOOGLE_MS, "y cada llamada a Calendar");
  auth.emit("tokens", { access_token: "nuevo" });
  auth.emit("tokens", { refresh_token: "solo-refresh" }); // sin access token: no se avisa
  assert.deepEqual(renovados, ["nuevo"]);
});
