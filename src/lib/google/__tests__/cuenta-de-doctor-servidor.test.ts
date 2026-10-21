/**
 * Google Calendar → agenda (WS1-T3, 21-oct-2026): un evento de Google bloquea
 * SOLO al dueño de la cuenta conectada, nunca a toda la clínica (decisión de
 * Rafael). Se EJECUTA la entrada contra la base de mentira (los puertos reales
 * de `entrante.server.ts`) con una Google falsa:
 *
 *   · El caso de Rafael: la clínica está conectada con el Gmail de «rafa
 *     papa» (SUPER_ADMIN que atiende); un «Evento Social - Comida» con un
 *     PACIENTE invitado cierra solo su agenda, no la de los 4.
 *   · v2: el agente de marketing invita al Dr. y a la dirección del
 *     calendario → solo ese Dr.; varios doctores → un bloqueo cada uno.
 *   · Cuenta general (recepción): no bloquea a nadie, y la pantalla lo dice.
 *   · E: los bloqueos que la regla anterior dejó de toda la clínica se
 *     reasignan (el mismo bloqueo) o se retiran (deletedAt), sin borrar.
 *
 * `npm run test:google-entrante`
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { activos, bandera, CAL, clinica, conGoogle, db, deGoogle, hace, prisma, reiniciar, type Fila } from "./base-de-mentira";

(mock as any).module("@/lib/prisma", { namedExports: { prisma } });

const servidor = () => import("../entrante.server");

const RAFA = "rafaelpapanaklis@gmail.com";

/** «Rafael Clinica»: rafa papa (SUPER_ADMIN que atiende), tres doctores sin Google propio y recepción. */
function rafaelClinica(cuenta: string | null = RAFA) {
  clinica("c1", { googleCalendarEmail: cuenta });
  db.usuarios.push(
    { id: "u-rafa", clinicId: "c1", email: RAFA, googleCalendarEmail: RAFA, role: "SUPER_ADMIN", isActive: true, agendaActive: true },
    { id: "u-d", clinicId: "c1", email: "d@gmail.com", googleCalendarEmail: null, role: "DOCTOR", isActive: true, agendaActive: true },
    { id: "u-jg", clinicId: "c1", email: "jg@gmail.com", googleCalendarEmail: null, role: "DOCTOR", isActive: true, agendaActive: true },
    { id: "u-jm", clinicId: "c1", email: "jorgemar@gmail.com", googleCalendarEmail: null, role: "DOCTOR", isActive: true, agendaActive: true },
    { id: "u-rec", clinicId: "c1", email: "recepcion.rafaelclinica@gmail.com", googleCalendarEmail: null, role: "RECEPTIONIST", isActive: true, agendaActive: true },
  );
}

const manana = (h: number) => {
  const d = new Date(Date.now() + 24 * 3_600_000);
  d.setUTCHours(h, 0, 0, 0);
  return d;
};
const comida = (x: Fila = {}) => ({
  id: "comida1", status: "confirmed", summary: "Evento Social - Comida", updated: hace(1).toISOString(),
  start: { dateTime: manana(19).toISOString() }, end: { dateTime: manana(21).toISOString() },
  attendees: [{ email: "paciente.juan@hotmail.com", responseStatus: "needsAction" }],
  ...x,
});

async function sincronizar(items: Fila[]) {
  const g = await conGoogle(async () => ({ data: { items, nextSyncToken: "s1" } }));
  try {
    const { sincronizarCalendarioEntrante } = await servidor();
    return { r: await sincronizarCalendarioEntrante("c1"), pedidas: g.pedidas };
  } finally {
    g.restaurar();
  }
}
const vivos = () => db.bloques.filter((b) => b.deletedAt === null);

