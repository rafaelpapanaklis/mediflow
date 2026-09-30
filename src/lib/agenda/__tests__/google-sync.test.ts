import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sincronizarCita,
  sincronizarFuturas,
  type CitaParaGoogle,
  type ClinicaGoogle,
  type PuertosEnBloque,
} from "../google-sync-nucleo";
import { idEventoDeCita, marcaCalendarioDeClinica } from "../../google-calendar";
import { armarContenidoEventoGoogle } from "../../google-calendar-contenido";
import { esErrorDeAutorizacionGoogle } from "../../google-calendar-estado";
import { GoogleFalsa, errorGoogle, errorInvalidGrant } from "./google-falsa";

// ── Mundo falso: base + Google ────────────────────────────────────────────────

const C1 = "clinica-1";
const C2 = "clinica-2";
const ZONA = "America/Mexico_City";

function clinica(id: string, extra: Partial<ClinicaGoogle> = {}): ClinicaGoogle {
  return {
    id, name: `Clínica ${id}`, address: "Calle 1", timezone: ZONA, enabled: true,
    accessToken: "at-viejo", refreshToken: `rt-${id}`, calendarId: null, ...extra,
  };
}

function cita(id: string, extra: Partial<CitaParaGoogle> = {}): CitaParaGoogle {
  return {
    id, type: "Limpieza", status: "SCHEDULED",
    startsAt: new Date("2026-10-15T16:00:00Z"), endsAt: new Date("2026-10-15T16:30:00Z"),
    googleEventId: null, patientName: "Ana García López", doctorName: "Luis Ruiz",
    doctorEmail: "doc@clinica.mx", patientEmail: "ana@correo.mx", ...extra,
  };
}

interface Mundo {
  puertos: PuertosEnBloque;
  google: GoogleFalsa;
  clinicas: Map<string, ClinicaGoogle>;
  citas: Map<string, CitaParaGoogle & { clinicId: string }>;
  caidas: { clinicId: string; motivo: string }[];
  tokensGuardados: { clinicId: string; refresh: string; token: string }[];
  ajustes: { invitarPaciente: boolean; caidoDesde: Date | null };
  /** Falla `guardarEventoId` (para simular que la base cae justo después de crear el evento). */
  fallaGuardarId: { quedan: number };
}

function mundo(opts: { clinicas?: ClinicaGoogle[]; citas?: (CitaParaGoogle & { clinicId: string })[] } = {}): Mundo {
  const google = new GoogleFalsa();
  const clinicas = new Map((opts.clinicas ?? [clinica(C1)]).map((c) => [c.id, c]));
  const citas = new Map((opts.citas ?? []).map((c) => [c.id, c]));
  const caidas: Mundo["caidas"] = [];
  const tokensGuardados: Mundo["tokensGuardados"] = [];
  const ajustes = { invitarPaciente: true, caidoDesde: null as Date | null };
  const fallaGuardarId = { quedan: 0 };

  const puertos: PuertosEnBloque = {
    leerClinica: async (id) => (clinicas.has(id) ? { ...clinicas.get(id)! } : null),
    leerAjustes: async () => ({ ...ajustes }),
    guardarAccessToken: async (clinicId, refresh, token) => {
      tokensGuardados.push({ clinicId, refresh, token });
      const c = clinicas.get(clinicId);
      if (c && c.refreshToken === refresh) c.accessToken = token;
    },
    // Igual que la de verdad: condicional al valor que se leyó.
    fijarCalendarioId: async (clinicId, calId, esperado) => {
      const c = clinicas.get(clinicId)!;
      if (c.calendarId === esperado) { c.calendarId = calId; return calId; }
      return c.calendarId ?? calId;
    },
    // Multi-tenant: una cita de otra clínica NO se ve.
    leerCita: async (clinicId, id) => {
      const c = citas.get(id);
      return c && c.clinicId === clinicId ? { ...c } : null;
    },
    guardarEventoId: async (clinicId, id, eventId) => {
      if (fallaGuardarId.quedan > 0) { fallaGuardarId.quedan--; throw new Error("base caída"); }
      const c = citas.get(id);
      if (c && c.clinicId === clinicId) c.googleEventId = eventId;
    },
    abrirCalendar: () => google,
    armarContenido: armarContenidoEventoGoogle,
    esErrorDeAutorizacion: esErrorDeAutorizacionGoogle,
    marcarCaido: async (clinicId, motivo) => {
      caidas.push({ clinicId, motivo });
      const c = clinicas.get(clinicId);
      if (c) c.enabled = false; // como la de verdad: apaga el sync y conserva los tokens
    },
    log: () => undefined,
    ahora: () => new Date("2026-10-01T00:00:00Z"),
    listarFuturasSinEvento: async (clinicId, _d, tope) =>
      [...citas.values()]
        .filter((c) => c.clinicId === clinicId && !["CANCELLED", "NO_SHOW"].includes(c.status) && !c.googleEventId)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, tope).map((c) => c.id),
    contarFuturasSinEvento: async (clinicId) =>
      [...citas.values()].filter((c) => c.clinicId === clinicId && !["CANCELLED", "NO_SHOW"].includes(c.status) && !c.googleEventId).length,
    contarFuturasConEvento: async (clinicId) =>
      [...citas.values()].filter((c) => c.clinicId === clinicId && !["CANCELLED", "NO_SHOW"].includes(c.status) && !!c.googleEventId).length,
  };
  return { puertos, google, clinicas, citas, caidas, tokensGuardados, ajustes, fallaGuardarId };
}

