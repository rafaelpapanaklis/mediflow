/**
 * Google Calendar → agenda (WS1-T9), segunda vuelta de la revisión t8: lo que
 * vive contra la base, EJECUTADO con una base de mentira (mock de
 * `@/lib/prisma`) en vez de buscar texto en el código:
 *
 *   · G3/N-G3 — el cron retira los bloqueos tras un día sin sincronizar bien,
 *     por cualquier causa, sin la tabla de ws1-t12; sin token, ya.
 *   · N-G3   — no se crea canal de avisos sobre un calendario que no se lee.
 *   · N-G8   — `retirarNoVistos` recorre TODOS los bloqueos, por páginas.
 *   · N-G2   — el equipo llega con el Gmail con el que conectó, rol y nombre.
 *   · N-G9   — sin la bandera, la salida no recibe «última vista» ni aviso.
 *   · N-G10  — limpiar un «movido» resuelto no borra uno nuevo.
 *   · N-G12  — el cron encuentra y reintenta las convertidas sin firma al día.
 *
 * Y de la TERCERA vuelta, con una Google falsa en los puertos:
 *   · N3-G1  — el cron sincroniza primero; con Google sano no retira nada de
 *     golpe, y el retiro va con el turno y deja la siguiente pasada completa.
 *   · N3-G2  — el estado de la pantalla dice desde cuándo y por qué los
 *     eventos de Google ya no cierran la agenda: cuando el cron los retiró de
 *     verdad, hasta que la completa los repone; un «parcial» no deshace lo
 *     repuesto.
 *
 * `npm run test:google-entrante`
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { firmaEquipo } from "../entrante-core";
import {
  activos, AHORA, antesDeTomarTurno, bandera, bloqueo, clinica, conGoogle, correrCron, db, deGoogle, enGoogle,
  cortes, hace, llamadas, prisma, reiniciar, trasSoltar, type Fila,
} from "./base-de-mentira";

(mock as any).module("@/lib/prisma", { namedExports: { prisma } });

const servidor = () => import("../entrante.server");
const convertir = () => import("../convertir.server");

/* ═══ G3 / N-G3: ningún bloqueo se queda para siempre ════════════════════ */

test("G3/N-G3: un día sin sincronizar bien por PERMISOS (no caída) → el cron retira los bloqueos, sin la tabla de ws1-t12", async () => {
  reiniciar();
  clinica("c1", { googleClinicCalendarId: "dra.ruiz@gmail.com" }); // calendario que la entrada no lee
  bandera("c1", { lastSyncAt: hace(25), lastError: "calendario_personal" });
  bloqueo("b1", "c1");
  bloqueo("b2", "c1");
  const { bloqueosDeGoogleSinMantener } = await servidor();
  assert.deepEqual(await bloqueosDeGoogleSinMantener("c1"), { retirar: true, desconectada: false });
  const r = await correrCron();
  assert.equal(r.retirados, 2);
  assert.ok(db.bloques.every((b) => b.deletedAt instanceof Date), "retirados (deletedAt), no borrados");
  assert.equal(db.bloques.length, 2);
  assert.equal(db.imports.get("c1")!.syncToken, null, "al volver, la pasada es completa");
  assert.equal(llamadas.some((l) => l.op === "$queryRaw" && String(l.args).includes("clinic_google_status")), false, "no depende de ws1-t12");
});

test("G3: conexión CAÍDA (Google la rechazó, se guarda el token) desde hace más de un día → se retiran; con 23 h, todavía no", async () => {
  reiniciar();
  clinica("c1", { googleCalendarEnabled: false });
  bandera("c1", { lastSyncAt: hace(23) });
  bloqueo("b1", "c1");
  assert.equal((await correrCron()).retirados, 0);
  assert.equal(db.bloques[0].deletedAt, null);
  db.imports.get("c1")!.lastSyncAt = hace(25);
  assert.equal((await correrCron()).retirados, 1);
});

test("G3: Google DESCONECTADO a propósito → se retiran ya y no se intenta sincronizar", async () => {
  reiniciar();
  clinica("c1", { googleRefreshToken: null, googleCalendarEnabled: false });
  bandera("c1");
  bloqueo("b1", "c1");
  const r = await correrCron();
  assert.equal(r.retirados, 1);
  assert.equal(r.sincronizadas + r.fallidas, 0);
});