test("caso de Rafael: cuenta de la clínica = rafa papa, invitado un PACIENTE → solo la agenda de rafa papa (antes: «no_reconocido», los 4 doctores)", async () => {
  reiniciar();
  rafaelClinica();
  bandera("c1", { syncToken: null, lastFullSyncAt: null });
  const { r } = await sincronizar([comida()]);
  assert.equal(r.estado, "ok");
  assert.equal(vivos().length, 1);
  assert.equal(vivos()[0].doctorId, "u-rafa", "solo rafa papa");
  assert.equal(vivos()[0].reason, "Ocupado (Google)", "el título nunca va al motivo (el bot lo lee)");
  assert.equal(db.vinculos[0].alcance, null);
  assert.equal(db.vinculos[0].title, "Evento Social - Comida");
});

test("caso de Rafael sin invitados → solo rafa papa; invitando a OTROS doctores → un bloqueo para cada invitado (nunca toda la clínica)", async () => {
  reiniciar();
  rafaelClinica();
  bandera("c1", { syncToken: null, lastFullSyncAt: null });
  await sincronizar([
    comida({ id: "sin-invitados", attendees: undefined }),
    comida({ id: "con-doctores", attendees: [{ email: "D@gmail.com" }, { email: "jg@gmail.com", responseStatus: "accepted" }, { email: "jorgemar@gmail.com", responseStatus: "declined" }] }),
  ]);
  const de = (ev: string) => db.vinculos.filter((v) => v.googleEventId === ev).map((v) => db.bloques.find((b) => b.id === v.blockId)!.doctorId).sort();
  assert.deepEqual(de("sin-invitados"), ["u-rafa"]);
  assert.deepEqual(de("con-doctores"), ["u-d", "u-jg"], "jorgemar rechazó: no");
  assert.ok(vivos().every((b) => b.doctorId !== null));
});

test("v2 · el agente de marketing (sin cuenta en DaleControl) agenda desde SU Google invitando al Dr. D y a la dirección del calendario de la clínica → solo el Dr. D", async () => {
  reiniciar();
  rafaelClinica();
  bandera("c1", { syncToken: null, lastFullSyncAt: null });
  await sincronizar([
    comida({
      id: "del-agente", summary: "Valoración — Juan P.",
      attendees: [
        { email: "agente.mkt@gmail.com", organizer: true, responseStatus: "accepted" },
        { email: "d@gmail.com", responseStatus: "needsAction" },
        { email: CAL, self: true, responseStatus: "accepted" },
        { email: "paciente.juan@hotmail.com" },
      ],
    }),
  ]);
  assert.deepEqual(vivos().map((b) => b.doctorId), ["u-d"], "ni rafa (el dueño), ni el agente, ni el paciente");
});

test("cuenta GENERAL (Gmail de recepción) sin doctores invitados → no se bloquea a nadie, y la agenda y Configuración lo dicen (sinDueno); con un doctor invitado, a él", async () => {
  reiniciar();
  rafaelClinica("recepcion.rafaelclinica@gmail.com");
  bandera("c1", { syncToken: null, lastFullSyncAt: null });
  await sincronizar([comida({ attendees: undefined }), comida({ id: "con-doctor", attendees: [{ email: "jg@gmail.com" }] })]);
  assert.deepEqual(vivos().map((b) => b.doctorId), ["u-jg"], "solo el del doctor invitado; el otro, nadie (ni toda la clínica)");
  const { estadoEntranteParaPantalla } = await servidor();
  assert.equal((await estadoEntranteParaPantalla("c1")).sinDueno, true);
});

test("la cuenta de un doctor → la pantalla NO dice «sinDueno»; Google desconectado tampoco (ahí manda el otro aviso)", async () => {
  reiniciar();
  rafaelClinica();
  bandera("c1");
  const { estadoEntranteParaPantalla } = await servidor();
  assert.equal((await estadoEntranteParaPantalla("c1")).sinDueno, false);
  db.clinics.get("c1")!.googleRefreshToken = null;
  db.clinics.get("c1")!.googleCalendarEmail = "recepcion.rafaelclinica@gmail.com";
  assert.equal((await estadoEntranteParaPantalla("c1")).sinDueno, false);
});

