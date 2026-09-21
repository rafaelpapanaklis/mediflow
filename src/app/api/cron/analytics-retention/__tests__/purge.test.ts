// Pruebas del cron de limpieza de analítica (WS1-T3).
//
// Se prueba purgeInBatches contra una tabla de mentira en memoria: sin BD, sin
// red y sin Next. Lo que se comprueba es exactamente lo que se pidió:
//  · borra POR LOTES, nunca de un golpe
//  · es IDEMPOTENTE: correrlo dos veces no falla y la segunda no borra nada
//  · lo que el heatmap necesita sigue estando después de limpiar
//  · el cron está declarado en vercel.json

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  purgeInBatches,
  cutoffFor,
  EVENT_RETENTION_DAYS,
  SESSION_RETENTION_DAYS,
  PURGE_BATCH,
  MAX_BATCHES,
  type BatchDeleter,
} from "../purge";

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-09-21T03:30:00.000Z");

interface Fila {
  id: string;
  createdAt: Date;
  type: string;
}

/** Tabla de mentira que apunta el tamaño de cada DELETE que recibe. */
function tablaFalsa(filas: Fila[]) {
  const store = [...filas];
  const lotes: number[] = [];
  const deleter: BatchDeleter = {
    pickOldest: async (cutoff, take) =>
      store
        .filter((r) => r.createdAt < cutoff)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, take)
        .map((r) => r.id),
    deleteByIds: async (ids) => {
      lotes.push(ids.length);
      const set = new Set(ids);
      let n = 0;
      for (let i = store.length - 1; i >= 0; i -= 1) {
        if (set.has(store[i].id)) {
          store.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
  };
  return { deleter, store, lotes };
}

function generar(n: number, edadDias: (i: number) => number, type = "click"): Fila[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    createdAt: new Date(AHORA.getTime() - edadDias(i) * DIA),
    type,
  }));
}

/* ============================ política de retención ========================= */

test("la política es la que se documentó: 90 días de eventos, 365 de sesiones", () => {
  assert.equal(EVENT_RETENTION_DAYS, 90);
  assert.equal(SESSION_RETENTION_DAYS, 365);
  // Los eventos no pueden durar más que las sesiones: un evento sin su sesión
  // no lo sabría leer nadie.
  assert.ok(EVENT_RETENTION_DAYS <= SESSION_RETENTION_DAYS);
  // Y tienen que cubrir de sobra los 30 días por defecto del panel.
  assert.ok(EVENT_RETENTION_DAYS >= 3 * 30);
});

test("cutoffFor devuelve el corte correcto", () => {
  const c = cutoffFor(90, AHORA);
  assert.equal(AHORA.getTime() - c.getTime(), 90 * DIA);
});

/* ================================ por lotes ================================= */

test("borra POR LOTES: ningún DELETE se lleva la tabla entera", async () => {
  // 500 filas viejas, lotes de 100.
  const { deleter, store, lotes } = tablaFalsa(generar(500, () => 200));
  const r = await purgeInBatches(deleter, cutoffFor(EVENT_RETENTION_DAYS, AHORA), {
    batchSize: 100,
  });

  assert.equal(r.deleted, 500);
  assert.equal(store.length, 0);
  assert.equal(r.batches, 5);
  assert.ok(lotes.length >= 5, "tienen que haber sido varios DELETE, no uno");
  assert.ok(
    lotes.every((n) => n <= 100),
    `ningún lote puede pasar de 100 filas, salieron: ${lotes.join(",")}`,
  );
});

test("el tope de lotes frena la corrida y lo dice (done: false)", async () => {
  const { deleter, store } = tablaFalsa(generar(1000, () => 200));
  const r = await purgeInBatches(deleter, cutoffFor(EVENT_RETENTION_DAYS, AHORA), {
    batchSize: 100,
    maxBatches: 3,
  });

  assert.equal(r.batches, 3);
  assert.equal(r.deleted, 300);
  assert.equal(r.done, false, "queda trabajo: la corrida de mañana sigue");
  assert.equal(store.length, 700);
});

test("el freno por tiempo corta sin borrar a medias", async () => {
  const { deleter, store } = tablaFalsa(generar(1000, () => 200));
  let reloj = 0;
  const r = await purgeInBatches(deleter, cutoffFor(EVENT_RETENTION_DAYS, AHORA), {
    batchSize: 100,
    deadlineAt: 250,
    nowMs: () => (reloj += 100), // cada consulta del reloj avanza 100 ms
  });

  assert.equal(r.done, false);
  assert.ok(r.batches > 0 && r.batches < 10, `paró a tiempo (${r.batches} lotes)`);
  assert.ok(store.length > 0);
});

test("sin tiempo desde el principio no toca la tabla", async () => {
  const { deleter, store, lotes } = tablaFalsa(generar(100, () => 200));
  const r = await purgeInBatches(deleter, cutoffFor(EVENT_RETENTION_DAYS, AHORA), {
    deadlineAt: 0,
    nowMs: () => 1,
  });

  assert.deepEqual(r, { deleted: 0, batches: 0, done: false });
  assert.equal(lotes.length, 0, "ni un DELETE");
  assert.equal(store.length, 100);
});

