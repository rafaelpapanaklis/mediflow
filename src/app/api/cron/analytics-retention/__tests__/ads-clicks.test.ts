// Borrado del clic de anuncios a los 12 meses (WS1-T6, aviso de privacidad).
//
// Lo que promete la sección 8 de /privacidad: «12 meses desde que se registra
// la cuenta». Se prueba:
//  · borra lo que tiene MÁS de 12 meses y conserva lo que tiene menos
//  · cuenta desde "createdAt" (el registro), NO desde "clickedAt"
//  · por lotes, e idempotente
//  · la tabla ausente (42P01) NO rompe el cron: se apunta y sigue con lo demás
//  · cualquier otro error sí se apunta como error, y el resto de purgas corre
//  · el cron sigue siendo UNA sola entrada en vercel.json (mismo horario)
//
// Corre el handler REAL (route.ts) con un doble de prismaAdmin en memoria; el
// SQL que llega al doble es el de verdad. Sin base, sin red. Sin flags
// experimentales: parche de Module._load (ver la memoria de pruebas de rutas).
//
// Se ejecuta con `npm run test:analytics-retention` (purge.test.ts lo importa,
// porque ese script apunta a un solo archivo y package.json no es de esta tarea).

import Module from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import test, { before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ADS_CLICK_RETENTION_MONTHS,
  cutoffMonthsAgo,
  isMissingTableError,
  purgeAdsClicks,
  type RawSqlClient,
} from "../ads-clicks";
import { PURGE_BATCH } from "../purge";

const AHORA = new Date("2026-09-26T09:30:00.000Z");
const DIA = 24 * 60 * 60 * 1000;
const hace = (meses: number, extraMs = 0) => new Date(cutoffMonthsAgo(meses, AHORA).getTime() + extraMs);

interface Clic {
  clinicId: string;
  createdAt: Date; // el registro de la cuenta
  clickedAt: Date | null; // el clic (lo que declara la cookie)
  gclid: string;
}

function errorTablaAusente() {
  // Forma real del error de Prisma para SQL crudo contra una tabla que no existe.
  return Object.assign(new Error('Raw query failed. Code: `42P01`. Message: `relation "clinic_ads_clicks" does not exist`'), {
    code: "P2010",
    meta: { code: "42P01", message: 'relation "clinic_ads_clicks" does not exist' },
  });
}

/** Tabla de mentira con el mismo contrato de SQL que usa ads-clicks.ts. */
function baseFalsa(filas: Clic[], modo: "ok" | "ausente" | "falla" = "ok") {
  const store = [...filas];
  const sqls: string[] = [];
  const lotes: number[] = [];
  const db: RawSqlClient = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      sqls.push(sql);
      if (modo === "ausente") throw errorTablaAusente();
      if (modo === "falla") throw new Error("conexión rota");
      assert.match(sql, /"clinic_ads_clicks"/);
      const [cutoff, take] = values as [Date, number];
      return store
        .filter((r) => r.createdAt < cutoff)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, take)
        .map((r) => ({ clinicId: r.clinicId })) as never;
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      sqls.push(sql);
      assert.match(sql, /DELETE FROM "clinic_ads_clicks"/);
      const [ids] = values as [string[]];
      lotes.push(ids.length);
      let n = 0;
      for (let i = store.length - 1; i >= 0; i -= 1) {
        if (ids.includes(store[i].clinicId)) {
          store.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
  };
  return { db, store, sqls, lotes };
}

const clic = (id: string, createdAt: Date, clickedAt: Date | null = createdAt): Clic => ({
  clinicId: id,
  createdAt,
  clickedAt,
  gclid: `gclid-${id}-0123456789`,
});

/* ============================ política ====================================== */

test("la política es la que se decidió: 12 meses desde el registro", () => {
  assert.equal(ADS_CLICK_RETENTION_MONTHS, 12);
});