const conCita = (id: string, extra: Partial<CitaParaGoogle> = {}, clinicId = C1) => ({ ...cita(id, extra), clinicId });

// ── Crear ────────────────────────────────────────────────────────────────────

test("cita nueva: crea el calendario de la clínica (marcado con su id) y el evento con id determinista", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.deepEqual(r, { estado: "creado" });

  const calId = w.clinicas.get(C1)!.calendarId!;
  assert.ok(calId, "guarda el id del calendario en la clínica");
  assert.ok(w.google.calendarios.get(calId)!.description.includes(marcaCalendarioDeClinica(C1)));
  assert.equal(w.google.calendarios.get(calId)!.timeZone, ZONA);

  const eventId = idEventoDeCita(C1, "a1");
  assert.match(eventId, /^[a-v0-9]{5,1024}$/, "base32hex: lo único que Google acepta como id propio");
  assert.equal(w.citas.get("a1")!.googleEventId, eventId);
  const ev = w.google.eventoEn(calId, eventId)!;
  assert.equal(ev.start.dateTime, "2026-10-15T10:00:00-06:00", "hora de la clínica (México, sin horario de verano)");
  assert.equal(ev.start.timeZone, ZONA);
  assert.deepEqual(ev.attendees.map((a: any) => a.email), ["doc@clinica.mx", "ana@correo.mx"]);
  assert.deepEqual(ev.extendedProperties.private, { dalecontrolClinicId: C1, dalecontrolAppointmentId: "a1" });
  assert.ok(ev.reminders.overrides.length === 2);
  assert.equal(w.google.llamadas.find((l) => l.op === "events.insert")!.args.sendUpdates, "all", "con invitados, Google avisa");
});

test("lo que viaja sale del armador de contenido: sin notas y sin apellido completo en el título", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await sincronizarCita(w.puertos, C1, "a1");
  const ev = w.google.activos()[0];
  assert.ok(!/García López/.test(ev.summary), ev.summary);
  assert.ok(!/Notas:/i.test(ev.description));
});

test("con «no invitar al paciente» solo va el doctor", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.ajustes.invitarPaciente = false;
  await sincronizarCita(w.puertos, C1, "a1");
  assert.deepEqual(w.google.activos()[0].attendees.map((a: any) => a.email), ["doc@clinica.mx"]);
});

test("el segundo llamado no duplica: con el id ya guardado solo se pone al día", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await sincronizarCita(w.puertos, C1, "a1");
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(r.estado, "actualizado");
  assert.equal(w.google.activos().length, 1);
  assert.equal(w.google.cuantas("events.insert"), 1);
});

