// ws1-t9 (auditoría BEVADENT, M1-M4): la capa de base de lo nuevo de la hoja. Sin el SQL de ws1-t9 pegado, nada consulta
// las tablas/columnas que no existen (una sola pregunta a to_regclass/information_schema, recordada en globalThis: los
// `relation … does not exist` llenaban los logs de producción, ver tablas-nuevas-sin-sql). Con el SQL, toda lectura y
// escritura lleva el `clinicId` de la sesión.

import { afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { normalizarCatalogos } from "../hoja-catalogos";

type Consulta = { sql: string; valores: unknown[] };
const estado = {
  consultas: [] as Consulta[],
  partes: { ligas: false, mecanicas: false, arcoInferior: false, catalogos: false },
  filas: [] as unknown[],
};

function texto(q: unknown): Consulta {
  // Prisma.sql / plantilla etiquetada → el texto y sus valores.
  const o = q as { strings?: readonly string[]; sql?: string; values?: unknown[] };
  if (Array.isArray(o)) return { sql: (o as unknown as string[]).join("?"), valores: [] };
  return { sql: o.sql ?? (o.strings ?? []).join("?"), valores: o.values ?? [] };
}

function raw(strings: TemplateStringsArray | unknown, ...valores: unknown[]): Promise<unknown[]> {
  const c = Array.isArray(strings) ? { sql: (strings as readonly string[]).join("?"), valores } : texto(strings);
  estado.consultas.push(c);
  if (/to_regclass/.test(c.sql)) return Promise.resolve([estado.partes]);
  return Promise.resolve(estado.filas);
}

const db = {
  $queryRaw: raw,
  $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => {
    estado.consultas.push({ sql: s.join("?"), valores: v });
    return Promise.resolve(1);
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  orthoWireStep: { findFirst: async () => ({ id: "w1" }) },
  orthodonticsClinicSettings: { upsert: async () => ({}) },
};

mock.module("@/lib/prisma", { namedExports: { prisma: db } });

let m: typeof import("../hoja-extras-db");
before(async () => {
  m = await import("../hoja-extras-db");
});

afterEach(() => {
  estado.consultas = [];
  estado.filas = [];
  m._olvidarPartesDeHoja();
});

describe("sin el SQL de ws1-t9", () => {
  it("diez lecturas = UNA pregunta y ninguna consulta a las tablas nuevas", async () => {
    estado.partes = { ligas: false, mecanicas: false, arcoInferior: false, catalogos: false };
    for (let i = 0; i < 10; i++) {
      assert.deepEqual([...(await m.leerLigasDeHojas("clinica-1", ["c1"])).entries()], []);
      assert.deepEqual(await m.listarMecanicasDelCaso("clinica-1", "plan-1"), []);
      assert.deepEqual([...(await m.leerArcosInferiores("clinica-1", ["c1"])).entries()], []);
      const cat = await m.leerCatalogosDeHoja("clinica-1");
      assert.equal(cat.columna, false);
    }
    assert.equal(estado.consultas.length, 1);
    assert.match(estado.consultas[0].sql, /to_regclass\('public\.ortho_card_ligatures'\)/);
    assert.ok(!estado.consultas.some((c) => /FROM "ortho_card_ligatures"|FROM "ortho_aux_devices"|"wireToLowerId" FROM|"hojaCatalogos" FROM/.test(c.sql)));
  });

  it("guardar no escribe nada y lo dice", async () => {
    estado.partes = { ligas: false, mecanicas: false, arcoInferior: false, catalogos: false };
    assert.equal(await m.escribirLigasDeHoja({ clinicId: "clinica-1", patientId: "p", planId: "plan-1", cardId: "c1", ligas: [{ tipo: "Elástica", arcada: "AMBAS" }] }), false);
    assert.equal(await m.escribirArcoInferior({ clinicId: "clinica-1", planId: "plan-1", cardId: "c1", wireToLowerId: "w1" }), false);
    assert.equal(await m.crearMecanica({ clinicId: "clinica-1", patientId: "p", planId: "plan-1", userId: "u", cardId: null, alta: { tipo: "Cadeneta", arcada: null, ubicacion: null, nota: null, colocadaEl: new Date() } }), null);
    assert.equal((await m.guardarCatalogosDeHoja("clinica-1", "u", normalizarCatalogos(null))).ok, false);
    assert.ok(!estado.consultas.some((c) => /INSERT|UPDATE|DELETE/.test(c.sql)));
  });
});

describe("con el SQL de ws1-t9", () => {
  it("las lecturas filtran por la clínica de la sesión", async () => {
    estado.partes = { ligas: true, mecanicas: true, arcoInferior: true, catalogos: true };
    estado.filas = [{ cardId: "c1", tipo: "Elástica", color: "Gris", arcada: "SUPERIOR", cambiadasHoy: true }];
    const ligas = await m.leerLigasDeHojas("clinica-1", ["c1"]);
    assert.deepEqual(ligas.get("c1"), [{ tipo: "Elástica", color: "Gris", arcada: "SUPERIOR", cambiadasHoy: true }]);
    estado.filas = [];
    await m.listarMecanicasDelCaso("clinica-1", "plan-1");
    await m.leerArcosInferiores("clinica-1", ["c1"]);
    const lecturas = estado.consultas.filter((c) => !/to_regclass/.test(c.sql));
    assert.equal(lecturas.length, 3);
    for (const c of lecturas) {
      assert.match(c.sql, /"clinicId" = \?/);
      assert.ok(c.valores.includes("clinica-1"), c.sql);
    }
  });

  it("las ligas se sustituyen: borra las de la hoja (de esa clínica) e inserta las de la pantalla", async () => {
    estado.partes = { ligas: true, mecanicas: true, arcoInferior: true, catalogos: true };
    const ok = await m.escribirLigasDeHoja({
      clinicId: "clinica-1",
      patientId: "p",
      planId: "plan-1",
      cardId: "c1",
      ligas: [
        { tipo: "Elástica", color: "Gris", arcada: "SUPERIOR", cambiadasHoy: true },
        { tipo: "Autoligado (sin ligas)", color: "Rojo", arcada: "INFERIOR", cambiadasHoy: false },
      ],
    });
    assert.equal(ok, true);
    const escrituras = estado.consultas.filter((c) => /DELETE|INSERT/.test(c.sql));
    assert.equal(escrituras.length, 3);
    assert.match(escrituras[0].sql, /DELETE FROM "ortho_card_ligatures" WHERE "cardId" = \? AND "clinicId" = \?/);
    assert.deepEqual(escrituras[0].valores, ["c1", "clinica-1"]);
    // El autoligado no guarda color.
    assert.ok(escrituras[2].valores.includes(null));
    assert.ok(!escrituras[2].valores.includes("Rojo"));
  });

  it("retirar solo toca una mecánica ACTIVA de ese caso y esa clínica", async () => {
    estado.partes = { ligas: true, mecanicas: true, arcoInferior: true, catalogos: true };
    await m.retirarMecanica({ clinicId: "clinica-1", planId: "plan-1", id: "m1", userId: "u", cardId: null, fecha: new Date() });
    const u = estado.consultas.find((c) => /UPDATE "ortho_aux_devices"/.test(c.sql));
    assert.ok(u);
    assert.match(u!.sql, /"clinicId" = \? AND "treatmentPlanId" = \? AND "retiradaEl" IS NULL/);
  });
});