test("cutoffMonthsAgo cuenta meses de calendario, fecha a fecha", () => {
  assert.equal(cutoffMonthsAgo(12, AHORA).toISOString(), "2025-09-26T09:30:00.000Z");
  assert.equal(cutoffMonthsAgo(12, new Date("2026-01-15T00:00:00.000Z")).toISOString(), "2025-01-15T00:00:00.000Z");
});

/* ============================ borra / conserva ============================== */

test("borra lo de más de 12 meses y conserva lo de menos", async () => {
  const { db, store } = baseFalsa([
    clic("viejo-13m", hace(13)),
    clic("viejo-24m", hace(24)),
    clic("reciente-11m", hace(11)),
    clic("reciente-ayer", new Date(AHORA.getTime() - DIA)),
    clic("recien-registrada", AHORA),
  ]);
  const r = await purgeAdsClicks(db, AHORA);
  assert.equal(r.deleted, 2);
  assert.equal(r.done, true);
  assert.equal(r.skipped, null);
  assert.deepEqual(store.map((s) => s.clinicId).sort(), ["recien-registrada", "reciente-11m", "reciente-ayer"]);
});

test("el límite es exacto: un minuto pasado los 12 meses se va, un minuto antes se queda", async () => {
  const { db, store } = baseFalsa([
    clic("pasada", hace(12, -60_000)),
    clic("por-cumplir", hace(12, +60_000)),
  ]);
  await purgeAdsClicks(db, AHORA);
  assert.deepEqual(store.map((s) => s.clinicId), ["por-cumplir"]);
});

test("cuenta desde el registro (createdAt), no desde el clic (clickedAt)", async () => {
  // Clic de hace 3 años pero cuenta registrada ayer (la cookie del clic dura 90
  // días, pero un _gcl_aw viejo puede traer una fecha lejana): NO se borra.
  // Y al revés: clic de ayer pero cuenta de hace 13 meses: se borra.
  const { db, store, sqls } = baseFalsa([
    clic("clic-viejo-cuenta-nueva", new Date(AHORA.getTime() - DIA), hace(36)),
    clic("clic-nuevo-cuenta-vieja", hace(13), new Date(AHORA.getTime() - DIA)),
  ]);
  await purgeAdsClicks(db, AHORA);
  assert.deepEqual(store.map((s) => s.clinicId), ["clic-viejo-cuenta-nueva"]);
  // Y el SQL que sale lo dice: ordena y corta por "createdAt", nunca por "clickedAt".
  const pick = sqls.find((s) => /SELECT/.test(s))!;
  assert.match(pick, /WHERE "createdAt" </);
  assert.doesNotMatch(pick, /clickedAt/);
});

test("borra por LOTES de PURGE_BATCH y es idempotente", async () => {
  const filas = Array.from({ length: PURGE_BATCH * 2 + 5 }, (_, i) => clic(`c${i}`, hace(13, -i * 1000)));
  filas.push(clic("vigente", hace(1)));
  const { db, store, lotes } = baseFalsa(filas);
  const r1 = await purgeAdsClicks(db, AHORA);
  assert.deepEqual(lotes, [PURGE_BATCH, PURGE_BATCH, 5]);
  assert.equal(r1.deleted, PURGE_BATCH * 2 + 5);
  assert.equal(r1.done, true);
  assert.deepEqual(store.map((s) => s.clinicId), ["vigente"]);

  const r2 = await purgeAdsClicks(db, AHORA);
  assert.deepEqual({ deleted: r2.deleted, batches: r2.batches, done: r2.done }, { deleted: 0, batches: 0, done: true });
});

test("el resultado no lleva ningún gclid (solo cuentas y fechas)", async () => {
  const { db } = baseFalsa([clic("a", hace(14))]);
  const r = await purgeAdsClicks(db, AHORA);
  assert.doesNotMatch(JSON.stringify(r), /gclid/i);
});

/* ============================ tabla ausente ================================= */

test("tabla ausente (42P01): no lanza, lo deja dicho y sigue", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const { db } = baseFalsa([], "ausente");
    const r = await purgeAdsClicks(db, AHORA);
    assert.equal(r.deleted, 0);
    assert.equal(r.done, true);
    assert.match(r.skipped ?? "", /clinic_ads_clicks.*42P01/);
    assert.equal(warn.mock.callCount(), 1);
  } finally {
    warn.mock.restore();
  }
});