test("G3: «parcial» con la conexión activa y reciente no retira; con la conexión CAÍDA sí (nadie reescribe «parcial»); la bandera apagada también", async () => {
  reiniciar();
  const { bloqueosDeGoogleSinMantener } = await servidor();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(48), lastError: "parcial" });
  assert.deepEqual(await bloqueosDeGoogleSinMantener("c1"), { retirar: false, desconectada: false });
  db.imports.get("c1")!.lastSyncAt = hace(73);
  assert.deepEqual(await bloqueosDeGoogleSinMantener("c1"), { retirar: true, desconectada: false }, "una completa que nunca cabe tampoco se queda para siempre");
  // Caída + «parcial» de antes de caer: el cron los retira.
  reiniciar();
  clinica("c1", { googleCalendarEnabled: false });
  bandera("c1", { lastSyncAt: hace(25), lastError: "parcial" });
  bloqueo("b1", "c1");
  clinica("c2");
  bandera("c2", { enabled: false });
  bloqueo("b2", "c2");
  const r = await correrCron();
  assert.equal(r.retirados, 2);
  assert.ok(db.bloques.every((b) => b.deletedAt));
});

test("N-G3: sobre un calendario que la entrada no lee (personal) no se crea canal de avisos", async () => {
  reiniciar();
  clinica("c1", { googleClinicCalendarId: "primary" });
  bandera("c1");
  const { asegurarCanalDeAvisos } = await servidor();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.dalecontrol.mx";
  assert.equal(await asegurarCanalDeAvisos("c1"), "calendario_no_valido");
  assert.equal(db.imports.get("c1")!.channelId, null);
});

/* ═══ N-G8: retirarNoVistos por páginas ════════════════════════════════════ */

test("N-G8: la completa revisa TODOS los bloqueos (más de 2000), por páginas y en orden; solo los de dentro del rango", async () => {
  reiniciar();
  const { _puertosEntrante } = await servidor();
  for (let i = 0; i < 2600; i++) {
    const id = `b${String(i).padStart(5, "0")}`;
    bloqueo(id, "c1");
    db.vinculos.push({ blockId: id, clinicId: "c1", googleEventId: `e${i}`, appointmentId: null, eventDeletedAt: null });
  }
  // Uno de otra clínica y uno más allá del horizonte: no se tocan.
  bloqueo("ajeno", "c2");
  db.vinculos.push({ blockId: "ajeno", clinicId: "c2", googleEventId: "x", appointmentId: null });
  bloqueo("lejos", "c1", { startsAt: new Date(AHORA.getTime() + 500 * 86_400_000), endsAt: new Date(AHORA.getTime() + 501 * 86_400_000) });
  db.vinculos.push({ blockId: "lejos", clinicId: "c1", googleEventId: "lejos", appointmentId: null });
  const vistos = new Set(Array.from({ length: 2600 }, (_, i) => `e${i}`).filter((_, i) => i % 2 === 0));
  const n = await _puertosEntrante.retirarNoVistos("c1", vistos, hace(24), new Date(AHORA.getTime() + 400 * 86_400_000), AHORA);
  assert.equal(n, 1300);
  assert.equal(db.bloques.filter((b) => b.clinicId === "c1" && b.deletedAt).length, 1300);
  assert.equal(db.bloques.find((b) => b.id === "b02599")!.deletedAt instanceof Date, true, "el último también");
  assert.equal(db.bloques.find((b) => b.id === "ajeno")!.deletedAt, null);
  assert.equal(db.bloques.find((b) => b.id === "lejos")!.deletedAt, null);
  const paginas = llamadas.filter((l) => l.op === "agendaBlock.findMany");
  assert.ok(paginas.length >= 3 && paginas.every((l) => l.args.take === 1000 && l.args.orderBy?.id === "asc"));
});

/* ═══ N-G2: lo que la entrada sabe del equipo ═════════════════════════════ */

test("N-G2: el equipo llega con el Gmail con el que cada quien conectó Google, su rol y su nombre", async () => {
  reiniciar();
  db.usuarios.push(
    { id: "u1", clinicId: "c1", email: "ana@clinica.mx", googleCalendarEmail: "ana.personal@gmail.com", firstName: "Ana", lastName: "López", role: "DOCTOR", isActive: true, agendaActive: true },
    { id: "u2", clinicId: "c1", email: "eva@clinica.mx", googleCalendarEmail: null, firstName: "Eva", lastName: "Soto", role: "RECEPTIONIST", isActive: true, agendaActive: true },
    { id: "u3", clinicId: "c2", email: "otra@clinica.mx", role: "DOCTOR", isActive: true },
  );
  const { _puertosEntrante } = await servidor();
  const us = await _puertosEntrante.leerUsuarios("c1");
  assert.deepEqual(us.map((u) => u.id), ["u1", "u2"], "solo la clínica de la sesión");
  assert.deepEqual(us[0], { id: "u1", email: "ana@clinica.mx", otrosCorreos: ["ana.personal@gmail.com"], recibeCitas: true, rol: "DOCTOR", nombre: "Ana López", activo: true });
  assert.equal(us[1].recibeCitas, false);
});

