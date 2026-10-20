/**
 * El repositorio de PRODUCCIÓN de versiones (db.ts), ejecutado contra una tabla de mentira que entiende las tres
 * sentencias que usa (ws1-t8 · P2 y N-P8). Antes la transacción real no la ejecutaba ninguna prueba.
 *
 * Run: npm run test:plantillas-fabrica-repo (sin --experimental-test-module-mocks: db.ts lleva `server-only`)
 */
process.env.DATABASE_URL = "postgresql://nadie:nada@127.0.0.1:1/ninguna?connection_limit=1";
process.env.DIRECT_URL = process.env.DATABASE_URL;

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Row = Record<string, any>;
const KEY = Symbol.for("dalecontrol.plantillas-fabrica.tabla");

const estado = {
  tablaExiste: true,
  sondaFalla: false,
  preguntas: 0,
  filas: [] as Row[],
  /** Simula que otra petición insertó la vigente justo antes (choque con el índice único). */
  chocarEnElPrimerInsert: false,
  inserts: 0,
};

const texto = (s: TemplateStringsArray) => s.join("?").replace(/\s+/g, " ").trim();

function sql(tx: any) {
  return {
    async $queryRaw(s: TemplateStringsArray, ...v: any[]) {
      const t = texto(s);
      if (/to_regclass\('public\.clinic_template_versions'\)/.test(t)) {
        estado.preguntas++;
        if (estado.sondaFalla) throw new Error("conexión caída");
        return [{ existe: estado.tablaExiste }];
      }
      if (/^SELECT \* FROM "clinic_template_versions" WHERE "clinicId" = \? AND "family" = \? AND "factoryKey" = \? AND "archivedAt" IS NULL FOR UPDATE/.test(t)) {
        const [clinicId, family, key] = v;
        return estado.filas.filter((r) => r.clinicId === clinicId && r.family === family && r.factoryKey === key && r.archivedAt === null).map((r) => ({ ...r }));
      }
      if (/^INSERT INTO "clinic_template_versions" \("id", "clinicId", "family", "factoryKey", "body", "createdById"\) VALUES/.test(t)) {
        estado.inserts++;
        const [id, clinicId, family, key, body, by] = v;
        if (estado.chocarEnElPrimerInsert && estado.inserts === 1) {
          estado.chocarEnElPrimerInsert = false;
          estado.filas.push({ id: "otra", clinicId, family, factoryKey: key, body: "texto de la otra petición", createdById: "u9", createdAt: new Date(), updatedAt: new Date(), archivedAt: null });
          throw Object.assign(new Error("duplicate key value violates unique constraint (23505)"), { code: "P2010", meta: { code: "23505" } });
        }
        if (estado.filas.some((r) => r.clinicId === clinicId && r.family === family && r.factoryKey === key && r.archivedAt === null)) {
          throw Object.assign(new Error("23505"), { meta: { code: "23505" } });
        }
        const fila = { id, clinicId, family, factoryKey: key, body, createdById: by, createdAt: new Date(), updatedAt: new Date(), archivedAt: null };
        estado.filas.push(fila);
        return [{ ...fila }];
      }
      if (/^SELECT \* FROM "clinic_template_versions" WHERE "clinicId" = \? AND "family" = \? AND "archivedAt" IS NULL/.test(t)) {
        const [clinicId, family] = v;
        return estado.filas.filter((r) => r.clinicId === clinicId && r.family === family && r.archivedAt === null).map((r) => ({ ...r }));
      }
      throw new Error(`sentencia no prevista: ${t}`);
    },
    async $executeRaw(s: TemplateStringsArray, ...v: any[]) {
      const t = texto(s);
      if (/^UPDATE "clinic_template_versions" SET "archivedAt" = now\(\), "archivedById" = \?, "updatedAt" = now\(\) WHERE "id" = \? AND "clinicId" = \?/.test(t)) {
        const [by, id, clinicId] = v;
        const r = estado.filas.find((x) => x.id === id && x.clinicId === clinicId);
        if (r) Object.assign(r, { archivedAt: new Date(), archivedById: by });
        return r ? 1 : 0;
      }
      throw new Error(`sentencia no prevista: ${t}`);
    },
  };
}

const fakePrisma = {
  ...sql(null),
  async $transaction(fn: (tx: any) => Promise<any>) {
    // Todo o nada: si algo lanza, se vuelve al estado de antes.
    const antes = estado.filas.map((r) => ({ ...r }));
    try {
      return await fn(sql(null));
    } catch (e) {
      // El choque de unicidad de otra petición NO se deshace (esa fila es de la otra petición).
      const ajena = estado.filas.filter((r) => r.id === "otra");
      estado.filas = [...antes, ...ajena.filter((a) => !antes.some((x) => x.id === a.id))];
      throw e;
    }
  },
};