test("cualquier otro error SÍ se lanza (no se traga un fallo real)", async () => {
  const { db } = baseFalsa([], "falla");
  await assert.rejects(purgeAdsClicks(db, AHORA), /conexión rota/);
});

test("isMissingTableError reconoce las formas en que llega el 42P01 y nada más", () => {
  assert.equal(isMissingTableError(errorTablaAusente()), true);
  assert.equal(isMissingTableError({ code: "42P01" }), true);
  assert.equal(isMissingTableError({ meta: { code: "42P01" } }), true);
  assert.equal(isMissingTableError(new Error('relation "clinic_ads_clicks" does not exist')), true);
  assert.equal(isMissingTableError(new Error('relation "public"."clinic_ads_clicks" does not exist')), true);
  assert.equal(isMissingTableError(new Error("Code: `42P01`")), true);
  assert.equal(isMissingTableError(new Error("conexión rota")), false);
  assert.equal(isMissingTableError({ code: "P2002" }), false);
  assert.equal(isMissingTableError(new Error('column "gclid" does not exist')), false);
  assert.equal(isMissingTableError(null), false);
  assert.equal(isMissingTableError("42P01"), false);
});

/* ============================ el cron entero ================================ */

const RAIZ = path.resolve(__dirname, "../../../../../..");
const RUTA_PRISMA_ADMIN = path.join(RAIZ, "src", "lib", "prisma-admin.ts");

type Cron = { GET: (req: Request) => Promise<Response> };
let cron: Cron;
let ads = baseFalsa([]);
let eventos: Array<{ id: string; createdAt: Date }> = [];
let sesiones: Array<{ id: string; startedAt: Date }> = [];

const prismaAdminDoble = {
  analyticsEvent: {
    findMany: async ({ where, take }: any) =>
      eventos.filter((e) => e.createdAt < where.createdAt.lt).slice(0, take).map((e) => ({ id: e.id })),
    deleteMany: async ({ where }: any) => {
      const antes = eventos.length;
      eventos = eventos.filter((e) => !where.id.in.includes(e.id));
      return { count: antes - eventos.length };
    },
  },
  analyticsSession: {
    findMany: async ({ where, take }: any) =>
      sesiones.filter((s) => s.startedAt < where.startedAt.lt).slice(0, take).map((s) => ({ id: s.id })),
    deleteMany: async ({ where }: any) => {
      const antes = sesiones.length;
      sesiones = sesiones.filter((s) => !where.id.in.includes(s.id));
      return { count: antes - sesiones.length };
    },
  },
  $queryRaw: (...a: [TemplateStringsArray, ...unknown[]]) => ads.db.$queryRaw(...a),
  $executeRaw: (...a: [TemplateStringsArray, ...unknown[]]) => ads.db.$executeRaw(...a),
};

const orig = (Module as any)._load;
const entornoOriginal: Record<string, string | undefined> = {};
const SECRETO = "s".repeat(40);

before(async () => {
  // Valores de mentira: env.ts valida todo el bloque la primera vez que se lee.
  for (const [k, v] of Object.entries({
    CRON_SECRET: SECRETO,
    DATABASE_URL: "postgresql://u:p@localhost:5432/x",
    NEXT_PUBLIC_SUPABASE_URL: "https://ejemplo.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-de-mentira",
    SUPABASE_SERVICE_ROLE_KEY: "service-de-mentira",
  })) {
    entornoOriginal[k] = process.env[k];
    process.env[k] = v;
  }
  (Module as any)._load = function (request: string, parent: any, isMain: boolean) {
    if (request === "server-only" || request === "client-only") return {};
    try {
      const resuelta = (Module as any)._resolveFilename(request, parent, isMain);
      if (resuelta === RUTA_PRISMA_ADMIN) return { prismaAdmin: prismaAdminDoble };
    } catch {
      /* deja que el cargador real dé su error */
    }
    return orig.apply(this, arguments);
  };
  cron = (await import("../route")) as unknown as Cron;
});