test("reintento tras caerse la base DESPUÉS de crear el evento: no duplica y se repone el id", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.fallaGuardarId.quedan = 1;
  const r1 = await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(r1.estado, "fallo");
  assert.equal(w.google.activos().length, 1, "el evento sí llegó a Google");
  assert.equal(w.citas.get("a1")!.googleEventId, null, "pero la cita no guardó su id");
  assert.equal(w.caidas.length, 0, "un fallo de base no marca la conexión como caída");

  const r2 = await sincronizarCita(w.puertos, C1, "a1"); // el reintento
  assert.equal(r2.estado, "creado");
  assert.equal(w.google.activos().length, 1, "sigue habiendo UN evento (Google contestó 409 y se reanudó)");
  assert.equal(w.citas.get("a1")!.googleEventId, idEventoDeCita(C1, "a1"));
});

test("dos sincronizaciones a la vez de la misma cita convergen en un solo evento", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await Promise.all([sincronizarCita(w.puertos, C1, "a1"), sincronizarCita(w.puertos, C1, "a1")]);
  assert.equal(w.google.activos().length, 1);
});

// ── Mover (#2) ───────────────────────────────────────────────────────────────

test("mover la cita usa events.patch: el evento conserva invitados y recordatorios", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await sincronizarCita(w.puertos, C1, "a1");
  const calId = w.clinicas.get(C1)!.calendarId!;
  const antes = structuredClone(w.google.eventoEn(calId, idEventoDeCita(C1, "a1"))!);

  const c = w.citas.get("a1")!;
  c.startsAt = new Date("2026-10-16T18:00:00Z");
  c.endsAt = new Date("2026-10-16T18:45:00Z");
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(r.estado, "actualizado");

  const ev = w.google.eventoEn(calId, idEventoDeCita(C1, "a1"))!;
  assert.equal(ev.start.dateTime, "2026-10-16T12:00:00-06:00");
  assert.equal(ev.end.dateTime, "2026-10-16T12:45:00-06:00");
  assert.deepEqual(ev.attendees, antes.attendees, "el paciente y el doctor siguen invitados");
  assert.deepEqual(ev.reminders, antes.reminders, "los recordatorios no vuelven a los de Google");
  assert.equal(w.google.updates, 0, "nadie llama a events.update (que reemplaza el evento entero)");

  const patch = w.google.llamadas.filter((l) => l.op === "events.patch").at(-1)!.args;
  assert.equal("attendees" in patch.requestBody, false, "el cuerpo del patch no toca attendees");
  assert.equal("reminders" in patch.requestBody, false, "ni reminders");
  assert.equal(patch.sendUpdates, "none", "mover no manda correos (Sabina lo dice así)");
});

test("si alguien borró el evento en Google, al mover la cita se vuelve a crear (el mismo id, sin duplicar)", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await sincronizarCita(w.puertos, C1, "a1");
  const calId = w.clinicas.get(C1)!.calendarId!;
  const k = `${calId}/${idEventoDeCita(C1, "a1")}`;

  // borrado «de verdad» (ya no existe ni como cancelado): patch da 404 → se crea de nuevo
  w.google.eventos.delete(k);
  assert.equal((await sincronizarCita(w.puertos, C1, "a1")).estado, "creado");
  assert.equal(w.google.activos().length, 1);

  // borrado a la manera de Google (queda `cancelled`): patch con status confirmed lo resucita
  await w.google.events.delete({ calendarId: calId, eventId: idEventoDeCita(C1, "a1") });
  assert.equal(w.google.activos().length, 0);
  assert.equal((await sincronizarCita(w.puertos, C1, "a1")).estado, "actualizado");
  assert.equal(w.google.activos().length, 1);
});

test("si borraron el calendario entero en Google, se busca/crea otro y se repite", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await sincronizarCita(w.puertos, C1, "a1");
  const calViejo = w.clinicas.get(C1)!.calendarId!;
  w.google.calendarios.delete(calViejo);
  w.google.eventos.clear();

  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(r.estado, "creado");
  const calNuevo = w.clinicas.get(C1)!.calendarId!;
  assert.notEqual(calNuevo, calViejo);
  assert.equal(w.google.activos(calNuevo).length, 1);
});

