/**
 * Ortodoncia — «Quitar foto» y fotos extra de un juego (ws1-t12).
 * Cubre: (1) quitar NO borra: libera la vista y anota quién/cuándo/motivo, sin
 * tocar el archivo; (2) todo por la clínica de la sesión y solo pacientes
 * visibles; (3) sin la tabla (SQL sin pegar) avisa y NO toca el juego;
 * (4) la extra se MARCA (UPDATE removedAt), nunca DELETE.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npm run test:orto-fotos-juego
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Llamada = { sql: string; values: unknown[] };

const CLINICA = "clinic-1";
const state = {
  set: null as Record<string, unknown> | null,
  visible: true,
  archivo: { clinicId: CLINICA, patientId: "p1" } as { clinicId: string; patientId: string } | null,
  updateManyCount: 1,
  rawThrows: null as { code: string } | null,
  rawCount: 1,
  extrasVigentes: 0,
  queryCounts: null as number[] | null,
  findFirstWheres: [] as Array<Record<string, unknown>>,
  updateManyArgs: [] as Array<Record<string, unknown>>,
  raws: [] as Llamada[],
  audits: [] as Array<Record<string, unknown>>,
  txAbiertas: 0,
};

function juego(extra: Record<string, unknown> = {}) {
  return { id: "set-1", clinicId: CLINICA, patientId: "p1", photoFrontalId: "file-1", photoSmileId: null, ...extra };
}

function raw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
  state.raws.push({ sql: strings.join("?"), values });
  if (state.rawThrows) {
    const e = new Error("relation does not exist") as Error & { code: string };
    e.code = state.rawThrows.code;
    return Promise.reject(e);
  }
  return Promise.resolve(state.rawCount);
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthoPhotoSet: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          state.findFirstWheres.push(args.where);
          return state.set && args.where.clinicId === state.set.clinicId ? state.set : null;
        },
      },
      patientFile: { findFirst: async () => state.archivo },
      $executeRaw: raw,
      $queryRaw: async () => [{ n: state.queryCounts ? (state.queryCounts.shift() ?? 0) : state.extrasVigentes }],
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        state.txAbiertas++;
        return cb({
          orthoPhotoSet: {
            updateMany: async (args: Record<string, unknown>) => {
              state.updateManyArgs.push(args);
              return { count: state.updateManyCount };
            },
          },
          $executeRaw: raw,
        });
      },
    },
  },
});

mock.module("../_helpers", {
  namedExports: {
    getOrthoActionContext: async () => ({
      ok: true,
      data: { ctx: { clinicId: CLINICA, userId: "user-1", role: "DOCTOR" } },
    }),
    auditOrtho: async (args: Record<string, unknown>) => {
      state.audits.push(args);
    },
  },
});

mock.module("@/lib/patient-visibility", {
  namedExports: { canViewPatient: async () => state.visible },
});

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

function reset() {
  state.set = juego();
  state.visible = true;
  state.archivo = { clinicId: CLINICA, patientId: "p1" };
  state.updateManyCount = 1;
  state.rawThrows = null;
  state.rawCount = 1;
  state.extrasVigentes = 0;
  state.queryCounts = null;
  state.findFirstWheres = [];
  state.updateManyArgs = [];
  state.raws = [];
  state.audits = [];
  state.txAbiertas = 0;
}

test("quitar una vista: la libera, anota quién y por qué, y no borra nada", async () => {
  reset();
  const { quitarFotoDeVista } = await import("../fotosDelJuego");
  const r = await quitarFotoDeVista({ setId: "set-1", slotId: "normal", motivo: "  no era   el paciente  " });
  assert.equal(r.ok, true);
  // Libera SOLO si sigue siendo esa foto, y solo en la clínica de la sesión.
  assert.deepEqual(state.updateManyArgs[0], {
    where: { id: "set-1", clinicId: CLINICA, photoFrontalId: "file-1" },
    data: { photoFrontalId: null },
  });
  // Bitácora: clínica de la sesión, set, vista, archivo, usuario de la sesión y motivo limpio.
  const log = state.raws[0]!;
  assert.match(log.sql, /INSERT INTO "ortho_photo_removals"/);
  assert.ok(log.values.includes(CLINICA) && log.values.includes("set-1") && log.values.includes("file-1"));
  assert.ok(log.values.includes("user-1") && log.values.includes("normal"));
  assert.ok(log.values.includes("no era el paciente"));
  // Ni DELETE del archivo ni de la fila.
  assert.ok(state.raws.every((q) => !/DELETE/i.test(q.sql)));
  assert.equal(state.audits.length, 1);
});

test("quitar: motivo vacío o basura se guarda como null; el archivo se toma del servidor, no del cliente", async () => {
  reset();
  const { quitarFotoDeVista } = await import("../fotosDelJuego");
  const r = await quitarFotoDeVista({ setId: "set-1", slotId: "normal", motivo: "   ", fileId: "file-AJENO" } as never);
  assert.equal(r.ok, true);
  assert.ok(state.raws[0]!.values.includes(null));
  assert.ok(!state.raws[0]!.values.includes("file-AJENO"));
});

test("quitar: juego de otra clínica o paciente que no puede ver → «no encontrado» y no se toca nada", async () => {
  reset();
  const { quitarFotoDeVista } = await import("../fotosDelJuego");
  state.set = juego({ clinicId: "otra-clinica" });
  let r = await quitarFotoDeVista({ setId: "set-1", slotId: "normal" });
  assert.equal(r.ok, false);
  assert.equal(state.findFirstWheres[0]!.clinicId, CLINICA);
  assert.equal(state.txAbiertas, 0);

  reset();
  state.visible = false;
  r = await quitarFotoDeVista({ setId: "set-1", slotId: "normal" });
  assert.deepEqual(r, { ok: false, error: "Set fotográfico no encontrado" });
  assert.equal(state.txAbiertas, 0);
});

test("quitar: vistas sin columna, desconocidas o ya vacías fallan sin tocar nada", async () => {
  reset();
  const { quitarFotoDeVista } = await import("../fotosDelJuego");
  for (const slotId of ["no-existe", "photoFrontalId", "constructor", ""]) {
    const r = await quitarFotoDeVista({ setId: "set-1", slotId });
    assert.equal(r.ok, false, slotId);
  }
  const vacia = await quitarFotoDeVista({ setId: "set-1", slotId: "sonrisa" });
  assert.deepEqual(vacia, { ok: false, error: "Esa vista ya no tiene foto" });
  assert.equal(state.txAbiertas, 0);
});

test("sobremordida y resalte: su foto es una fila de extras con slotId; se sube una sola por vista", async () => {
  reset();
  const { agregarFotoExtra } = await import("../fotosDelJuego");
  state.queryCounts = [0];
  const r = await agregarFotoExtra({ setId: "set-1", fileId: "file-9", slot: "sobremordida", etiqueta: "no debe guardarse" });
  assert.equal(r.ok, true);
  const insert = state.raws.find((q) => /INSERT INTO "ortho_photo_extras"/.test(q.sql))!;
  assert.match(insert.sql, /"slotId"/);
  assert.ok(insert.values.includes("sobremordida") && insert.values.includes(CLINICA) && insert.values.includes("user-1"));
  assert.ok(!insert.values.includes("no debe guardarse"), "la foto de una vista no lleva etiqueta");

  // Ya hay una vigente en esa vista: hay que quitarla primero.
  reset();
  state.queryCounts = [1];
  const otra = await agregarFotoExtra({ setId: "set-1", fileId: "file-9", slot: "resalte" });
  assert.equal(otra.ok, false);
  assert.match((otra as { error: string }).error, /quítala primero/);
  assert.equal(state.raws.length, 0);

  // Solo esas dos vistas; ni las de columna ni basura.
  for (const slot of ["normal", "lat_der", "constructor", "x"]) {
    reset();
    state.queryCounts = [0];
    assert.equal((await agregarFotoExtra({ setId: "set-1", fileId: "file-9", slot })).ok, false, slot);
    assert.equal(state.raws.length, 0, slot);
  }

  // Sin la columna (segundo SQL sin pegar): aviso claro y nada se guarda.
  reset();
  state.queryCounts = [0];
  state.rawThrows = { code: "42703" };
  const sin = await agregarFotoExtra({ setId: "set-1", fileId: "file-9", slot: "resalte" });
  assert.equal(sin.ok, false);
  assert.match((sin as { error: string }).error, /Sobremordida y resalte todavía no se pueden guardar/);
  assert.equal(state.audits.length, 0);
});

test("quitar sobremordida/resalte: se MARCA la fila de extras de esa vista (no se borra) y solo en su clínica y juego", async () => {
  reset();
  const { quitarFotoDeVista } = await import("../fotosDelJuego");
  const r = await quitarFotoDeVista({ setId: "set-1", slotId: "resalte", motivo: "  borrosa " });
  assert.equal(r.ok, true);
  assert.equal(state.txAbiertas, 0, "no toca las columnas del juego");
  const q = state.raws[0]!;
  assert.match(q.sql, /UPDATE "ortho_photo_extras"/);
  assert.match(q.sql, /"slotId" = \?/);
  assert.match(q.sql, /"removedAt" IS NULL/);
  assert.doesNotMatch(q.sql, /DELETE/i);
  assert.ok(q.values.includes(CLINICA) && q.values.includes("set-1") && q.values.includes("resalte"));
  assert.ok(q.values.includes("user-1") && q.values.includes("borrosa"));
  assert.equal(state.audits.length, 1);

  reset();
  state.rawCount = 0;
  const ya = await quitarFotoDeVista({ setId: "set-1", slotId: "sobremordida" });
  assert.deepEqual(ya, { ok: false, error: "Esa vista ya no tiene foto" });

  reset();
  state.set = juego({ clinicId: "otra-clinica" });
  assert.equal((await quitarFotoDeVista({ setId: "set-1", slotId: "resalte" })).ok, false);
  assert.equal(state.raws.length, 0);
});

test("quitar: si la foto cambió entre tanto no se pisa; si falta la tabla avisa y no audita", async () => {
  reset();
  const { quitarFotoDeVista } = await import("../fotosDelJuego");
  state.updateManyCount = 0;
  let r = await quitarFotoDeVista({ setId: "set-1", slotId: "normal" });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /ya cambió/);
  assert.equal(state.raws.length, 0, "sin liberar no se anota nada");

  reset();
  state.rawThrows = { code: "42P01" };
  r = await quitarFotoDeVista({ setId: "set-1", slotId: "normal" });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /todavía no está disponible/);
  assert.equal(state.audits.length, 0);
});

test("foto extra: se registra con etiqueta limpia y solo si el archivo es del mismo paciente y clínica", async () => {
  reset();
  const { agregarFotoExtra } = await import("../fotosDelJuego");
  const r = await agregarFotoExtra({ setId: "set-1", fileId: "file-9", etiqueta: "  Frenillo \n del 21 " });
  assert.equal(r.ok, true);
  const insert = state.raws.find((q) => /INSERT INTO "ortho_photo_extras"/.test(q.sql))!;
  assert.ok(insert.values.includes(CLINICA) && insert.values.includes("user-1"));
  assert.ok(insert.values.includes("Frenillo del 21"));

  reset();
  state.archivo = { clinicId: CLINICA, patientId: "otro-paciente" };
  const ajeno = await agregarFotoExtra({ setId: "set-1", fileId: "file-9" });
  assert.equal(ajeno.ok, false);
  assert.equal(state.raws.length, 0);

  reset();
  state.archivo = null;
  assert.equal((await agregarFotoExtra({ setId: "set-1", fileId: "file-9" })).ok, false);
});

test("foto extra: hay tope por juego y sin la tabla avisa", async () => {
  reset();
  const { agregarFotoExtra } = await import("../fotosDelJuego");
  state.extrasVigentes = 30;
  const tope = await agregarFotoExtra({ setId: "set-1", fileId: "file-9" });
  assert.equal(tope.ok, false);
  assert.match((tope as { error: string }).error, /hasta 30/);

  reset();
  state.rawThrows = { code: "42P01" };
  const sin = await agregarFotoExtra({ setId: "set-1", fileId: "file-9" });
  assert.equal(sin.ok, false);
  assert.match((sin as { error: string }).error, /todavía no está disponible/);
});

test("quitar una extra: se MARCA (removedAt, quién, motivo), nunca se borra, y solo en su clínica y juego", async () => {
  reset();
  const { quitarFotoExtra } = await import("../fotosDelJuego");
  const r = await quitarFotoExtra({ setId: "set-1", extraId: "ex-1", motivo: "borrosa" });
  assert.equal(r.ok, true);
  const q = state.raws[0]!;
  assert.match(q.sql, /UPDATE "ortho_photo_extras"/);
  assert.match(q.sql, /"removedAt" = now\(\)/);
  assert.match(q.sql, /"removedAt" IS NULL/, "no se «quita» dos veces");
  assert.doesNotMatch(q.sql, /DELETE/i);
  assert.ok(q.values.includes(CLINICA) && q.values.includes("set-1") && q.values.includes("ex-1"));
  assert.ok(q.values.includes("user-1") && q.values.includes("borrosa"));

  reset();
  state.rawCount = 0;
  const ya = await quitarFotoExtra({ setId: "set-1", extraId: "ex-1" });
  assert.deepEqual(ya, { ok: false, error: "Esa foto extra ya no está" });
});