test("N-G2: el Gmail con el que se conectó la CLÍNICA no es «otro correo» de quien lo conectó (el dueño que atiende)", async () => {
  reiniciar();
  clinica("c1", { googleCalendarEmail: "Clinica.Salamanca@gmail.com" });
  db.usuarios.push(
    { id: "u1", clinicId: "c1", email: "dueno@clinica.mx", googleCalendarEmail: "clinica.salamanca@gmail.com", firstName: "Juan", lastName: "Paz", role: "SUPER_ADMIN", isActive: true, agendaActive: true },
    { id: "u2", clinicId: "c1", email: "vieja@clinica.mx", googleCalendarEmail: null, firstName: "Ana", lastName: "López", role: "DOCTOR", isActive: false, agendaActive: true },
  );
  const { _puertosEntrante } = await servidor();
  const us = await _puertosEntrante.leerUsuarios("c1");
  assert.deepEqual(us[0].otrosCorreos, []);
  assert.equal(us[1].activo, false);
});

/* ═══ N-G9 / N-G10: el vínculo para la salida ═════════════════════════════ */

function convertida(x: Fila = {}) {
  db.vinculos.push({
    blockId: "b1", clinicId: "c1", googleEventId: "ev1", appointmentId: "a1", title: "Valoración",
    eventStartsAt: new Date("2026-10-21T16:00:00Z"), eventEndsAt: new Date("2026-10-21T17:00:00Z"), eventDeletedAt: null,
    avisoTipo: null, avisoStartsAt: null, avisoEndsAt: null, avisoDescartadoAt: null, salidaFirma: null,
    convertedAt: hace(5), ...x,
  });
}
const CITA = { id: "a1", status: "SCHEDULED", startsAt: new Date("2026-10-21T17:00:00Z"), endsAt: new Date("2026-10-21T18:00:00Z") };

test("N-G9: con la bandera encendida y el calendario propio, la salida recibe la «última vista»; apagada o con otro calendario, no (manda DaleControl)", async () => {
  const { vinculoParaSalida } = await convertir();
  reiniciar();
  clinica("c1");
  bandera("c1");
  convertida();
  const v = await vinculoParaSalida("c1", CITA, "ev1");
  assert.equal(v?.eventoVisto?.startsAt.toISOString(), "2026-10-21T16:00:00.000Z");
  db.imports.get("c1")!.enabled = false;
  assert.deepEqual(await vinculoParaSalida("c1", CITA, "ev1"), { tituloOriginal: "Valoración", avisoPendiente: false });
  db.imports.get("c1")!.enabled = true;
  db.clinics.get("c1")!.googleClinicCalendarId = "primary";
  convertida({ blockId: "b2", appointmentId: "a1", googleEventId: "ev1" });
  db.vinculos[0].avisoTipo = "movido";
  db.vinculos[0].avisoStartsAt = new Date("2026-10-21T19:00:00Z");
  db.vinculos[0].avisoEndsAt = new Date("2026-10-21T20:00:00Z");
  const sinEntrada = await vinculoParaSalida("c1", CITA, "ev1");
  assert.equal(sinEntrada?.avisoPendiente, false, "nadie lo resolvería: no frena la salida");
  assert.equal(sinEntrada?.eventoVisto, undefined);
});

