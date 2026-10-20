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
 * `npm run test:google-entrante`
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Fila = Record<string, any>;
const llamadas: { op: string; args: any }[] = [];
const db = {
  clinics: new Map<string, Fila>(),
  imports: new Map<string, Fila>(),
  bloques: [] as Fila[],
  vinculos: [] as Fila[],
  citas: [] as Fila[],
  usuarios: [] as Fila[],
};
const reiniciar = () => {
  llamadas.length = 0;
  db.clinics.clear();
  db.imports.clear();
  db.bloques = [];
  db.vinculos = [];
  db.citas = [];
  db.usuarios = [];
};

/** Lo justo de `where` de Prisma que usan estas funciones. */
function cumple(f: Fila, w: Fila | undefined): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Fila[]).some((x) => cumple(f, x));
    if (k === "AND") return (v as Fila[]).every((x) => cumple(f, x));
    const val = f[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as unknown[]).includes(val);
      if ("not" in v) return v.not === null ? val != null : val !== v.not;
      if ("gt" in v) return val != null && val > v.gt;
      if ("lt" in v) return val != null && val < v.lt;
      return true;
    }
    if (v instanceof Date) return val instanceof Date && val.getTime() === v.getTime();
    return val === v;
  });
}
const elegir = (f: Fila, select?: Fila) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, f[k]])) : { ...f });
function tabla(nombre: string, filas: () => Fila[]) {
  return {
    findMany: async (a: Fila = {}) => {
      llamadas.push({ op: `${nombre}.findMany`, args: a });
      let r = filas().filter((f) => cumple(f, a.where));
      if (a.orderBy) {
        const [[k, dir]] = Object.entries(a.orderBy as Fila);
        r = [...r].sort((x, y) => (x[k] < y[k] ? -1 : x[k] > y[k] ? 1 : 0) * (dir === "desc" ? -1 : 1));
      }
      if (a.take) r = r.slice(0, a.take);
      return r.map((f) => elegir(f, a.select));
    },
    findFirst: async (a: Fila = {}) => {
      llamadas.push({ op: `${nombre}.findFirst`, args: a });
      const f = filas().find((x) => cumple(x, a.where));
      return f ? elegir(f, a.select) : null;
    },
    updateMany: async (a: Fila) => {
      llamadas.push({ op: `${nombre}.updateMany`, args: a });
      const r = filas().filter((f) => cumple(f, a.where));
      for (const f of r) Object.assign(f, a.data);
      return { count: r.length };
    },
    count: async (a: Fila = {}) => filas().filter((f) => cumple(f, a.where)).length,
    groupBy: async (a: Fila) => {
      const k = (a.by as string[])[0];
      return [...new Set(filas().filter((f) => cumple(f, a.where)).map((f) => f[k]))].sort().map((v) => ({ [k]: v }));
    },
  };
}
const prisma: Fila = {
  clinic: {
    ...tabla("clinic", () => [...db.clinics.values()]),
    findUnique: async (a: Fila) => {
      llamadas.push({ op: "clinic.findUnique", args: a });
      const f = db.clinics.get(a.where.id);
      return f ? elegir(f, a.select) : null;
    },
  },
  googleAgendaImport: {
    ...tabla("googleAgendaImport", () => [...db.imports.values()]),
    findUnique: async (a: Fila) => {
      llamadas.push({ op: "googleAgendaImport.findUnique", args: a });
      const f = db.imports.get(a.where.clinicId);
      return f ? elegir(f, a.select) : null;
    },
  },
  agendaBlock: tabla("agendaBlock", () => db.bloques),
  agendaBlockGoogle: tabla("agendaBlockGoogle", () => db.vinculos),
  appointment: tabla("appointment", () => db.citas),
  user: tabla("user", () => db.usuarios),
  $transaction: async (fn: (tx: Fila) => Promise<unknown>) => fn(prisma),
  // Solo la sonda de tablas: cualquier otra consulta cruda (p. ej. la tabla
  // `clinic_google_status` de ws1-t12) falla como si no estuviera pegada.
  $queryRaw: async (q: TemplateStringsArray) => {
    const sql = q.join("?");
    llamadas.push({ op: "$queryRaw", args: sql });
    if (sql.includes("to_regclass")) return [{ existe: true }];
    throw Object.assign(new Error('relation "clinic_google_status" does not exist'), { code: "P2010", meta: { code: "42P01" } });
  },
};
(mock as any).module("@/lib/prisma", { namedExports: { prisma } });

const servidor = () => import("../entrante.server");
const convertir = () => import("../convertir.server");
const AHORA = new Date();
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);
const CAL = "cal1@group.calendar.google.com";

function clinica(id: string, x: Fila = {}) {
  db.clinics.set(id, {
    id, timezone: "America/Mexico_City", googleCalendarEnabled: true, googleCalendarToken: "at",
    googleRefreshToken: "rt", googleClinicCalendarId: CAL, ...x,
  });
}
function bandera(clinicId: string, x: Fila = {}) {
  db.imports.set(clinicId, {
    clinicId, enabled: true, calendarId: CAL, syncToken: "tok", lastSyncAt: hace(1), lastFullSyncAt: hace(1),
    lastError: null, createdAt: hace(500), channelId: null, channelResourceId: null, channelExpiresAt: null,
    channelCalendarId: null, equipoFirma: null, leaseUntil: null, dirtyAt: null, ...x,
  });
}
function bloqueo(id: string, clinicId: string, x: Fila = {}) {
  db.bloques.push({ id, clinicId, kind: "GOOGLE", deletedAt: null, doctorId: null, startsAt: hace(-2), endsAt: hace(-3), ...x });
}

async function correrCron() {
  process.env.CRON_SECRET = "s3creto";
  const { GET } = await import("@/app/api/cron/google-calendario/route");
  const req = { headers: new Headers({ authorization: "Bearer s3creto" }) } as any;
  return (await GET(req)).json();
}

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