// ── Cancelar / no-show / reactivar (#1) ──────────────────────────────────────

test("cancelar borra el evento y limpia el id; no-asistió también", async () => {
  for (const estado of ["CANCELLED", "NO_SHOW"]) {
    const w = mundo({ citas: [conCita("a1")] });
    await sincronizarCita(w.puertos, C1, "a1");
    assert.equal(w.google.activos().length, 1);

    w.citas.get("a1")!.status = estado;
    const r = await sincronizarCita(w.puertos, C1, "a1");
    assert.equal(r.estado, "borrado", estado);
    assert.equal(w.google.activos().length, 0, estado);
    assert.equal(w.citas.get("a1")!.googleEventId, null, `${estado}: el id se limpia`);
    assert.equal(w.google.llamadas.find((l) => l.op === "events.delete")!.args.sendUpdates, "all", "el invitado recibe la cancelación");
  }
});

test("cancelar dos veces es inofensivo (Google ya no lo tiene: no es error)", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await sincronizarCita(w.puertos, C1, "a1");
  w.citas.get("a1")!.status = "CANCELLED";
  await sincronizarCita(w.puertos, C1, "a1");
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.ok(r.estado === "sin_cambios" || r.estado === "borrado", JSON.stringify(r));
  assert.equal(w.caidas.length, 0);
});

test("cancelar una cita SIN id guardado borra igual por el id determinista (alta en segundo plano a medias)", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.fallaGuardarId.quedan = 1;
  await sincronizarCita(w.puertos, C1, "a1"); // el evento existe en Google, la cita no lo sabe
  assert.equal(w.google.activos().length, 1);
  w.citas.get("a1")!.status = "CANCELLED";
  await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(w.google.activos().length, 0, "no queda un evento huérfano de una cita cancelada");
});

test("cancelar una cita que nunca estuvo en Google (creada antes de conectar) no rompe nada", async () => {
  const w = mundo({ clinicas: [clinica(C1, { calendarId: "primary-x" })], citas: [conCita("a1", { status: "CANCELLED" })] });
  w.google.sembrarCalendario("primary-x", "Clínica", marcaCalendarioDeClinica(C1));
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(r.estado, "sin_cambios");
  assert.equal(w.caidas.length, 0);
});

test("reactivar una cita cancelada vuelve a poner su evento, sin duplicar", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  await sincronizarCita(w.puertos, C1, "a1");
  w.citas.get("a1")!.status = "CANCELLED";
  await sincronizarCita(w.puertos, C1, "a1");
  w.citas.get("a1")!.status = "SCHEDULED";
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(r.estado, "creado");
  assert.equal(w.google.activos().length, 1);
  assert.equal(w.google.eventos.size, 1, "el mismo evento resucitado, no uno nuevo");
});

// ── Conexión, errores, tiempo ────────────────────────────────────────────────

test("clínica sin Google, desconectada o inexistente: no llama a Google", async () => {
  const w = mundo({
    clinicas: [clinica(C1, { enabled: false, refreshToken: null }), clinica(C2, { refreshToken: null })],
    citas: [conCita("a1"), conCita("b1", {}, C2)],
  });
  assert.deepEqual(await sincronizarCita(w.puertos, C1, "a1"), { estado: "omitido", motivo: "no_conectada" });
  assert.deepEqual(await sincronizarCita(w.puertos, C2, "b1"), { estado: "omitido", motivo: "no_conectada" });
  assert.deepEqual(await sincronizarCita(w.puertos, "no-existe", "a1"), { estado: "omitido", motivo: "no_conectada" });
  assert.deepEqual(await sincronizarCita(w.puertos, "", "a1"), { estado: "omitido", motivo: "cita_no_existe" });
  assert.equal(w.google.llamadas.length, 0);
});

