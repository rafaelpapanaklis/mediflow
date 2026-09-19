/**
 * Bitácora de LECTURA del expediente — `logRead` (src/lib/audit.ts).
 *
 * Lo que tiene que ser verdad:
 *  1. abrir una ficha deja UNA fila, con el usuario y el id del paciente, y sin
 *     nombre ni dato clínico (el rastro también es dato personal);
 *  2. si el log falla —o se cuelga— la lectura sigue respondiendo;
 *  3. abrir la misma ficha dos veces seguidas (un re-render) no escribe dos veces;
 *     un export sí deja una fila cada vez;
 *  4. sin clinicId no se escribe nada (regla dura (c): undefined no filtra).
 *
 * Corre con: npm run test:audit-lectura
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Fila = { data: Record<string, unknown> };
let filas: Fila[] = [];
let modo: "ok" | "falla" | "colgado" = "ok";

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auditLog: {
        create: (args: Fila) => {
          if (modo === "falla") return Promise.reject(new Error("pooler saturado"));
          if (modo === "colgado") return new Promise(() => {});
          filas.push(args);
          return Promise.resolve({ id: "log_1" });
        },
      },
    },
  },
});
mock.module("@/lib/pediatrics/audit", { namedExports: { PEDIATRIC_AUDIT_ACTIONS: [] } });

const BASE = { clinicId: "cli_1", userId: "usr_1", patientId: "pat_1", ipAddress: "10.0.0.1", userAgent: "UA" };

async function cargar() {
  return import("@/lib/audit");
}

describe("logRead", () => {
  beforeEach(async () => {
    filas = [];
    modo = "ok";
    (await cargar())._resetReadDedupe();
    mock.timers.reset();
  });

  it("abrir una ficha deja UNA fila con usuario e id, sin nombre ni dato clínico", async () => {
    const { logRead } = await cargar();
    await logRead({ ...BASE, kind: "ficha" });

    assert.equal(filas.length, 1);
    const d = filas[0].data;
    assert.equal(d.clinicId, "cli_1");
    assert.equal(d.userId, "usr_1");
    assert.equal(d.entityType, "patient");
    assert.equal(d.entityId, "pat_1");
    assert.equal(d.action, "view");
    assert.deepEqual(d.changes, { _read: { before: null, after: { kind: "ficha" } } });
    // La fila entera solo tiene estas claves: no hay por dónde colar un nombre.
    assert.deepEqual(
      Object.keys(d).sort(),
      ["action", "changes", "clinicId", "entityId", "entityType", "ipAddress", "userAgent", "userId"],
    );
  });

  it("la firma no acepta campos libres: lo que no es id no llega a la fila", async () => {
    const { logRead } = await cargar();
    const conExtra = { ...BASE, kind: "ficha" as const, patientName: "Laura Menéndez", diagnosis: "K02.1" };
    await logRead(conExtra);
    const plano = JSON.stringify(filas[0]);
    assert.ok(!plano.includes("Laura"));
    assert.ok(!plano.includes("K02.1"));
  });

  it("si el insert falla, no tira: la pantalla sigue", async () => {
    const { logRead } = await cargar();
    modo = "falla";
    const err = mock.method(console, "error", () => {});
    await assert.doesNotReject(logRead({ ...BASE, kind: "ficha" }));
    err.mock.restore();
    assert.equal(filas.length, 0);

    // Y el fallo no deja tapado el siguiente intento por el dedupe.
    modo = "ok";
    await logRead({ ...BASE, kind: "ficha" });
    assert.equal(filas.length, 1);
  });

  it("si el insert se cuelga, responde al llegar al tope y no espera más", async () => {
    const { logRead, READ_LOG_TIMEOUT_MS } = await cargar();
    modo = "colgado";
    mock.timers.enable({ apis: ["setTimeout"] });
    let listo = false;
    const p = logRead({ ...BASE, kind: "ficha" }).then(() => { listo = true; });
    await Promise.resolve();
    assert.equal(listo, false);
    const err = mock.method(console, "error", () => {});
    mock.timers.tick(READ_LOG_TIMEOUT_MS);
    await p;
    assert.equal(listo, true);
    assert.equal(err.mock.callCount(), 1); // el tope vencido se avisa, no se calla
    err.mock.restore();
    mock.timers.reset();

    // No se sabe si la fila entró: el dedupe NO debe tapar el siguiente intento.
    modo = "ok";
    await logRead({ ...BASE, kind: "ficha" });
    assert.equal(filas.length, 1);
  });

  it("a un export se le da más margen que a la ficha antes de soltarlo", async () => {
    const { logRead, READ_LOG_TIMEOUT_MS, READ_LOG_EXPORT_TIMEOUT_MS } = await cargar();
    assert.ok(READ_LOG_EXPORT_TIMEOUT_MS > READ_LOG_TIMEOUT_MS);
    modo = "colgado";
    mock.timers.enable({ apis: ["setTimeout"] });
    const err = mock.method(console, "error", () => {});
    let listo = false;
    const p = logRead({ ...BASE, kind: "export_cda" }).then(() => { listo = true; });
    mock.timers.tick(READ_LOG_TIMEOUT_MS);
    await Promise.resolve();
    assert.equal(listo, false);
    mock.timers.tick(READ_LOG_EXPORT_TIMEOUT_MS - READ_LOG_TIMEOUT_MS);
    await p;
    err.mock.restore();
    assert.equal(listo, true);
  });

  it("la misma ficha dos veces seguidas (re-render) escribe una sola vez", async () => {
    const { logRead } = await cargar();
    await logRead({ ...BASE, kind: "ficha" });
    await logRead({ ...BASE, kind: "ficha" });
    await Promise.all([logRead({ ...BASE, kind: "ficha" }), logRead({ ...BASE, kind: "ficha" })]);
    assert.equal(filas.length, 1);
  });

  it("otro usuario u otro paciente SÍ dejan su propia fila", async () => {
    const { logRead } = await cargar();
    await logRead({ ...BASE, kind: "ficha" });
    await logRead({ ...BASE, userId: "usr_2", kind: "ficha" });
    await logRead({ ...BASE, patientId: "pat_2", kind: "ficha" });
    assert.equal(filas.length, 3);
  });

  it("pasada la ventana, volver a abrir la ficha vuelve a escribir", async () => {
    const { logRead, READ_DEDUPE_WINDOW_MS } = await cargar();
    const ahora = mock.method(Date, "now", () => 1_000_000);
    await logRead({ ...BASE, kind: "ficha" });
    ahora.mock.mockImplementation(() => 1_000_000 + READ_DEDUPE_WINDOW_MS);
    await logRead({ ...BASE, kind: "ficha" });
    ahora.mock.restore();
    assert.equal(filas.length, 2);
  });

  it("un export no se deduplica: cada copia que sale deja su fila", async () => {
    const { logRead } = await cargar();
    await logRead({ ...BASE, kind: "export_cda" });
    await logRead({ ...BASE, kind: "export_cda" });
    await logRead({ ...BASE, kind: "export_arco" });
    assert.equal(filas.length, 3);
  });

  it("el PDF de una nota se ancla al paciente y lleva el id de la nota", async () => {
    const { logRead } = await cargar();
    await logRead({ ...BASE, kind: "nota_pdf", recordId: "rec_9" });
    const d = filas[0].data;
    assert.equal(d.entityType, "patient");
    assert.equal(d.entityId, "pat_1");
    assert.deepEqual(d.changes, { _read: { before: null, after: { kind: "nota_pdf", recordId: "rec_9" } } });
  });

  it("sin clinicId, userId o patientId no se escribe nada", async () => {
    const { logRead } = await cargar();
    await logRead({ ...BASE, clinicId: undefined as unknown as string, kind: "ficha" });
    await logRead({ ...BASE, userId: "", kind: "ficha" });
    await logRead({ ...BASE, patientId: "", kind: "ficha" });
    assert.equal(filas.length, 0);
  });
});

describe("readInfo (lo que pintan las dos bitácoras)", () => {
  it("reconoce una lectura y no se rompe con formas raras", async () => {
    const { readInfo, readKindLabel } = await import("@/lib/admin/audit-core");
    assert.deepEqual(readInfo({ _read: { before: null, after: { kind: "ficha" } } }), { kind: "ficha", recordId: null });
    assert.deepEqual(
      readInfo({ _read: { before: null, after: { kind: "nota_pdf", recordId: "rec_9" } } }),
      { kind: "nota_pdf", recordId: "rec_9" },
    );
    for (const raro of [null, undefined, "x", 3, [], {}, { _read: null }, { _read: { after: { kind: 7 } } }, { count: { before: null, after: 2 } }]) {
      assert.equal(readInfo(raro), null);
    }
    const tr = (_k: string, fb: string) => fb;
    assert.equal(readKindLabel("ficha", tr), "Abrió la ficha");
    assert.equal(readKindLabel("constructor", tr), "constructor");
    assert.equal(readKindLabel("algo_nuevo", tr), "algo_nuevo");
  });
});