test("N-G10: limpiar el «movido» ya resuelto solo borra ESE aviso (sus horas), no uno nuevo guardado a la vez", async () => {
  const { vinculoParaSalida } = await convertir();
  reiniciar();
  clinica("c1");
  bandera("c1");
  convertida({ avisoTipo: "movido", avisoStartsAt: CITA.startsAt, avisoEndsAt: CITA.endsAt });
  const v = await vinculoParaSalida("c1", CITA, "ev1");
  assert.equal(v?.avisoPendiente, false);
  const limpieza = llamadas.find((l) => l.op === "agendaBlockGoogle.updateMany")!;
  assert.equal(limpieza.args.where.avisoStartsAt.getTime(), CITA.startsAt.getTime());
  assert.equal(limpieza.args.where.avisoEndsAt.getTime(), CITA.endsAt.getTime());
  assert.equal(db.vinculos[0].avisoTipo, null);
  // La carrera: la entrada guardó un «movido» NUEVO (otra hora) entre la lectura y la limpieza.
  reiniciar();
  clinica("c1");
  bandera("c1");
  convertida({ avisoTipo: "movido", avisoStartsAt: CITA.startsAt, avisoEndsAt: CITA.endsAt });
  const original = prisma.agendaBlockGoogle.updateMany;
  prisma.agendaBlockGoogle.updateMany = async (a: Fila) => {
    Object.assign(db.vinculos[0], { avisoStartsAt: new Date("2026-10-21T20:00:00Z"), avisoEndsAt: new Date("2026-10-21T21:00:00Z") });
    return original(a);
  };
  try {
    await vinculoParaSalida("c1", CITA, "ev1");
  } finally {
    prisma.agendaBlockGoogle.updateMany = original;
  }
  assert.equal(db.vinculos[0].avisoTipo, "movido", "el aviso nuevo se queda para que alguien lo vea");
});

/* ═══ N-G1 / N-G12: lo que deja la salida y el reintento del cron ═════════ */

test("N-G1: la salida guarda la hora que dejó en Google SOLO si la entrada no vio otra mientras; la firma siempre", async () => {
  const { guardarSalidaConvertida } = await convertir();
  reiniciar();
  convertida();
  const antes = { startsAt: new Date("2026-10-21T16:00:00Z"), endsAt: new Date("2026-10-21T17:00:00Z") };
  await guardarSalidaConvertida("c1", "a1", "ev1", { firma: "F1", visto: { startsAt: CITA.startsAt, endsAt: CITA.endsAt, antes } });
  assert.equal(db.vinculos[0].eventStartsAt.getTime(), CITA.startsAt.getTime());
  assert.equal(db.vinculos[0].salidaFirma, "F1");
  // Ahora la «última vista» ya no es `antes`: no se pisa.
  await guardarSalidaConvertida("c1", "a1", "ev1", { firma: "F2", visto: { startsAt: new Date("2026-10-22T00:00:00Z"), endsAt: new Date("2026-10-22T01:00:00Z"), antes } });
  assert.equal(db.vinculos[0].eventStartsAt.getTime(), CITA.startsAt.getTime());
  assert.equal(db.vinculos[0].salidaFirma, "F2");
  // Otra clínica con los mismos ids no se toca.
  db.vinculos.push({ ...db.vinculos[0], blockId: "z", clinicId: "c2", salidaFirma: null });
  await guardarSalidaConvertida("c1", "a1", "ev1", { firma: "F3" });
  assert.equal(db.vinculos.find((v) => v.clinicId === "c2")!.salidaFirma, null);
});