test("conexión marcada como caída: se omite sin llamar a Google", async () => {
  const w = mundo({ clinicas: [clinica(C1, { enabled: false })], citas: [conCita("a1")] });
  assert.deepEqual(await sincronizarCita(w.puertos, C1, "a1"), { estado: "omitido", motivo: "conexion_caida" });
  const w2 = mundo({ citas: [conCita("a1")] });
  w2.ajustes.caidoDesde = new Date();
  assert.deepEqual(await sincronizarCita(w2.puertos, C1, "a1"), { estado: "omitido", motivo: "conexion_caida" });
  assert.equal(w.google.llamadas.length + w2.google.llamadas.length, 0);
});

test("una cita de OTRA clínica no se sincroniza con esta (aislamiento por clínica)", async () => {
  const w = mundo({ clinicas: [clinica(C1), clinica(C2)], citas: [conCita("b1", {}, C2)] });
  assert.deepEqual(await sincronizarCita(w.puertos, C1, "b1"), { estado: "omitido", motivo: "cita_no_existe" });
  assert.equal(w.google.activos().length, 0);
});

test("invalid_grant / permiso revocado: la cita no se toca, NO lanza y la conexión se marca caída", async () => {
  const w = mundo({ clinicas: [clinica(C1, { calendarId: "cal" })], citas: [conCita("a1")] });
  w.google.sembrarCalendario("cal", "x", marcaCalendarioDeClinica(C1));
  w.google.fallar("events.insert", errorInvalidGrant());
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.deepEqual(r, { estado: "fallo", motivo: "autorizacion" });
  assert.deepEqual(w.caidas, [{ clinicId: C1, motivo: "autorizacion" }]);

  // ya caída: las siguientes ni intentan
  const llamadas = w.google.llamadas.length;
  assert.equal((await sincronizarCita(w.puertos, C1, "a1")).estado, "omitido");
  assert.equal(w.google.llamadas.length, llamadas);
});

test("401 tras la renovación también es conexión caída; un 500 o la red NO lo son", async () => {
  const a = mundo({ clinicas: [clinica(C1, { calendarId: "cal" })], citas: [conCita("a1")] });
  a.google.sembrarCalendario("cal", "x", marcaCalendarioDeClinica(C1));
  a.google.fallar("events.insert", errorGoogle(401, "authError", "Invalid Credentials"));
  assert.deepEqual(await sincronizarCita(a.puertos, C1, "a1"), { estado: "fallo", motivo: "autorizacion" });

  for (const err of [errorGoogle(500, "backendError"), errorGoogle(503), errorGoogle(403, "rateLimitExceeded"), errorGoogle(429), Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })]) {
    const w = mundo({ clinicas: [clinica(C1, { calendarId: "cal" })], citas: [conCita("a1")] });
    w.google.sembrarCalendario("cal", "x", marcaCalendarioDeClinica(C1));
    w.google.fallar("events.insert", err);
    const r = await sincronizarCita(w.puertos, C1, "a1");
    assert.equal(r.estado, "fallo");
    assert.equal(w.caidas.length, 0, `transitorio (${(err as any).code}) no marca la conexión`);
    assert.equal(w.clinicas.get(C1)!.enabled, true);
  }
});

test("la API de Calendar apagada en el proyecto de Google se marca y se dice", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.google.fallar("calendarList.list", errorGoogle(403, "accessNotConfigured", "Google Calendar API has not been used"));
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.deepEqual(r, { estado: "fallo", motivo: "api_no_habilitada" });
  assert.deepEqual(w.caidas, [{ clinicId: C1, motivo: "api_no_habilitada" }]);
});

test("si el calendario no se puede crear NO se cae al calendario personal («primary») y se avisa", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.google.fallar("calendars.insert", errorGoogle(403, "forbidden", "Forbidden"));
  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.deepEqual(r, { estado: "fallo", motivo: "calendario" });
  assert.equal(w.google.cuantas("events.insert"), 0, "no se creó nada en ningún calendario");
  assert.ok(![...w.google.eventos.keys()].some((k) => k.startsWith("primary/")));
  assert.deepEqual(w.caidas, [{ clinicId: C1, motivo: "calendario" }]);

  // un fallo pasajero al crear el calendario no apaga la conexión
  const w2 = mundo({ citas: [conCita("a1")] });
  w2.google.fallar("calendars.insert", errorGoogle(503));
  assert.equal((await sincronizarCita(w2.puertos, C1, "a1")).estado, "fallo");
  assert.equal(w2.caidas.length, 0);
});

