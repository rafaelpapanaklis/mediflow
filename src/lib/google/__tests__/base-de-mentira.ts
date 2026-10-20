/**
 * La base de mentira de las pruebas de servidor de Google → agenda (WS1-T9):
 * lo justo de Prisma en memoria, más las ayudas para montar clínicas,
 * banderas, bloqueos, una Google falsa en los puertos y correr el cron.
 * Cada archivo de prueba la registra con
 * `mock.module("@/lib/prisma", { namedExports: { prisma } })` ANTES de
 * importar nada del servidor (cada archivo corre en su propio proceso).
 */
import type { EventoGoogle } from "../entrante-core";

const servidor = () => import("../entrante.server");

export type Fila = Record<string, any>;
export const llamadas: { op: string; args: any; tx?: boolean }[] = [];
/** Lo que pasa justo DESPUÉS de soltar un turno (otra pasada que lo toma), una vez cada uno. */
export const trasSoltar: (() => void)[] = [];
/** Lo que pasa justo ANTES de cada `tomarTurno` (en orden; `null` = nada esa vez). */
export const antesDeTomarTurno: ((() => void) | null)[] = [];
/** Cortes del pooler: la siguiente sentencia con esa `op` (p. ej. "agendaBlock.updateMany") lanza, una vez. */
export const cortes: string[] = [];
/** Cuántas transacciones hay abiertas ahora (cada escritura anota si iba dentro). */
let enTransaccion = 0;
export const db = {
  clinics: new Map<string, Fila>(),
  imports: new Map<string, Fila>(),
  bloques: [] as Fila[],
  vinculos: [] as Fila[],
  citas: [] as Fila[],
  usuarios: [] as Fila[],
};
export const reiniciar = () => {
  llamadas.length = 0;
  trasSoltar.length = 0;
  cortes.length = 0;
  antesDeTomarTurno.length = 0;
  db.clinics.clear();
  db.imports.clear();
  db.bloques = [];
  db.vinculos = [];
  db.citas = [];
  db.usuarios = [];
};

/** Lo justo de `where` de Prisma que usan estas funciones. */
export function cumple(f: Fila, w: Fila | undefined): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return (v as Fila[]).some((x) => cumple(f, x));
    if (k === "AND") return (v as Fila[]).every((x) => cumple(f, x));
    const val = f[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as unknown[]).includes(val);
      if ("not" in v) return v.not === null ? val != null : val !== v.not;
      if ("gt" in v) return val != null && val > v.gt;
      if ("gte" in v) return val != null && val >= v.gte;
      if ("lt" in v) return val != null && val < v.lt;
      return true;
    }
    if (v instanceof Date) return val instanceof Date && val.getTime() === v.getTime();
    return val === v;
  });
}
export const elegir = (f: Fila, select?: Fila) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, f[k]])) : { ...f });
export function tabla(nombre: string, filas: () => Fila[]) {
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
      llamadas.push({ op: `${nombre}.updateMany`, args: a, tx: enTransaccion > 0 });
      const corte = cortes.indexOf(`${nombre}.updateMany`);
      if (corte >= 0) {
        cortes.splice(corte, 1);
        throw Object.assign(new Error("Can't reach database server (corte del pooler)"), { code: "P1001" });
      }
      if (nombre === "googleAgendaImport" && a.data?.leaseUntil instanceof Date) antesDeTomarTurno.shift()?.();
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
export const prisma: Fila = {
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
  // Como Postgres: si algo lanza dentro, NADA de lo escrito queda.
  $transaction: async (fn: (tx: Fila) => Promise<unknown>) => {
    const antes = structuredClone({ clinics: db.clinics, imports: db.imports, bloques: db.bloques, vinculos: db.vinculos, citas: db.citas });
    enTransaccion++;
    try {
      return await fn(prisma);
    } catch (e) {
      for (const k of ["clinics", "imports"] as const) {
        db[k].clear();
        for (const [id, f] of antes[k]) db[k].set(id, f);
      }
      db.bloques = antes.bloques;
      db.vinculos = antes.vinculos;
      db.citas = antes.citas;
      throw e;
    } finally {
      enTransaccion--;
    }
  },
  // El callback de OAuth guarda la conexión con SQL crudo.
  $executeRawUnsafe: async (sql: string, ...vals: unknown[]) => {
    llamadas.push({ op: "$executeRawUnsafe", args: sql });
    if (sql.startsWith("UPDATE clinics")) {
      const f = db.clinics.get(vals[4] as string);
      if (!f) return 0;
      Object.assign(f, { googleCalendarToken: vals[0], googleRefreshToken: vals[1], googleCalendarEmail: vals[2], googleCalendarEnabled: true, googleClinicCalendarId: vals[3] });
      return 1;
    }
    return 1;
  },
  // Solo la sonda de tablas: cualquier otra consulta cruda (p. ej. la tabla
  // `clinic_google_status` de ws1-t12) falla como si no estuviera pegada.
  $queryRaw: async (q: TemplateStringsArray, ...vals: unknown[]) => {
    const sql = q.join("?");
    llamadas.push({ op: "$queryRaw", args: sql });
    if (sql.includes("to_regclass")) return [{ existe: true }];
    // `soltarTurno`: suelta el turno y devuelve «sucio» en una sentencia.
    if (sql.includes('SET "leaseUntil" = NULL')) {
      const f = db.imports.get(vals[0] as string);
      if (!f) return [];
      f.leaseUntil = null;
      const fila = [{ dirtyAt: f.dirtyAt ?? null }];
      const despues = trasSoltar.shift();
      if (despues) despues();
      return fila;
    }
    throw Object.assign(new Error('relation "clinic_google_status" does not exist'), { code: "P2010", meta: { code: "42P01" } });
  },
};

export const AHORA = new Date();
export const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);
export const CAL = "cal1@group.calendar.google.com";