// db.ts lleva `import "server-only"`, que con --experimental-test-module-mocks no se deja pisar: se parchea
// `Module._load` para ese paquete y para `@/lib/prisma` (como anticipos/anulables-cancelada.test.ts).
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  if (req === "server-only") return {};
  if (req === "@/lib/prisma") return { prisma: fakePrisma };
  return cargaOriginal.call(this, req, ...r);
};

let repo: typeof import("../db").repoVersiones;
let tablaVersionesExiste: typeof import("../db").tablaVersionesExiste;
before(async () => {
  ({ repoVersiones: repo, tablaVersionesExiste } = await import("../db"));
});
beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
  Object.assign(estado, { tablaExiste: true, sondaFalla: false, preguntas: 0, filas: [], chocarEnElPrimerInsert: false, inserts: 0 });
});

const base = { clinicId: "c1", familia: "HOJA_INDICACIONES" as const, clave: "extraccion", userId: "u1" };

test("guardar: la primera vez inserta; con el mismo texto no hace nada; con otro texto ARCHIVA la vigente e inserta la nueva", async () => {
  await repo.guardar({ ...base, cuerpo: "lunes" });
  await repo.guardar({ ...base, cuerpo: "lunes" });
  assert.equal(estado.filas.length, 1);
  await repo.guardar({ ...base, cuerpo: "martes" });
  assert.equal(estado.filas.length, 2);
  const lunes = estado.filas.find((r) => r.body === "lunes")!;
  const martes = estado.filas.find((r) => r.body === "martes")!;
  assert.ok(lunes.archivedAt instanceof Date, "el texto del lunes se archivó, no se pisó");
  assert.equal(lunes.archivedById, "u1");
  assert.equal(martes.archivedAt, null);
  assert.equal(estado.filas.filter((r) => r.archivedAt === null).length, 1, "una sola vigente");
});

test("guardar: dos primeras ediciones a la vez → la que pierde reintenta, archiva la ganadora y no pierde ninguna", async () => {
  estado.chocarEnElPrimerInsert = true;
  const r = await repo.guardar({ ...base, cuerpo: "mi texto" });
  assert.equal(r.cuerpo, "mi texto");
  assert.equal(estado.filas.length, 2);
  const ajena = estado.filas.find((x) => x.id === "otra")!;
  assert.ok(ajena.archivedAt instanceof Date, "el texto de la otra petición quedó archivado");
  assert.equal(estado.filas.filter((x) => x.archivedAt === null).length, 1);
});

test("guardar y listar llevan el clinicId: la versión de una clínica no aparece en otra", async () => {
  await repo.guardar({ ...base, cuerpo: "de c1" });
  assert.deepEqual((await repo.activas("c2", "HOJA_INDICACIONES")).map((v) => v.cuerpo), []);
  assert.deepEqual((await repo.activas("c1", "HOJA_INDICACIONES")).map((v) => v.cuerpo), ["de c1"]);
  await assert.rejects(() => repo.guardar({ ...base, clinicId: "", cuerpo: "x" }));
});

test("N-P8: un fallo de la base al preguntar si existe la tabla NO es «no existe»: se propaga y no se memoriza", async () => {
  estado.sondaFalla = true;
  await assert.rejects(() => tablaVersionesExiste(), /conexión caída/);
  await assert.rejects(() => repo.activas("c1", "ORTO_NOTA"), /conexión caída/);
  estado.sondaFalla = false;
  assert.equal(await tablaVersionesExiste(), true, "al volver la base responde de verdad, sin esperar minutos");
});

test("N-P8: «no existe» se recuerda poco (1 min) y tras pegar el SQL se enciende sola", async () => {
  estado.tablaExiste = false;
  const reloj = mock.method(Date, "now", () => 1_000_000);
  assert.equal(await tablaVersionesExiste(), false);
  assert.equal(await tablaVersionesExiste(), false);
  assert.equal(estado.preguntas, 1, "dentro del minuto no vuelve a preguntar");
  estado.tablaExiste = true; // Rafael pegó el SQL
  reloj.mock.mockImplementation(() => 1_000_000 + 61_000);
  assert.equal(await tablaVersionesExiste(), true);
  assert.equal(estado.preguntas, 2);
  reloj.mock.mockImplementation(() => 1_000_000 + 10 * 3_600_000);
  assert.equal(await tablaVersionesExiste(), true);
  assert.equal(estado.preguntas, 2, "una vez que existe no se vuelve a preguntar");
  reloj.mock.restore();
});

test("sin la tabla, activas() no consulta la tabla: [] y una sola pregunta", async () => {
  estado.tablaExiste = false;
  assert.deepEqual(await repo.activas("c1", "ORTO_NOTA"), []);
  assert.deepEqual(await repo.activas("c1", "ORTO_NOTA"), []);
  assert.equal(estado.preguntas, 1);
});