test("cuenta conectada por un doctor-admin que atiende (su googleCalendarEmail = esa cuenta, entra con otro correo) → sus eventos lo bloquean a él", async () => {
  reiniciar();
  rafaelClinica("consultorio.rafael@gmail.com");
  // El callback le puso a rafa papa la cuenta que conectó: es «el correo que tiene ligado Google Calendar».
  db.usuarios.find((u) => u.id === "u-rafa")!.googleCalendarEmail = "consultorio.rafael@gmail.com";
  bandera("c1", { syncToken: null, lastFullSyncAt: null });
  await sincronizar([comida()]);
  assert.deepEqual(vivos().map((b) => b.doctorId), ["u-rafa"]);
});

test("E: el bloqueo que la regla anterior dejó de toda la clínica se REASIGNA en la siguiente pasada (completa aunque Google no cambió; mismo bloqueo, nada se borra)", async () => {
  reiniciar();
  rafaelClinica();
  const b = deGoogle("b-comida", "comida1");
  b.startsAt = manana(19);
  b.endsAt = manana(21);
  Object.assign(db.vinculos[0], { alcance: "no_reconocido", title: "Evento Social - Comida", eventStartsAt: b.startsAt, eventEndsAt: b.endsAt });
  // La fila como la dejó la regla 3: con syncToken y su firma (otra).
  bandera("c1", { syncToken: "tok-viejo", lastFullSyncAt: hace(1), equipoFirma: "4-regla3cualquiera" });
  const { r, pedidas } = await sincronizar([comida()]);
  assert.equal(r.estado === "ok" && r.completa, true);
  assert.ok(pedidas[0].timeMin, "completa (con fechas), no con el syncToken viejo");
  assert.equal(pedidas[0].syncToken, undefined);
  assert.deepEqual(activos(), ["b-comida"], "el mismo bloqueo, sin duplicar");
  assert.equal(db.bloques.length, 1);
  assert.equal(b.doctorId, "u-rafa");
  assert.equal(db.vinculos[0].alcance, null);
  assert.equal(db.imports.get("c1")!.syncToken, "s1");
  assert.equal(db.imports.get("c1")!.calendarId, CAL);
});

test("E: con una cuenta general, los de toda la clínica que quedaban se RETIRAN (deletedAt), no se borran; al conectar la de un doctor vuelven a él", async () => {
  reiniciar();
  rafaelClinica("recepcion.rafaelclinica@gmail.com");
  const b = deGoogle("b-comida", "comida1");
  b.startsAt = manana(19);
  b.endsAt = manana(21);
  Object.assign(db.vinculos[0], { eventStartsAt: b.startsAt, eventEndsAt: b.endsAt });
  bandera("c1", { syncToken: "tok-viejo", lastFullSyncAt: hace(1), equipoFirma: "4-regla3cualquiera" });
  await sincronizar([comida()]);
  assert.equal(db.bloques.length, 1, "no se borra");
  assert.ok(b.deletedAt instanceof Date, "retirado");
  // Se reconecta con la cuenta de rafa papa: la huella cambia, completa, y el MISMO bloqueo vuelve, suyo.
  db.clinics.get("c1")!.googleCalendarEmail = RAFA;
  const { pedidas } = await sincronizar([comida()]);
  assert.ok(pedidas[0].timeMin, "completa");
  assert.equal(db.bloques.length, 1);
  assert.equal(b.deletedAt, null);
  assert.equal(b.doctorId, "u-rafa");
});

test("D: los eventos de las citas de DaleControl siguen sin importarse con la cuenta de un doctor (el eco)", async () => {
  reiniciar();
  rafaelClinica();
  bandera("c1", { syncToken: null, lastFullSyncAt: null });
  await sincronizar([
    comida({ id: "dc" + "a".repeat(40), summary: "🏥 Limpieza — das D." }),
    comida({ id: "marcado1", extendedProperties: { private: { dalecontrolClinicId: "c1" } } }),
  ]);
  assert.equal(db.bloques.length, 0);
});