test("N-G12: el cron reintenta las convertidas cuya copia no llegó (firma distinta de la cita), y solo esas", async () => {
  const { convertidasPorReintentar, reintentarSalidaDeConvertidas } = await convertir();
  const { firmaSalidaConvertida } = await import("@/lib/agenda/google-sync-nucleo");
  reiniciar();
  const cita = (id: string, x: Fila = {}) =>
    db.citas.push({ id, clinicId: "c1", status: "CANCELLED", startsAt: hace(-48), endsAt: hace(-47), googleCalendarEventId: `ev-${id}`, ...x });
  // a1: cancelada y la copia no llegó (firma vieja de cuando estaba activa).
  cita("a1");
  convertida({ blockId: "b1", appointmentId: "a1", googleEventId: "ev-a1", salidaFirma: firmaSalidaConvertida({ ...(db.citas[0] as { status: string; startsAt: Date; endsAt: Date }), status: "SCHEDULED" }) });
  // a2: al día.
  cita("a2");
  convertida({ blockId: "b2", appointmentId: "a2", googleEventId: "ev-a2", salidaFirma: firmaSalidaConvertida(db.citas[1] as { status: string; startsAt: Date; endsAt: Date }) });
  // a3: ya ligada a OTRO evento (se recreó): no es asunto del vínculo.
  cita("a3", { googleCalendarEventId: "dcotro" });
  convertida({ blockId: "b3", appointmentId: "a3", googleEventId: "ev-a3", salidaFirma: null });
  // a4: terminó hace días.
  cita("a4", { startsAt: hace(80), endsAt: hace(79) });
  convertida({ blockId: "b4", appointmentId: "a4", googleEventId: "ev-a4", salidaFirma: null });
  // a5: de otra clínica.
  db.citas.push({ id: "a5", clinicId: "c2", status: "CANCELLED", startsAt: hace(-48), endsAt: hace(-47), googleCalendarEventId: "ev-a5" });
  db.vinculos.push({ blockId: "b5", clinicId: "c2", appointmentId: "a5", googleEventId: "ev-a5", salidaFirma: null, convertedAt: hace(1) });
  // a6: con un aviso sin decidir (la hora no se copia a propósito): no se reintenta.
  cita("a6", { status: "SCHEDULED" });
  convertida({ blockId: "b6", appointmentId: "a6", googleEventId: "ev-a6", salidaFirma: null, avisoTipo: "movido", avisoDescartadoAt: null });
  assert.deepEqual(await convertidasPorReintentar("c1"), ["a1"]);
  // Pero si la cita ya está CANCELADA, el aviso no se enseña y el «Cancelada en DaleControl» sí debe llegar.
  db.citas.find((c) => c.id === "a6")!.status = "CANCELLED";
  assert.deepEqual((await convertidasPorReintentar("c1")).sort(), ["a1", "a6"]);
  db.citas.find((c) => c.id === "a6")!.status = "SCHEDULED";
  const hechas: string[] = [];
  assert.equal(await reintentarSalidaDeConvertidas("c1", async (_c, id) => { hechas.push(id); }), 1);
  assert.deepEqual(hechas, ["a1"]);
  // «Mantener la cita» borra la firma: si su copia falla, el cron la repite.
  const { descartarAvisoDeCitaGoogle } = await convertir();
  db.vinculos[1].avisoTipo = "eliminado";
  db.vinculos[1].avisoDescartadoAt = null;
  assert.equal(await descartarAvisoDeCitaGoogle("c1", "a2"), true);
  assert.equal(db.vinculos[1].salidaFirma, null);
});

test("N-G12: el reintento respeta el tiempo del cron, y el cron también repasa las convertidas de una clínica SIN la bandera", async () => {
  const { reintentarSalidaDeConvertidas } = await convertir();
  reiniciar();
  for (const id of ["a1", "a2", "a3"]) {
    db.citas.push({ id, clinicId: "c1", status: "CANCELLED", startsAt: hace(-48), endsAt: hace(-47), googleCalendarEventId: `ev-${id}` });
    convertida({ blockId: `b-${id}`, appointmentId: id, googleEventId: `ev-${id}`, salidaFirma: null });
  }
  let n = 0;
  const limite = Date.now() + 50;
  const hechas = await reintentarSalidaDeConvertidas("c1", async () => { n++; await new Promise((r) => setTimeout(r, 60)); }, limite);
  assert.equal(hechas, 1);
  assert.equal(n, 1);
  // Bandera apagada: el cron igual la intenta (aquí Google está desconectado, así que la salida la omite).
  reiniciar();
  clinica("c3", { googleCalendarEnabled: false, googleRefreshToken: null });
  bandera("c3", { enabled: false });
  db.citas.push({ id: "a9", clinicId: "c3", status: "CANCELLED", startsAt: hace(-48), endsAt: hace(-47), googleCalendarEventId: "ev-a9" });
  db.vinculos.push({ blockId: "b9", clinicId: "c3", appointmentId: "a9", googleEventId: "ev-a9", salidaFirma: null, convertedAt: hace(1), avisoTipo: null });
  const r = await correrCron();
  assert.equal(r.reintentadas, 1);
  assert.ok(
    llamadas.some((l) => l.op === "clinic.findUnique" && l.args.where.id === "c3" && l.args.select?.googleRefreshToken),
    "pasó por la salida de esa cita (que lee la conexión de SU clínica)",
  );
});

/* ═══ Tercera vuelta: N3-G1 (el cron sincroniza primero) ═══════════════════ */


