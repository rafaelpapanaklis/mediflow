/**
 * Ortodoncia — lectura de las fotos extra y de las vistas sobremordida/resalte
 * (ws1-t12). Cubre lo que verá la clínica ANTES de pegar cada SQL: sin la tabla
 * no hay extras, sin la columna `slotId` las extras se leen como siempre.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npm run test:orto-fotos-juego
 */
import Module from "node:module";
import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Fila = Record<string, unknown>;
const state = {
  intentos: [] as string[],
  respuestas: [] as Array<Fila[] | { code: string; meta?: { code: string } }>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async (strings: TemplateStringsArray) => {
        state.intentos.push(strings.join("?"));
        const r = state.respuestas.shift();
        if (r && !Array.isArray(r)) throw Object.assign(new Error("db"), r);
        return r ?? [];
      },
    },
  },
});

// `require` (no `import()`): el stub de "server-only" engancha Module._load, que es el camino CJS.
// El paquete `server-only` no existe fuera de Next: se pisa DESPUÉS de instalar los mocks
// (el gancho de `mock.module` reemplaza a uno instalado antes).
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown; __so?: boolean };
const cargar = () => {
  if (!M.__so) {
    const original = M._load;
    M._load = function (this: unknown, r: string, p: unknown, m: boolean) {
      return r === "server-only" ? {} : original.call(this, r, p, m);
    };
    M.__so = true;
  }
  return require("../fotos-del-juego-db") as typeof import("../fotos-del-juego-db");
};

const reset = () => {
  state.intentos = [];
  state.respuestas = [];
};
const fila = (extra: Fila = {}): Fila => ({
  id: "e1", photoSetId: "s1", label: null, slotId: null, createdAt: "2026-09-29T10:00:00Z", fileUrl: "c/orthodontics/p/x.jpg", ...extra,
});

test("agrupa por juego, con la vista si la trae, y solo pregunta por la clínica de la sesión", async () => {
  reset();
  const { cargarExtrasDeJuegos } = cargar();
  state.respuestas = [[fila(), fila({ id: "e2", slotId: "resalte" }), fila({ id: "e3", photoSetId: "s2" })]];
  const m = await cargarExtrasDeJuegos("clinic-1", ["s1", "s2"]);
  assert.equal(m.get("s1")!.length, 2);
  assert.equal(m.get("s1")![1]!.slotId, "resalte");
  assert.equal(m.get("s2")!.length, 1);
  assert.match(state.intentos[0]!, /e\."clinicId" = \?/);
  assert.match(state.intentos[0]!, /"removedAt" IS NULL/);
});

test("sin clínica o sin juegos no consulta nada", async () => {
  reset();
  const { cargarExtrasDeJuegos } = cargar();
  assert.equal((await cargarExtrasDeJuegos("", ["s1"])).size, 0);
  assert.equal((await cargarExtrasDeJuegos("clinic-1", [])).size, 0);
  assert.equal(state.intentos.length, 0);
});

test("sin la columna slotId (segundo SQL sin pegar): las extras salen como antes, sin vistas", async () => {
  reset();
  const { cargarExtrasDeJuegos } = cargar();
  const { slotId: _quitada, ...sinSlot } = fila({ label: "Frenillo" });
  state.respuestas = [{ code: "P2010", meta: { code: "42703" } }, [sinSlot]];
  const m = await cargarExtrasDeJuegos("clinic-1", ["s1"]);
  assert.equal(state.intentos.length, 2);
  assert.doesNotMatch(state.intentos[1]!, /slotId/);
  assert.equal(m.get("s1")![0]!.label, "Frenillo");
  assert.equal(m.get("s1")![0]!.slotId, null);
});

test("sin la tabla (primer SQL sin pegar) o con un error de base: ninguna, y no lanza", async () => {
  reset();
  const { cargarExtrasDeJuegos } = cargar();
  state.respuestas = [{ code: "P2010", meta: { code: "42P01" } }];
  assert.equal((await cargarExtrasDeJuegos("clinic-1", ["s1"])).size, 0);
  state.respuestas = [{ code: "P1001" }];
  const antes = console.error;
  console.error = () => {};
  try {
    assert.equal((await cargarExtrasDeJuegos("clinic-1", ["s1"])).size, 0);
  } finally {
    console.error = antes;
  }
});