after(() => {
  (Module as any)._load = orig;
  for (const [k, v] of Object.entries(entornoOriginal)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  mock.timers.reset();
  ads = baseFalsa([]);
  eventos = [];
  sesiones = [];
});

function pedir() {
  return cron.GET(new Request("http://localhost/api/cron/analytics-retention", { headers: { authorization: `Bearer ${SECRETO}` } }));
}

test("cron: borra el clic viejo, conserva el reciente y deja constancia en el resumen", async () => {
  const log = mock.method(console, "log", () => {});
  try {
    const ahora = Date.now();
    ads = baseFalsa([clic("vieja", new Date(ahora - 400 * DIA)), clic("nueva", new Date(ahora - 30 * DIA))]);
    const res = await pedir();
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.adsClicks.deleted, 1);
    assert.equal(body.adsClicks.skipped, null);
    assert.deepEqual(ads.store.map((s) => s.clinicId), ["nueva"]);
    // El resumen del log (mismo formato que el resto del cron) trae la línea de anuncios, sin gclid.
    const linea = log.mock.calls.map((c) => String(c.arguments.join(" "))).find((l) => l.startsWith("[cron/analytics-retention]"))!;
    assert.match(linea, /"adsClicks":\{[^}]*"deleted":1/);
    assert.doesNotMatch(linea, /gclid/i);
  } finally {
    log.mock.restore();
  }
});

test("cron: con la tabla ausente NO se rompe y las otras purgas corren igual", async () => {
  const log = mock.method(console, "log", () => {});
  const warn = mock.method(console, "warn", () => {});
  try {
    const ahora = Date.now();
    ads = baseFalsa([], "ausente");
    eventos = [
      { id: "e-viejo", createdAt: new Date(ahora - 100 * DIA) },
      { id: "e-nuevo", createdAt: new Date(ahora - 1 * DIA) },
    ];
    sesiones = [
      { id: "s-vieja", startedAt: new Date(ahora - 400 * DIA) },
      { id: "s-nueva", startedAt: new Date(ahora - 1 * DIA) },
    ];
    const res = await pedir();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true, JSON.stringify(body.errors));
    assert.deepEqual(body.errors, []);
    assert.match(body.adsClicks.skipped, /clinic_ads_clicks/);
    assert.equal(body.events.deleted, 1);
    assert.equal(body.sessions.deleted, 1);
    assert.deepEqual(eventos.map((e) => e.id), ["e-nuevo"]);
    assert.deepEqual(sesiones.map((s) => s.id), ["s-nueva"]);
  } finally {
    log.mock.restore();
    warn.mock.restore();
  }
});

test("cron: un error real en los clics se apunta en errors y no frena eventos ni sesiones", async () => {
  const log = mock.method(console, "log", () => {});
  try {
    const ahora = Date.now();
    ads = baseFalsa([], "falla");
    eventos = [{ id: "e-viejo", createdAt: new Date(ahora - 100 * DIA) }];
    const body = await (await pedir()).json();
    assert.equal(body.ok, false);
    assert.match(body.errors.join(" "), /adsClicks: conexión rota/);
    assert.equal(body.events.deleted, 1);
  } finally {
    log.mock.restore();
  }
});

test("cron: sin el secreto responde 401 y no toca nada", async () => {
  ads = baseFalsa([clic("vieja", hace(20))]);
  const res = await cron.GET(new Request("http://localhost/x"));
  assert.equal(res.status, 401);
  assert.equal(ads.store.length, 1);
});

test("el borrado va en el cron EXISTENTE: una sola entrada en vercel.json, mismo horario", () => {
  const vercel = JSON.parse(readFileSync(path.join(RAIZ, "vercel.json"), "utf8"));
  const entradas = vercel.crons.filter((c: { path: string }) => c.path.startsWith("/api/cron/analytics-retention"));
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].schedule, "30 9 * * *");
});