test("N3-G1: Google SANO y el cron un día sin correr (última buena hace 30 h) → sincroniza primero y NO retira nada; lo que no cambió sigue cerrando", async () => {
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), equipoFirma: firmaEquipo([]) });
  deGoogle("b1", "e1");
  deGoogle("b2", "e2");
  const g = await conGoogle(async () => ({ data: { items: [], nextSyncToken: "tok2" } }));
  try {
    const { bloqueosDeGoogleSinMantener } = await servidor();
    assert.equal((await bloqueosDeGoogleSinMantener("c1")).retirar, true, "con la regla de antes, este cron retiraba todo primero");
    const r = await correrCron();
    assert.equal(r.sincronizadas, 1);
    assert.equal(r.retirados, 0);
    assert.deepEqual(activos(), ["b1", "b2"]);
    assert.equal(g.pedidas[0].syncToken, "tok", "incremental, con el token de siempre");
    const f = db.imports.get("c1")!;
    assert.equal(f.syncToken, "tok2");
    assert.ok(f.lastSyncAt.getTime() > hace(1).getTime(), "la pasada buena queda anotada");
    assert.equal(f.leaseUntil, null, "el turno se suelta");
  } finally {
    g.restaurar();
  }
});

test("N3-G1: Google SANO y toca la completa → retira SOLO lo que ya no existe en Google", async () => {
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(24 * 8), equipoFirma: firmaEquipo([]) });
  const b1 = deGoogle("b1", "e1");
  deGoogle("b2", "e2"); // borrado en Google
  const g = await conGoogle(async () => ({ data: { items: [enGoogle("e1", b1)], nextSyncToken: "tok2" } }));
  try {
    const r = await correrCron();
    assert.equal(r.sincronizadas, 1);
    assert.equal(r.retirados, 0, "el cron no retiró en bloque");
    assert.ok(g.pedidas[0].timeMin && !g.pedidas[0].syncToken, "completa");
    assert.deepEqual(activos(), ["b1"]);
    assert.equal(db.bloques.length, 2, "retirado (deletedAt), no borrado");
  } finally {
    g.restaurar();
  }
});

test("N3-G1: Google FALLA un día y otra pasada toma el turno justo entonces → este cron no retira (antes: retiraba y la otra guardaba su token encima); el siguiente sí, con el turno", async () => {
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), lastError: "google", equipoFirma: firmaEquipo([]) });
  deGoogle("b1", "e1");
  deGoogle("b2", "e2");
  const g = await conGoogle(async () => { throw { response: { status: 500 } }; });
  try {
    // Un aviso de Google (o abrir la agenda) toma el turno en cuanto esta pasada lo suelta.
    trasSoltar.push(() => { db.imports.get("c1")!.leaseUntil = new Date(Date.now() + 60_000); });
    const r1 = await correrCron();
    assert.equal(r1.fallidas, 1);
    assert.equal(r1.retirados, 0, "con una pasada en curso no se retira");
    assert.deepEqual(activos(), ["b1", "b2"]);
    assert.equal(db.imports.get("c1")!.syncToken, "tok");

    // La otra pasada terminó (soltó el turno); Google sigue fallando.
    db.imports.get("c1")!.leaseUntil = null;
    const r2 = await correrCron();
    assert.equal(r2.retirados, 2);
    assert.deepEqual(activos(), []);
    const f = db.imports.get("c1")!;
    assert.equal(f.syncToken, null);
    assert.equal(f.lastFullSyncAt, null, "la siguiente pasada será completa aunque alguien guarde un token");
    assert.equal(f.leaseUntil, null, "el retiro suelta el turno");
    assert.ok(llamadas.some((l) => l.op === "googleAgendaImport.updateMany" && l.args.data?.leaseUntil instanceof Date), "el retiro tomó el turno");
  } finally {
    g.restaurar();
  }
});

test("N3-G1: tras el retiro, una pasada tardía guarda SU token… y aun así la siguiente es COMPLETA y vuelve a cerrar lo que sigue ocupado", async () => {
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastError: "google", equipoFirma: firmaEquipo([]) });
  const b1 = deGoogle("b1", "e1");
  deGoogle("b2", "e2");
  const { retirarBloqueosDeGoogle } = await servidor();
  assert.equal(await retirarBloqueosDeGoogle("c1", { conTurno: true }), 2);
  // La pasada incremental que corría a la vez guarda su token (no toca lastFullSyncAt).
  Object.assign(db.imports.get("c1")!, { syncToken: "tarde", lastSyncAt: hace(0.01), lastError: null });
  const g = await conGoogle(async () => ({ data: { items: [enGoogle("e1", b1)], nextSyncToken: "tok3" } }));
  try {
    const r = await correrCron();
    assert.equal(r.sincronizadas, 1);
    assert.ok(g.pedidas[0].timeMin && !g.pedidas[0].syncToken, "completa, no incremental con el token tardío");
    assert.deepEqual(activos(), ["b1"], "e1 sigue ocupado en Google: vuelve a cerrar; e2 ya no existe");
    assert.ok(db.imports.get("c1")!.lastFullSyncAt instanceof Date);
  } finally {
    g.restaurar();
  }
});