test("Google colgado: la sincronización corta a su límite, devuelve «tiempo» y no lanza", async () => {
  const w = mundo({ clinicas: [clinica(C1, { calendarId: "cal" })], citas: [conCita("a1")] });
  w.google.sembrarCalendario("cal", "x", marcaCalendarioDeClinica(C1));
  w.google.antes = (op) => (op === "events.insert" ? new Promise((res) => setTimeout(res, 400)) : undefined);
  const t0 = Date.now();
  const r = await sincronizarCita(w.puertos, C1, "a1", { limiteMs: 60 });
  assert.deepEqual(r, { estado: "fallo", motivo: "tiempo" });
  assert.ok(Date.now() - t0 < 300, `esperó ${Date.now() - t0} ms`);
  assert.equal(w.caidas.length, 0);
  await new Promise((res) => setTimeout(res, 450)); // deja terminar el trabajo suelto
});

// ── Access token renovado (#8) ───────────────────────────────────────────────

test("el access token renovado por Google se guarda (solo si sigue el mismo refresh token)", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  // La librería de Google avisa del token nuevo durante la llamada.
  let avisar: (t: string) => void = () => undefined;
  w.puertos.abrirCalendar = (cred) => { avisar = cred.alRenovarToken; return w.google; };
  w.google.antes = (op) => { if (op === "calendarList.list") avisar("at-nuevo"); };

  await sincronizarCita(w.puertos, C1, "a1");
  assert.deepEqual(w.tokensGuardados, [{ clinicId: C1, refresh: `rt-${C1}`, token: "at-nuevo" }]);
  assert.equal(w.clinicas.get(C1)!.accessToken, "at-nuevo");
});

test("si guardar el token falla, la cita se sincroniza igual", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  let avisar: (t: string) => void = () => undefined;
  w.puertos.abrirCalendar = (cred) => { avisar = cred.alRenovarToken; return w.google; };
  w.puertos.guardarAccessToken = async () => { throw new Error("base caída"); };
  w.google.antes = (op) => { if (op === "calendarList.list") avisar("at-nuevo"); };
  assert.equal((await sincronizarCita(w.puertos, C1, "a1")).estado, "creado");
});

// ── Varias clínicas / cuentas (#11) ──────────────────────────────────────────

test("dos clínicas en la MISMA cuenta de Google tienen cada una su calendario (no comparten)", async () => {
  const w = mundo({ clinicas: [clinica(C1), clinica(C2)], citas: [conCita("a1"), conCita("b1", {}, C2)] });
  await sincronizarCita(w.puertos, C1, "a1");
  await sincronizarCita(w.puertos, C2, "b1");
  const c1 = w.clinicas.get(C1)!.calendarId!;
  const c2 = w.clinicas.get(C2)!.calendarId!;
  assert.notEqual(c1, c2);
  assert.equal(w.google.calendarios.size, 2);
  assert.equal(w.google.activos(c1).length, 1);
  assert.equal(w.google.activos(c2).length, 1);
});

test("un calendario antiguo (sin id de clínica en la descripción) se adopta solo si el nombre coincide, y se marca", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.google.sembrarCalendario("viejo", `Clínica ${C1}`, `Agenda de Clínica ${C1} — DaleControl-clinic`);
  w.google.sembrarCalendario("otro-nombre", "Otra clínica", "Agenda de Otra clínica — DaleControl-clinic");
  await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(w.clinicas.get(C1)!.calendarId, "viejo");
  assert.ok(w.google.calendarios.get("viejo")!.description.includes(marcaCalendarioDeClinica(C1)));
  assert.equal(w.google.calendarios.get("otro-nombre")!.description, "Agenda de Otra clínica — DaleControl-clinic", "no toca el de otro nombre");
});

test("el calendario de OTRA clínica (marca con otro id) jamás se adopta, aunque el nombre coincida", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.google.sembrarCalendario("ajeno", `Clínica ${C1}`, `Agenda — ${marcaCalendarioDeClinica("otra-clinica")}`);
  await sincronizarCita(w.puertos, C1, "a1");
  assert.notEqual(w.clinicas.get(C1)!.calendarId, "ajeno");
  assert.equal(w.google.calendarios.size, 2, "se creó uno propio");
});