export function clinica(id: string, x: Fila = {}) {
  db.clinics.set(id, {
    id, timezone: "America/Mexico_City", googleCalendarEnabled: true, googleCalendarToken: "at",
    googleRefreshToken: "rt", googleClinicCalendarId: CAL, ...x,
  });
}
export function bandera(clinicId: string, x: Fila = {}) {
  db.imports.set(clinicId, {
    clinicId, enabled: true, calendarId: CAL, syncToken: "tok", lastSyncAt: hace(1), lastFullSyncAt: hace(1),
    lastError: null, createdAt: hace(500), channelId: null, channelResourceId: null, channelExpiresAt: null,
    channelCalendarId: null, equipoFirma: null, leaseUntil: null, dirtyAt: null, ...x,
  });
}
export function bloqueo(id: string, clinicId: string, x: Fila = {}) {
  db.bloques.push({ id, clinicId, kind: "GOOGLE", deletedAt: null, deletedById: null, doctorId: null, startsAt: hace(-2), endsAt: hace(-3), ...x });
}

export async function correrCron() {
  process.env.CRON_SECRET = "s3creto";
  const { GET } = await import("@/app/api/cron/google-calendario/route");
  const req = { headers: new Headers({ authorization: "Bearer s3creto" }) } as any;
  return (await GET(req)).json();
}

/** Una Google falsa en los puertos de la entrada (los mismos que usa el cron). */
export async function conGoogle(list: (p: Record<string, unknown>) => Promise<{ data: Fila }>) {
  const { _puertosEntrante } = await servidor();
  const pedidas: Record<string, unknown>[] = [];
  const original = _puertosEntrante.abrirCalendar;
  _puertosEntrante.abrirCalendar = () => ({
    events: {
      list: async (p: Record<string, unknown>) => { pedidas.push(p); return list(p) as any; },
      get: async () => { throw { response: { status: 404 } }; },
      watch: async () => { throw new Error("la prueba no crea canales"); },
    },
    channels: { stop: async () => undefined },
  });
  // Sin dirección pública: el canal de avisos no llama a la Google de verdad.
  delete process.env.NEXT_PUBLIC_APP_URL;
  return { pedidas, restaurar: () => { _puertosEntrante.abrirCalendar = original; } };
}
export const enGoogle = (id: string, b: Fila): EventoGoogle => ({
  id, status: "confirmed", summary: id, updated: hace(40).toISOString(),
  start: { dateTime: b.startsAt.toISOString() }, end: { dateTime: b.endsAt.toISOString() },
});
/** Un bloqueo de Google con su vínculo, como lo deja la entrada. */
export function deGoogle(id: string, evento: string) {
  bloqueo(id, "c1");
  const b = db.bloques.at(-1)!;
  db.vinculos.push({
    blockId: id, clinicId: "c1", calendarId: CAL, googleEventId: evento, recurringEventId: null, title: evento,
    allDay: false, alcance: "sin_invitados", appointmentId: null, eventStartsAt: b.startsAt, eventEndsAt: b.endsAt,
    eventDeletedAt: null, avisoTipo: null,
  });
  return b;
}
export const activos = () => db.bloques.filter((b) => b.deletedAt === null).map((b) => b.id).sort();