test("N3-G1: un 5xx SUELTO en la primera pasada tras un día sin cron (la anterior había salido bien) no retira; si sigue fallando en la siguiente, sí", async () => {
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), lastError: null, equipoFirma: firmaEquipo([]) });
  deGoogle("b1", "e1");
  const g = await conGoogle(async () => { throw { response: { status: 503 } }; });
  try {
    const r1 = await correrCron();
    assert.equal(r1.fallidas, 1);
    assert.equal(r1.retirados, 0, "un fallo suelto no retira todo de golpe");
    assert.deepEqual(activos(), ["b1"]);
    assert.equal(db.imports.get("c1")!.lastError, "google");
    const r2 = await correrCron();
    assert.equal(r2.retirados, 1, "falla seguido: se retira");
  } finally {
    g.restaurar();
  }
});

test("N3-G1: la regla se vuelve a mirar YA con el turno: si otra pasada acaba de salir bien, no se retira lo que puso al día", async () => {
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), lastError: "google", equipoFirma: firmaEquipo([]) });
  deGoogle("b1", "e1");
  const g = await conGoogle(async () => { throw { response: { status: 500 } }; });
  try {
    // 1.º turno: la pasada del cron (falla). 2.º: el retiro; justo antes, otra pasada terminó bien.
    antesDeTomarTurno.push(null, () => Object.assign(db.imports.get("c1")!, { lastSyncAt: new Date(), lastError: null }));
    const r = await correrCron();
    assert.equal(r.retirados, 0);
    assert.deepEqual(activos(), ["b1"]);
    assert.equal(db.imports.get("c1")!.syncToken, "tok", "ni se tocó el token");
    assert.equal(db.imports.get("c1")!.leaseUntil, null, "y el turno se soltó");
  } finally {
    g.restaurar();
  }
});

/* ═══ Tercera vuelta: N3-G2 (el aviso en el panel) ════════════════════════ */

test("N3-G2: el aviso sale cuando el cron RETIRA de verdad (no antes), con la fecha real y la zona de la clínica; se va cuando la completa repone", async () => {
  const { estadoEntranteParaPantalla } = await servidor();
  reiniciar();
  clinica("c1", { timezone: "America/Tijuana" });
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), lastError: "google", equipoFirma: firmaEquipo([]) });
  const b1 = deGoogle("b1", "e1");
  deGoogle("b2", "e2");
  // Un evento borrado en Google ANTES de la última pasada buena: no es un retiro.
  bloqueo("viejo", "c1", { deletedAt: hace(31) });
  assert.equal((await estadoEntranteParaPantalla("c1")).retiro, null, "regla cumplida, pero el cron aún no retiró: todavía cierran");

  let google: "falla" | "parcial" | "sana" = "falla";
  const g = await conGoogle(async () => {
    if (google === "falla") throw { response: { status: 500 } };
    if (google === "parcial") return { data: { items: [], nextPageToken: "sigue" } }; // nunca termina: 40 páginas → «parcial»
    return { data: { items: [enGoogle("e1", b1)], nextSyncToken: "tok9" } };
  });
  try {
    const antes = Date.now();
    assert.equal((await correrCron()).retirados, 2);
    const e1 = await estadoEntranteParaPantalla("c1");
    assert.equal(e1.retiro?.causa, "google");
    assert.equal(e1.retiro?.zona, "America/Tijuana");
    assert.ok(Date.parse(e1.retiro!.desde) >= antes, "la fecha es la del retiro (ahora), no la del plazo (hace 6 h)");

    // Google vuelve, pero la completa no cabe: «parcial». Antes: el cron volvía a retirar cada 5 min.
    google = "parcial";
    const r2 = await correrCron();
    assert.equal(r2.retirados, 0, "lo repuesto no se deshace");
    assert.equal(db.imports.get("c1")!.lastError, "parcial");
    assert.equal((await estadoEntranteParaPantalla("c1")).retiro?.causa, "reponiendo", "el aviso sigue mientras falta reponer");

    // La completa termina: e1 vuelve a cerrar, e2 ya no existe, y el aviso se va.
    google = "sana";
    assert.equal((await correrCron()).sincronizadas, 1);
    assert.deepEqual(activos(), ["b1"]);
    assert.equal((await estadoEntranteParaPantalla("c1")).retiro, null);
  } finally {
    g.restaurar();
  }
});

