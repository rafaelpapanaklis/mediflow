// Ortodoncia — la siembra del catálogo no duplica con dos cargas a la vez
// (ws1-t4 ronda 6: el catálogo de Rafael Clinica quedó sembrado dos veces).
// Doble de la base en memoria: `pg_advisory_xact_lock` se comporta como en
// Postgres (la segunda transacción espera a que la primera termine).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ORTHO_PROCEDURES,
  llaveDeSiembra,
  sembrarProcedimientosDeOrtodoncia,
  type DbDeSiembra,
  type TxDeSiembra,
} from "../catalog-procedures";

type Fila = { clinicId: string; name: string; code: string | null; category: string };

function baseFalsa(opts: { candadoReal: boolean }) {
  const filas: Fila[] = [];
  const bitacora: string[] = [];
  const colas = new Map<string, Promise<void>>();
  const espera = () => new Promise((r) => setTimeout(r, 5));

  const db: DbDeSiembra = {
    async $transaction<T>(fn: (tx: TxDeSiembra) => Promise<T>): Promise<T> {
      let soltar: () => void = () => {};
      const tx: TxDeSiembra = {
        async $executeRaw(consulta: TemplateStringsArray, ...valores: unknown[]) {
          const sql = consulta.join("?");
          bitacora.push(sql.includes("pg_advisory_xact_lock") ? `candado:${String(valores[0])}` : sql);
          if (opts.candadoReal && sql.includes("pg_advisory_xact_lock")) {
            const llave = String(valores[0]);
            const anterior = colas.get(llave) ?? Promise.resolve();
            let liberar!: () => void;
            const mia = new Promise<void>((r) => (liberar = r));
            colas.set(llave, anterior.then(() => mia));
            await anterior;
            soltar = liberar;
          }
          return 1;
        },
        procedureCatalog: {
          async findMany({ where }) {
            bitacora.push("leer");
            await espera(); // da tiempo a que la otra carga lea también
            return filas
              .filter((f) => f.clinicId === where.clinicId && (f.category === "orthodontics" || f.code === "ORTO_CONTROL"))
              .map((f) => ({ name: f.name, code: f.code }));
          },
          async createMany({ data }) {
            bitacora.push("insertar");
            await espera();
            for (const d of data) filas.push(d as unknown as Fila);
            return { count: data.length };
          },
        },
      };
      try {
        return await fn(tx);
      } finally {
        soltar();
      }
    },
  };
  return { db, filas, bitacora };
}

const sinFlags = async () => {};
const CLINICA = "cmn6soeaw0000t17xgljxc2iq";

test("dos cargas a la vez siembran UNA sola vez", async () => {
  const { db, filas } = baseFalsa({ candadoReal: true });
  const [a, b] = await Promise.all([
    sembrarProcedimientosDeOrtodoncia(CLINICA, db, sinFlags),
    sembrarProcedimientosDeOrtodoncia(CLINICA, db, sinFlags),
  ]);
  assert.equal(a.creados + b.creados, DEFAULT_ORTHO_PROCEDURES.length);
  assert.ok(a.creados === 0 || b.creados === 0, "una de las dos no siembra nada");
  const nombres = filas.map((f) => f.name);
  assert.equal(new Set(nombres).size, nombres.length, "ningún nombre repetido");
});

test("sin el candado, el doble reproduce el fallo (así se sabe que el test mide algo)", async () => {
  const { db, filas } = baseFalsa({ candadoReal: false });
  await Promise.all([
    sembrarProcedimientosDeOrtodoncia(CLINICA, db, sinFlags),
    sembrarProcedimientosDeOrtodoncia(CLINICA, db, sinFlags),
  ]);
  assert.equal(filas.length, DEFAULT_ORTHO_PROCEDURES.length * 2);
});

test("el candado es por clínica y va ANTES de leer", async () => {
  const { db, bitacora } = baseFalsa({ candadoReal: true });
  await sembrarProcedimientosDeOrtodoncia(CLINICA, db, sinFlags);
  assert.deepEqual(bitacora.slice(0, 3), [`candado:${llaveDeSiembra(CLINICA)}`, "leer", "insertar"]);
  assert.notEqual(llaveDeSiembra("a"), llaveDeSiembra("b"));
});

test("una segunda carga posterior no siembra nada, y sin clínica no se toca la base", async () => {
  const { db, filas, bitacora } = baseFalsa({ candadoReal: true });
  await sembrarProcedimientosDeOrtodoncia(CLINICA, db, sinFlags);
  assert.deepEqual(await sembrarProcedimientosDeOrtodoncia(CLINICA, db, sinFlags), { creados: 0 });
  assert.equal(filas.length, DEFAULT_ORTHO_PROCEDURES.length);
  const antes = bitacora.length;
  assert.deepEqual(await sembrarProcedimientosDeOrtodoncia("", db, sinFlags), { creados: 0 });
  assert.equal(bitacora.length, antes);
});

test("el SQL de duplicados desactiva sin borrar, solo en Rafael Clinica y la de prueba", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const leerSql = (n: string) =>
    readFileSync(join(__dirname, "../../../../sql", n), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
  const dup = leerSql("ortodoncia-catalogo-duplicados.sql");
  assert.match(dup, /SET "isActive" = false/);
  assert.match(dup, /"clinicId" IN \('cmn6soeaw0000t17xgljxc2iq', 'clinica_qa_prueba'\)/);
  assert.doesNotMatch(dup, /\bDELETE\b|\bDROP\b|\bDO\s+\$\$/i);
  // Se queda activo el más antiguo de cada nombre.
  assert.match(dup, /\(q\."createdAt", q\."id"\) < \(p\."createdAt", p\."id"\)/);
  // El renombrado toca uno solo por clínica, para no crear dos con el nombre nuevo.
  const ren = leerSql("ortodoncia-nombres-catalogo.sql");
  assert.equal((ren.match(/LIMIT 1/g) ?? []).length, 2);
});