// ── En bloque (#7) ───────────────────────────────────────────────────────────

test("«Sincronizar citas futuras»: sube las que no tienen evento y no duplica al repetir", async () => {
  const w = mundo({
    citas: [
      conCita("f1", { startsAt: new Date("2026-10-20T16:00:00Z") }),
      conCita("f2", { startsAt: new Date("2026-10-21T16:00:00Z") }),
      conCita("f3", { startsAt: new Date("2026-10-22T16:00:00Z") }),
      conCita("c1", { status: "CANCELLED" }),
    ],
  });
  // f3 ya estaba en Google desde antes
  await sincronizarCita(w.puertos, C1, "f3");
  assert.equal(w.google.activos().length, 1);

  const r1 = await sincronizarFuturas(w.puertos, C1, { ahora: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual(r1, { creadas: 2, omitidas: 1, fallidas: 0, restantes: 0 });
  assert.equal(w.google.activos().length, 3);
  assert.equal(w.google.cuantas("events.insert"), 3);

  const r2 = await sincronizarFuturas(w.puertos, C1, { ahora: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual(r2, { creadas: 0, omitidas: 3, fallidas: 0, restantes: 0 }, "idempotente");
  assert.equal(w.google.activos().length, 3);
  assert.equal(w.google.cuantas("events.insert"), 3, "no volvió a insertar nada");
});

test("en bloque NO manda correos de invitación a los pacientes", async () => {
  const w = mundo({ citas: [conCita("f1"), conCita("f2")] });
  await sincronizarFuturas(w.puertos, C1);
  const inserts = w.google.llamadas.filter((l) => l.op === "events.insert");
  assert.equal(inserts.length, 2);
  for (const i of inserts) assert.equal(i.args.sendUpdates, "none");
});

test("en bloque: un evento que existía sin id guardado se reconoce (409 → se reanuda), no se duplica", async () => {
  const w = mundo({ citas: [conCita("f1")] });
  w.fallaGuardarId.quedan = 1;
  await sincronizarCita(w.puertos, C1, "f1");
  assert.equal(w.citas.get("f1")!.googleEventId, null);
  const r = await sincronizarFuturas(w.puertos, C1);
  assert.equal(r.creadas, 1);
  assert.equal(w.google.activos().length, 1);
});

test("en bloque: sin tiempo se corta y dice cuántas quedan (vuelve a pulsar)", async () => {
  const w = mundo({ citas: [conCita("f1"), conCita("f2"), conCita("f3"), conCita("f4")] });
  const r = await sincronizarFuturas(w.puertos, C1, { presupuestoMs: -1 });
  assert.equal(r.creadas, 0);
  assert.equal(r.restantes, 4);
  const r2 = await sincronizarFuturas(w.puertos, C1);
  assert.equal(r2.creadas, 4);
  assert.equal(r2.restantes, 0);
});

test("en bloque: si Google revoca a media pasada se corta (no 300 fallos iguales) y queda marcada", async () => {
  const w = mundo({ clinicas: [clinica(C1, { calendarId: "cal" })], citas: ["f1", "f2", "f3", "f4", "f5", "f6"].map((id) => conCita(id)) });
  w.google.sembrarCalendario("cal", "x", marcaCalendarioDeClinica(C1));
  w.google.fallar("events.insert", errorInvalidGrant(), 100);
  const r = await sincronizarFuturas(w.puertos, C1);
  assert.ok(r.fallidas >= 1 && r.fallidas <= 4, `fallidas=${r.fallidas}`);
  assert.equal(r.creadas, 0);
  assert.ok(r.restantes >= 1, "las no intentadas quedan como restantes");
  assert.equal(w.caidas[0].motivo, "autorizacion");
});

test("en bloque: clínica sin conexión o caída no hace nada y lo dice", async () => {
  const w = mundo({ clinicas: [clinica(C1, { enabled: false, refreshToken: null }), clinica(C2, { enabled: false })], citas: [conCita("f1"), conCita("g1", {}, C2)] });
  assert.deepEqual(await sincronizarFuturas(w.puertos, C1), { creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, motivo: "no_conectada" });
  assert.deepEqual(await sincronizarFuturas(w.puertos, C2), { creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, motivo: "conexion_caida" });
  assert.equal(w.google.llamadas.length, 0);
});

test("en bloque: solo toca citas de ESA clínica", async () => {
  const w = mundo({ clinicas: [clinica(C1), clinica(C2)], citas: [conCita("f1"), conCita("g1", {}, C2)] });
  await sincronizarFuturas(w.puertos, C1);
  assert.equal(w.citas.get("f1")!.googleEventId !== null, true);
  assert.equal(w.citas.get("g1")!.googleEventId, null);
});

// ── Carreras al crear el calendario ──────────────────────────────────────────

test("en bloque con 4 a la vez NO se crean 4 calendarios: uno solo", async () => {
  const w = mundo({ citas: ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map((id) => conCita(id)) });
  const r = await sincronizarFuturas(w.puertos, C1);
  assert.equal(r.creadas, 8);
  assert.equal(w.google.calendarios.size, 1);
  assert.equal(w.google.cuantas("calendars.insert"), 1);
  assert.equal(w.google.activos(w.clinicas.get(C1)!.calendarId!).length, 8);
});

test("otra instancia fijó su calendario primero: se usa el suyo y el que creamos se quita", async () => {
  const w = mundo({ citas: [conCita("a1")] });
  w.google.sembrarCalendario("ganador", `Clínica ${C1}`, `x — ${marcaCalendarioDeClinica(C1)}`);
  // Nuestra búsqueda no lo ve (se creó justo después de listar), así que crea el suyo…
  const listar = w.google.calendarList.list.bind(w.google.calendarList);
  w.google.calendarList.list = async (p) => {
    const r = await listar(p);
    return { data: { items: (r.data.items ?? []).filter((c) => c.id !== "ganador") } };
  };
  // …y al fijarlo, la base ya tenía el del ganador.
  w.puertos.fijarCalendarioId = async (clinicId) => { w.clinicas.get(clinicId)!.calendarId = "ganador"; return "ganador"; };

  const r = await sincronizarCita(w.puertos, C1, "a1");
  assert.equal(r.estado, "creado");
  assert.deepEqual([...w.google.calendarios.keys()], ["ganador"], "el calendario propio sobrante se quitó");
  assert.equal(w.google.activos("ganador").length, 1);
});

// ── Citas que ya pasaron ─────────────────────────────────────────────────────

test("una cita que ya terminó y nunca estuvo en Google NO se sube (ni invitación a algo pasado)", async () => {
  const w = mundo({ citas: [conCita("vieja", { startsAt: new Date("2026-09-01T16:00:00Z"), endsAt: new Date("2026-09-01T16:30:00Z") })] });
  const r = await sincronizarCita(w.puertos, C1, "vieja");
  assert.deepEqual(r, { estado: "omitido", motivo: "cita_pasada" });
  assert.equal(w.google.llamadas.length, 0, "ni siquiera se consulta a Google");
  assert.equal(w.citas.get("vieja")!.googleEventId, null);
});

test("si esa cita pasada YA tenía su evento, editarla sí lo pone al día (y cancelarla lo borra)", async () => {
  const w = mundo({ citas: [conCita("a1", { startsAt: new Date("2026-09-30T16:00:00Z"), endsAt: new Date("2026-09-30T16:30:00Z") })] });
  // nació cuando aún era futura
  w.puertos.ahora = () => new Date("2026-09-01T00:00:00Z");
  await sincronizarCita(w.puertos, C1, "a1");
  w.puertos.ahora = () => new Date("2026-10-01T00:00:00Z"); // ya pasó
  assert.equal((await sincronizarCita(w.puertos, C1, "a1")).estado, "actualizado");
  w.citas.get("a1")!.status = "CANCELLED";
  assert.equal((await sincronizarCita(w.puertos, C1, "a1")).estado, "borrado");
});