test("N3-G2: las causas, contra la base (sin calendario elegido no es «error de Google»; caída; desconectada)", async () => {
  const { estadoEntranteParaPantalla, retirarBloqueosDeGoogle } = await servidor();
  const caso = async (c: Fila, b: Fila) => {
    reiniciar();
    clinica("c1", c);
    bandera("c1", b);
    deGoogle("b1", "e1");
    await retirarBloqueosDeGoogle("c1");
    return (await estadoEntranteParaPantalla("c1")).retiro?.causa ?? null;
  };
  assert.equal(await caso({ googleClinicCalendarId: null }, { lastSyncAt: hace(30) }), "calendario");
  assert.equal(await caso({ googleCalendarEnabled: false }, { lastSyncAt: hace(30), lastError: "autorizacion" }), "conexion");
  assert.equal(await caso({ googleRefreshToken: null, googleCalendarEnabled: false }, { lastSyncAt: hace(30) }), "desconectada");
  assert.equal(await caso({}, { lastSyncAt: hace(30), lastError: "permisos" }), "permisos");
  assert.equal(await caso({}, { lastSyncAt: hace(30), lastError: "google", enabled: false }), null, "sin la bandera, nada");
});

/* ═══ Cuarta vuelta: N4-G2 (el retiro, en una sola transacción) ════════════ */

test("N4-G2: un corte del pooler en CUALQUIERA de las dos sentencias del retiro no deja bloqueos retirados con el token viejo (antes: retirados y la siguiente pasada incremental)", async () => {
  const { retirarBloqueosDeGoogle } = await servidor();
  for (const corte of ["googleAgendaImport.updateMany", "agendaBlock.updateMany"]) {
    reiniciar();
    clinica("c1");
    bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), lastError: "google", equipoFirma: firmaEquipo([]) });
    deGoogle("b1", "e1");
    deGoogle("b2", "e2");
    cortes.push(corte);
    await assert.rejects(retirarBloqueosDeGoogle("c1"), /corte del pooler/);
    assert.deepEqual(activos(), ["b1", "b2"], `corte en ${corte}: nada retirado`);
    assert.equal(db.imports.get("c1")!.syncToken, "tok", `corte en ${corte}: el token tampoco se tocó`);
  }
  // Sin corte: las dos, dentro de la transacción y el token primero.
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), lastError: "google" });
  deGoogle("b1", "e1");
  assert.equal(await retirarBloqueosDeGoogle("c1"), 1);
  const escrituras = llamadas.filter((l) => l.op === "agendaBlock.updateMany" || l.op === "googleAgendaImport.updateMany");
  assert.deepEqual(escrituras.map((l) => [l.op, l.tx]), [["googleAgendaImport.updateMany", true], ["agendaBlock.updateMany", true]]);
  assert.deepEqual(activos(), []);
  assert.equal(db.imports.get("c1")!.syncToken, null);
});

test("N4-G2: con el cron: el corte se cuenta como fallo, el turno se suelta, y la siguiente corrida retira entero", async () => {
  reiniciar();
  clinica("c1");
  bandera("c1", { lastSyncAt: hace(30), lastFullSyncAt: hace(30), lastError: "google", equipoFirma: firmaEquipo([]) });
  deGoogle("b1", "e1");
  const g = await conGoogle(async () => { throw { response: { status: 500 } }; });
  try {
    cortes.push("agendaBlock.updateMany");
    const r1 = await correrCron();
    assert.equal(r1.retirados, 0);
    assert.equal(r1.fallidas, 2, "la pasada de Google y el retiro cortado");
    assert.deepEqual(activos(), ["b1"]);
    assert.equal(db.imports.get("c1")!.syncToken, "tok");
    assert.equal(db.imports.get("c1")!.leaseUntil, null, "el turno no se queda tomado");
    const r2 = await correrCron();
    assert.equal(r2.retirados, 1);
    assert.equal(db.imports.get("c1")!.syncToken, null);
    assert.equal(db.imports.get("c1")!.lastFullSyncAt, null);
  } finally {
    g.restaurar();
  }
});

