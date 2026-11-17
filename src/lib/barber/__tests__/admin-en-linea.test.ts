// «En línea» del admin de barberías (17-nov-2026), igual que /admin/clinics
// del dental: ventana de minutos, matriz + sucursales, el «N en línea» del
// resumen, y sin la tabla barber_usage_events nadie sale en línea y nada truena.
//
//   npx tsx --test src/lib/barber/__tests__/admin-en-linea.test.ts
//
// Sin base: la consulta va contra un doble de prisma.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MINUTOS_EN_LINEA,
  barberiasEnLinea,
  contarEnLinea,
  desdeEnLinea,
  estaEnLinea,
} from "@/lib/barber/uso/en-linea-core";

const AHORA = new Date("2026-11-17T18:00:00.000Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

test("los minutos son los MISMOS que el dental (15)", () => {
  assert.equal(MINUTOS_EN_LINEA, 15);
  // Se lee el archivo del dental como texto (no se importa): si el dental lo
  // cambia, esta prueba avisa de que barber quedó distinto.
  const dental = readFileSync(path.join(process.cwd(), "src/lib/admin/salud-clinica.ts"), "utf8");
  const m = /export const MINUTOS_EN_LINEA = (\d+);/.exec(dental);
  assert.ok(m, "no encontré MINUTOS_EN_LINEA en salud-clinica.ts");
  assert.equal(Number(m![1]), MINUTOS_EN_LINEA);
});

test("ventana: dentro hasta exactamente 15 min (>=, como el dental); fuera a los 15 min y 1 s", () => {
  assert.equal(desdeEnLinea(AHORA).toISOString(), hace(15).toISOString());
  assert.equal(estaEnLinea(hace(0), AHORA), true);
  assert.equal(estaEnLinea(hace(14.9), AHORA), true);
  assert.equal(estaEnLinea(hace(15), AHORA), true);
  assert.equal(estaEnLinea(new Date(hace(15).getTime() - 1000), AHORA), false);
  assert.equal(estaEnLinea(hace(60 * 24), AHORA), false);
  // ISO (lo que viaja al navegador), null y basura.
  assert.equal(estaEnLinea(hace(3).toISOString(), AHORA), true);
  assert.equal(estaEnLinea(null, AHORA), false);
  assert.equal(estaEnLinea(undefined, AHORA), false);
  assert.equal(estaEnLinea("no-es-fecha", AHORA), false);
});

test("matriz + sucursales: una sucursal en línea enciende a su matriz; la matriz NO enciende a sus sucursales", () => {
  const s = barberiasEnLinea(
    [
      { barbershopId: "matriz-a", parentId: null, ultimo: hace(40) },
      { barbershopId: "suc-a1", parentId: "matriz-a", ultimo: hace(2) },
      { barbershopId: "suc-a2", parentId: "matriz-a", ultimo: hace(90) },
      { barbershopId: "matriz-b", parentId: null, ultimo: hace(5) },
      { barbershopId: "suc-b1", parentId: "matriz-b", ultimo: hace(30) },
      { barbershopId: "matriz-c", parentId: null, ultimo: hace(16) },
      { barbershopId: "matriz-d", parentId: null, ultimo: null },
    ],
    AHORA,
  );
  assert.deepEqual([...s].sort(), ["matriz-a", "matriz-b", "suc-a1"]);
  assert.equal(s.has("suc-a2"), false);
  assert.equal(s.has("suc-b1"), false, "la sucursal no hereda de la matriz");
  assert.equal(s.has("matriz-c"), false);
  assert.equal(s.has("matriz-d"), false);
});

test("«N en línea» del resumen: cada barbería una vez (la sucursal con su matriz en la lista no suma aparte)", () => {
  const filas = [
    { id: "matriz-a", parentId: null, enLinea: true }, // encendida por suc-a1
    { id: "suc-a1", parentId: "matriz-a", enLinea: true },
    { id: "suc-a2", parentId: "matriz-a", enLinea: false },
    { id: "matriz-b", parentId: null, enLinea: true },
    { id: "matriz-c", parentId: null, enLinea: false },
    // Lista filtrada solo a sucursales: la matriz no está → cuenta ella.
    { id: "suc-x1", parentId: "matriz-x-fuera", enLinea: true },
  ];
  assert.equal(contarEnLinea(filas), 3);
  assert.equal(contarEnLinea([]), 0);
  assert.equal(contarEnLinea(filas.map((f) => ({ ...f, enLinea: false }))), 0);
});

// ── La consulta de la lista y la de la ficha, contra un doble de prisma ──

type Llamada = { sql: string; valores: unknown[] };

function sqlDe(q: unknown, valores: unknown[]): { sql: string; valores: unknown[] } {
  // $queryRaw`…` llega como (TemplateStringsArray, ...valores); Prisma.sql como objeto con .strings.
  if (Array.isArray(q)) return { sql: (q as readonly string[]).join("?"), valores };
  const o = q as { strings?: string[]; values?: unknown[]; sql?: string };
  return { sql: o.strings ? o.strings.join("?") : String(o.sql ?? ""), valores: o.values ?? valores };
}

function dobleDb(opts: { tabla: boolean; filas?: unknown[]; error?: Error; responder?: (sql: string) => unknown[] }) {
  const llamadas: Llamada[] = [];
  const db = {
    $queryRaw: (q: unknown, ...valores: unknown[]) => {
      const l = sqlDe(q, valores);
      llamadas.push(l);
      if (/to_regclass/.test(l.sql)) return Promise.resolve([{ t: opts.tabla }]);
      if (opts.error) return Promise.reject(opts.error);
      if (opts.responder) return Promise.resolve(opts.responder(l.sql));
      return Promise.resolve(opts.filas ?? []);
    },
    $executeRaw: () => Promise.resolve(0),
  };
  return { db: db as never, llamadas };
}

let act: typeof import("@/lib/barber/uso/actividad");
let reg: typeof import("@/lib/barber/uso/registro");

beforeEach(async () => {
  act ??= await import("@/lib/barber/uso/actividad");
  reg ??= await import("@/lib/barber/uso/registro");
  reg.olvidarUsoListo();
});

test("lista: UNA consulta agregada que mete las sucursales de las matrices pedidas; matriz en línea por su sucursal", async () => {
  const { db, llamadas } = dobleDb({
    tabla: true,
    filas: [
      { barbershopId: "matriz-a", parentId: null, ultimo: hace(50), clics: 7 },
      { barbershopId: "suc-a1", parentId: "matriz-a", ultimo: hace(4), clics: 2 },
      { barbershopId: "matriz-b", parentId: null, ultimo: hace(20), clics: 0 },
    ],
  });
  const r = await act.usoParaLista(["matriz-a", "matriz-b"], db, AHORA);
  assert.equal(r.disponible, true);
  assert.equal(r.enLinea.has("matriz-a"), true, "su sucursal está en línea");
  assert.equal(r.enLinea.has("matriz-b"), false, "hace 20 min: fuera de la ventana");
  // Último uso y clics siguen siendo POR SEDE (no se mezclan).
  assert.equal(r.porBarberia.get("matriz-a")?.clicsMes, 7);
  assert.equal(r.porBarberia.get("matriz-a")?.ultimoUso, hace(50).toISOString());

  const consultas = llamadas.filter((l) => /FROM "barber_usage_events"/.test(l.sql));
  assert.equal(consultas.length, 1, "una sola consulta para toda la lista");
  const sql = consultas[0].sql;
  assert.match(sql, /"parentId" = ANY\(/, "incluye las sucursales de las matrices pedidas");
  assert.match(sql, /GROUP BY/);
  assert.match(sql, /"createdAt" >= /, "acotada por fecha (índice barbershopId+createdAt)");
});

test("ficha: quién del equipo está en línea, una consulta por userId y ventana de 15 min", async () => {
  const { db, llamadas } = dobleDb({ tabla: true, filas: [{ userId: "u1" }] });
  const s = await act.usuariosEnLinea(["u1", "u2"], db, AHORA);
  assert.deepEqual([...s], ["u1"]);
  const q = llamadas.filter((l) => /FROM "barber_usage_events"/.test(l.sql));
  assert.equal(q.length, 1);
  assert.match(q[0].sql, /"userId" = ANY\(/);
  assert.ok(
    q[0].valores.some((v) => v instanceof Date && v.getTime() === hace(MINUTOS_EN_LINEA).getTime()),
    "la ventana es MINUTOS_EN_LINEA",
  );
  // Sin personas no se consulta (un filtro vacío NO es «todos»).
  const vacio = dobleDb({ tabla: true, filas: [{ userId: "x" }] });
  assert.equal((await act.usuariosEnLinea([], vacio.db, AHORA)).size, 0);
  assert.equal(vacio.llamadas.length, 0);
});

test("sin la tabla barber_usage_events: nadie en línea, la lista y la ficha no truenan", async () => {
  const lista = dobleDb({ tabla: false });
  const r = await act.usoParaLista(["matriz-a"], lista.db, AHORA);
  assert.equal(r.disponible, false);
  assert.equal(r.enLinea.size, 0);
  assert.equal(lista.llamadas.filter((l) => /FROM "barber_usage_events"/.test(l.sql)).length, 0);

  reg.olvidarUsoListo();
  const ficha = dobleDb({ tabla: false });
  assert.equal((await act.usuariosEnLinea(["u1"], ficha.db, AHORA)).size, 0);

  // La quitaron con el proceso vivo: la consulta truena con «relation does not exist».
  reg.olvidarUsoListo();
  const quitada = Object.assign(new Error('relation "barber_usage_events" does not exist'), { code: "P2010", meta: { code: "42P01" } });
  const r2 = await act.usoParaLista(["matriz-a"], dobleDb({ tabla: true, error: quitada }).db, AHORA);
  assert.equal(r2.disponible, false);
  assert.equal(r2.enLinea.size, 0);
  reg.olvidarUsoListo();
  assert.equal((await act.usuariosEnLinea(["u1"], dobleDb({ tabla: true, error: quitada }).db, AHORA)).size, 0);
});

test("actividad por persona: enLinea sale de su último uso con la misma ventana", async () => {
  const { db } = dobleDb({
    tabla: true,
    // Solo la consulta de «último uso por persona» trae filas.
    responder: (sql) =>
      /MAX\("createdAt"\) AS "ultimo"/.test(sql)
        ? [
            { userId: "u-ahora", ultimo: hace(3) },
            { userId: "u-hace-rato", ultimo: hace(45) },
          ]
        : [],
  });
  const persona = (id: string) => ({ id, firstName: id, lastName: "", role: "OWNER", isActive: true });
  const dbConEquipo = Object.assign(db as object, {
    barberUser: { findMany: () => Promise.resolve([persona("u-ahora"), persona("u-hace-rato"), persona("u-nunca")]) },
  });
  const r = await act.actividadDeBarberias(["matriz-a"], null, dbConEquipo as never, AHORA);
  assert.equal(r.disponible, true);
  const enLinea = Object.fromEntries(r.usuarios.map((u) => [u.userId, u.enLinea]));
  assert.deepEqual(enLinea, { "u-ahora": true, "u-hace-rato": false, "u-nunca": false });
});