/* =============================== idempotencia =============================== */

test("IDEMPOTENTE: correrlo dos veces no falla y la segunda no borra nada", async () => {
  const { deleter, store } = tablaFalsa(generar(250, () => 200));
  const corte = cutoffFor(EVENT_RETENTION_DAYS, AHORA);

  const uno = await purgeInBatches(deleter, corte, { batchSize: 100 });
  assert.equal(uno.deleted, 250);
  assert.equal(uno.done, true);

  const dos = await purgeInBatches(deleter, corte, { batchSize: 100 });
  assert.deepEqual(dos, { deleted: 0, batches: 0, done: true });
  assert.equal(store.length, 0);

  // Y una tercera, por si acaso.
  const tres = await purgeInBatches(deleter, corte, { batchSize: 100 });
  assert.equal(tres.deleted, 0);
});

test("si un lote no borra nada, corta en vez de quemar los 40 lotes", async () => {
  // deleteByIds devuelve 0 (otra corrida se adelantó, o el DELETE no pegó):
  // pickOldest traería los mismos ids una y otra vez.
  let consultas = 0;
  const deleter: BatchDeleter = {
    pickOldest: async () => {
      consultas += 1;
      return ["a", "b", "c"];
    },
    deleteByIds: async () => 0,
  };

  const r = await purgeInBatches(deleter, cutoffFor(EVENT_RETENTION_DAYS, AHORA), {
    batchSize: 3,
    maxBatches: 40,
  });

  assert.equal(r.deleted, 0);
  assert.equal(r.batches, 1, "una vuelta y fuera");
  assert.equal(r.done, false, "no terminó: hay filas que no se dejan borrar");
  assert.equal(consultas, 1, "no se queman las 40 consultas en balde");
});

test("tabla vacía: no explota", async () => {
  const { deleter } = tablaFalsa([]);
  const r = await purgeInBatches(deleter, cutoffFor(EVENT_RETENTION_DAYS, AHORA));
  assert.deepEqual(r, { deleted: 0, batches: 0, done: true });
});

/* ==================== lo que el heatmap necesita sobrevive =================== */

test("después de limpiar, el heatmap sigue teniendo sus clicks", async () => {
  // Mezcla realista: clicks de hoy, de hace 29 días (el rango por defecto del
  // panel), de hace 89 (dentro) y de hace 120 (fuera).
  const filas: Fila[] = [
    ...generar(40, () => 0),
    ...generar(30, () => 29),
    ...generar(20, () => 89),
    ...generar(60, () => 120),
  ].map((f, i) => ({ ...f, id: `c${i}` }));

  const { deleter, store } = tablaFalsa(filas);
  const r = await purgeInBatches(deleter, cutoffFor(EVENT_RETENTION_DAYS, AHORA), {
    batchSize: 25,
  });

  assert.equal(r.deleted, 60, "sólo se van los de más de 90 días");
  assert.equal(store.length, 90);

  const edadMax = Math.max(
    ...store.map((f) => (AHORA.getTime() - f.createdAt.getTime()) / DIA),
  );
  assert.ok(edadMax <= EVENT_RETENTION_DAYS, "no sobrevive nada más viejo que el corte");

  // Lo que el panel pide por defecto (30 días) está intacto.
  const ultimos30 = store.filter(
    (f) => AHORA.getTime() - f.createdAt.getTime() <= 30 * DIA,
  );
  assert.equal(ultimos30.length, 70, "los 30 días por defecto del panel, enteros");
});

/* ========================= declarado en vercel.json ========================= */

test("el cron ESTÁ declarado en vercel.json (si no, nunca corre)", () => {
  // __dirname y no import.meta.dirname: el repo no es ESM (no hay "type":
  // "module"), tsx compila a CJS y el resto de las ~150 pruebas usan __dirname.
  const raiz = join(__dirname, "..", "..", "..", "..", "..", "..");
  const vercel = JSON.parse(readFileSync(join(raiz, "vercel.json"), "utf8")) as {
    crons: { path: string; schedule: string }[];
  };

  const mio = vercel.crons.find((c) => c.path === "/api/cron/analytics-retention");
  assert.ok(mio, "una ruta de cron sin línea en vercel.json es una ruta que no corre jamás");
  assert.match(mio.schedule, /^\S+ \S+ \S+ \S+ \S+$/, "cron de cinco campos");
  // Vercel programa en UTC y México va en UTC-6 todo el año: 09:30 UTC son las
  // 03:30 de CDMX. Con "30 3 * * *" habrían sido las 21:30, con clínicas abiertas.
  assert.equal(mio.schedule, "30 9 * * *", "diario, 03:30 CDMX");
});

test("los topes por corrida dan de sobra para el ritmo real", () => {
  // Medido: ~3 300 eventos al día. Una corrida tiene que poder con varios días
  // de atraso sin quedarse corta.
  const porCorrida = PURGE_BATCH * MAX_BATCHES;
  assert.ok(porCorrida >= 20 * 3_300, `${porCorrida} filas por corrida`);
});
