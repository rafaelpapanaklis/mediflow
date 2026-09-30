/**
 * Movimientos del paciente — UNA fila por acción del usuario (ws1-t12, revisión final).
 *
 * Lo que tiene que ser verdad:
 *  1. una acción que deja UNA fila, la deja como siempre (sin resumen);
 *  2. una acción que deja varias las conserva TODAS en la bitácora (marcadas `soloBitacora`, con su diff) y agrega UNA
 *     fila-resumen visible con la frase de cada una;
 *  3. las filas sin paciente no se retienen; fuera de un alcance nada se retiene;
 *  4. un paso de una acción más grande (`conMovimientosSoloDeBitacora`) no escribe resumen;
 *  5. si la acción falla a medias las filas escritas hasta ahí se conservan y el error sigue subiendo;
 *  6. la lista de Movimientos no muestra las filas `soloBitacora`.
 *
 * Corre con: npm run test:movimientos-paciente
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FilaBitacora } from "../fila";
import {
  armarResumen,
  conMovimientosSoloDeBitacora,
  conUnSoloMovimiento,
  esPasoDeOtraAccion,
  redactarResumen,
  retenerSiHayAlcance,
} from "../una-accion";

function fila(parcial: Partial<FilaBitacora> & { texto?: string }): FilaBitacora {
  const { texto, ...resto } = parcial;
  return {
    clinicId: "cli_1",
    userId: "usr_1",
    entityType: "OrthodonticTreatmentPlan",
    entityId: "plan_1",
    action: "ortho.treatmentPlan.created",
    changes: texto ? { _mov: { before: null, after: { texto } } } : null,
    patientId: "pat_1",
    ...resto,
  };
}

const marcada = (f: FilaBitacora): boolean =>
  ((f.changes?._mov as { after?: { soloBitacora?: boolean } } | undefined)?.after?.soloBitacora) === true;
const textoDe = (f: FilaBitacora): string => (f.changes!._mov as { after: { texto: string } }).after.texto;

describe("conUnSoloMovimiento", () => {
  it("una sola fila se escribe como siempre, sin resumen ni marca", async () => {
    const escritas: FilaBitacora[] = [];
    const valor = await conUnSoloMovimiento({ escritor: async (f) => void escritas.push(f) }, async () => {
      assert.equal(retenerSiHayAlcance(fila({ texto: "Actualizó el plan" })), true);
      return "listo";
    });
    assert.equal(valor, "listo");
    assert.equal(escritas.length, 1);
    assert.equal(marcada(escritas[0]!), false);
    assert.equal(textoDe(escritas[0]!), "Actualizó el plan");
  });

  it("varias filas: todas quedan en la bitácora (marcadas) y UNA visible dice todo", async () => {
    const escritas: FilaBitacora[] = [];
    await conUnSoloMovimiento({ titulo: "Abrió el caso de ortodoncia", escritor: async (f) => void escritas.push(f) }, async () => {
      retenerSiHayAlcance(fila({ texto: "Creó el plan de tratamiento de ortodoncia" }));
      retenerSiHayAlcance(fila({ entityType: "orthodontic-plan", action: "update", texto: "Completó el plan de tratamiento de ortodoncia: controles previstos" }));
    });
    assert.equal(escritas.length, 3);
    const visibles = escritas.filter((f) => !marcada(f));
    assert.equal(visibles.length, 1, "una sola fila visible por acción");
    assert.equal(escritas.filter(marcada).length, 2, "las dos originales se conservan, marcadas");
    assert.equal(
      textoDe(visibles[0]!),
      "Abrió el caso de ortodoncia: Creó el plan de tratamiento de ortodoncia · Completó el plan de tratamiento de ortodoncia: controles previstos",
    );
    const detalle = (visibles[0]!.changes!._mov as { after: { detalle: string[]; esResumen: boolean } }).after;
    assert.equal(detalle.esResumen, true);
    assert.equal(detalle.detalle.length, 2, "el detalle no se pierde");
    assert.equal(visibles[0]!.patientId, "pat_1");
    assert.equal(visibles[0]!.clinicId, "cli_1");
    assert.equal(visibles[0]!.userId, "usr_1");
  });

  it("las filas originales conservan su diff completo (rastro legal)", async () => {
    const escritas: FilaBitacora[] = [];
    const conDiff = fila({ texto: "A", changes: { anclajeSuperior: { before: null, after: "MAXIMO" }, _mov: { before: null, after: { texto: "A" } } } });
    await conUnSoloMovimiento({ escritor: async (f) => void escritas.push(f) }, async () => {
      retenerSiHayAlcance(conDiff);
      retenerSiHayAlcance(fila({ texto: "B" }));
    });
    const original = escritas.find((f) => marcada(f) && textoDe(f) === "A")!;
    assert.deepEqual(original.changes!.anclajeSuperior, { before: null, after: "MAXIMO" });
  });

  it("una acción con detalle de OTRA llamada se escribe con resumen aunque solo tenga una fila", async () => {
    const escritas: FilaBitacora[] = [];
    await conUnSoloMovimiento(
      { titulo: "Abrió el caso de ortodoncia", detallesExtra: ["Registró el diagnóstico de ortodoncia"], escritor: async (f) => void escritas.push(f) },
      async () => void retenerSiHayAlcance(fila({ texto: "Creó el plan de tratamiento de ortodoncia" })),
    );
    const visible = escritas.filter((f) => !marcada(f));
    assert.equal(visible.length, 1);
    assert.equal(textoDe(visible[0]!), "Abrió el caso de ortodoncia: Registró el diagnóstico de ortodoncia · Creó el plan de tratamiento de ortodoncia");
  });

  it("abrir a plazos: cinco filas de cuatro llamadas terminan en UNA visible («Abrió el caso de ortodoncia: …»)", async () => {
    const escritas: FilaBitacora[] = [];
    // 1-3: diagnóstico y plan, en llamadas anteriores, solo bitácora.
    await conMovimientosSoloDeBitacora(async () => void retenerSiHayAlcance(fila({ texto: "Registró el diagnóstico de ortodoncia" })), async (f) => void escritas.push(f));
    await conMovimientosSoloDeBitacora(async () => {
      retenerSiHayAlcance(fila({ texto: "Creó el plan de tratamiento de ortodoncia" }));
      retenerSiHayAlcance(fila({ texto: "Completó el plan de tratamiento de ortodoncia: controles previstos" }));
    }, async (f) => void escritas.push(f));
    // 4-5: el plan de pago cierra la apertura.
    await conUnSoloMovimiento(
      { titulo: "Abrió el caso de ortodoncia", detallesExtra: ["Registró el diagnóstico de ortodoncia", "Creó el plan de tratamiento de ortodoncia"], escritor: async (f) => void escritas.push(f) },
      async () => {
        retenerSiHayAlcance(fila({ texto: "Armó el plan de pago al abrir el caso de ortodoncia" }));
        retenerSiHayAlcance(fila({ texto: "Abrió el plan de pago de ortodoncia" }));
      },
    );
    const visibles = escritas.filter((f) => !marcada(f));
    assert.equal(escritas.length, 6, "las cinco originales + el resumen");
    assert.equal(visibles.length, 1);
    assert.match(textoDe(visibles[0]!), /^Abrió el caso de ortodoncia: Registró el diagnóstico.*Creó el plan de tratamiento.*Armó el plan de pago.*Abrió el plan de pago/);
  });

  it("si el plan de pago falla sin dejar filas, la apertura igual sale en Movimientos (fila base)", async () => {
    const escritas: FilaBitacora[] = [];
    await conUnSoloMovimiento(
      {
        titulo: "Abrió el caso de ortodoncia",
        detallesExtra: ["Creó el plan de tratamiento de ortodoncia"],
        filaBase: () => ({ clinicId: "cli_1", userId: "usr_1", patientId: "pat_1", entityType: "orthodontic-plan", entityId: "plan_1", action: "update" }),
        escritor: async (f) => void escritas.push(f),
      },
      async () => undefined,
    );
    assert.equal(escritas.length, 1);
    assert.equal(textoDe(escritas[0]!), "Abrió el caso de ortodoncia: Creó el plan de tratamiento de ortodoncia");
    assert.equal(marcada(escritas[0]!), false);
  });

  it("sin filas no escribe nada (una acción que falló antes de escribir)", async () => {
    const escritas: FilaBitacora[] = [];
    await conUnSoloMovimiento({ detallesExtra: ["x"], escritor: async (f) => void escritas.push(f) }, async () => undefined);
    assert.equal(escritas.length, 0);
  });

  it("una fila sin paciente (o sin usuario) no se retiene: se escribe al momento", async () => {
    await conUnSoloMovimiento({ escritor: async () => undefined }, async () => {
      assert.equal(retenerSiHayAlcance(fila({ patientId: null })), false);
      assert.equal(retenerSiHayAlcance(fila({ userId: null })), false);
    });
  });

  it("fuera de un alcance nada se retiene", () => {
    assert.equal(retenerSiHayAlcance(fila({ texto: "x" })), false);
  });

  it("si la acción falla a medias, las filas escritas se conservan y el error sigue subiendo", async () => {
    const escritas: FilaBitacora[] = [];
    await assert.rejects(
      conUnSoloMovimiento({ escritor: async (f) => void escritas.push(f) }, async () => {
        retenerSiHayAlcance(fila({ texto: "Uno" }));
        retenerSiHayAlcance(fila({ texto: "Dos" }));
        throw new Error("se cayó");
      }),
      /se cayó/,
    );
    assert.equal(escritas.length, 3);
  });

  it("un fallo al escribir una fila no rompe la acción principal", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const valor = await conUnSoloMovimiento({ escritor: async () => Promise.reject(new Error("pooler saturado")) }, async () => {
        retenerSiHayAlcance(fila({ texto: "Uno" }));
        return 42;
      });
      assert.equal(valor, 42);
    } finally {
      console.error = original;
    }
  });

  it("dos alcances a la vez no se mezclan", async () => {
    const a: FilaBitacora[] = [];
    const b: FilaBitacora[] = [];
    await Promise.all([
      conUnSoloMovimiento({ escritor: async (f) => void a.push(f) }, async () => {
        retenerSiHayAlcance(fila({ texto: "A1", patientId: "pat_a" }));
        await new Promise((r) => setTimeout(r, 5));
        retenerSiHayAlcance(fila({ texto: "A2", patientId: "pat_a" }));
      }),
      conUnSoloMovimiento({ escritor: async (f) => void b.push(f) }, async () => {
        retenerSiHayAlcance(fila({ texto: "B1", patientId: "pat_b" }));
      }),
    ]);
    assert.equal(a.length, 3);
    assert.ok(a.every((f) => f.patientId === "pat_a"));
    assert.equal(b.length, 1);
    assert.equal(b[0]!.patientId, "pat_b");
  });
});

describe("conMovimientosSoloDeBitacora", () => {
  it("todas sus filas quedan solo en la bitácora, sin resumen", async () => {
    const escritas: FilaBitacora[] = [];
    await conMovimientosSoloDeBitacora(async () => {
      retenerSiHayAlcance(fila({ texto: "Registró el diagnóstico" }));
    }, async (f) => void escritas.push(f));
    assert.equal(escritas.length, 1);
    assert.equal(marcada(escritas[0]!), true);
  });
});

describe("piezas puras", () => {
  it("redactarResumen: con título las frases van tras los dos puntos; sin título, con « · »; la frase del título no se repite", () => {
    assert.equal(redactarResumen("Abrió el caso", ["A", "B"]), "Abrió el caso: A · B");
    assert.equal(redactarResumen(undefined, ["A", "B"]), "A · B");
    assert.equal(redactarResumen("Subió una foto", ["Subió una foto"]), "Subió una foto");
  });

  it("armarResumen une los campos de todas las filas, sin repetir", () => {
    const f1 = fila({ changes: { _mov: { before: null, after: { texto: "A", campos: ["x", "y"] } } } });
    const f2 = fila({ changes: { _mov: { before: null, after: { texto: "B", campos: ["y", "z"] } } } });
    const r = armarResumen([f1, f2], {});
    assert.deepEqual((r.changes!._mov as { after: { campos: string[] } }).after.campos, ["x", "y", "z"]);
  });

  it("solo `parteDeUnaAccion: true` marca un paso de otra acción", () => {
    assert.equal(esPasoDeOtraAccion({ parteDeUnaAccion: true }), true);
    assert.equal(esPasoDeOtraAccion({ parteDeUnaAccion: "true" }), false);
    assert.equal(esPasoDeOtraAccion({}), false);
    assert.equal(esPasoDeOtraAccion(null), false);
  });
});

describe("cableado", () => {
  const leer = (ruta: string) => readFileSync(join(process.cwd(), "src", ruta), "utf8");

  it("la lista de Movimientos no muestra las filas solo-bitácora", () => {
    assert.match(leer("lib/movimientos-paciente/consultar.ts"), /'_mov' -> 'after' ->> 'soloBitacora'.*<> 'true'/);
  });

  it("todo lo que escribe una fila de paciente pasa por el retén de fila.ts", () => {
    assert.match(leer("lib/movimientos-paciente/fila.ts"), /if \(retenerSiHayAlcance\(fila\)\) return;/);
  });

  it("abrir caso, guardar diagnóstico y plan, y subir una foto dejan una fila", () => {
    assert.match(leer("app/actions/orthodontics/createTreatmentPlan.ts"), /titulo: "Abrió el caso de ortodoncia"/);
    assert.match(leer("app/actions/orthodontics/guardarDiagnosticoYPlan.ts"), /conUnSoloMovimiento\(\{\}, \(\) => guardarJuntos\(input\)\)/);
    assert.match(leer("app/actions/orthodontics/createDiagnosis.ts"), /esPasoDeOtraAccion\(input\) \? conMovimientosSoloDeBitacora/);
    assert.match(leer("app/actions/orthodontics/createPhotoSet.ts"), /esPasoDeOtraAccion\(input\) \? conMovimientosSoloDeBitacora/);
    assert.match(leer("app/actions/orthodontics/uploadPhotoToSet.ts"), /if \(esPasoDeOtraAccion\(input\)\) return conMovimientosSoloDeBitacora/);
    assert.match(leer("app/actions/orthodontics/createTreatmentPlan.ts"), /sigueElPlanDePago === true/);
    assert.match(leer("app/actions/orthodontics/cobro/crearPlanDelCaso.ts"), /titulo: "Abrió el caso de ortodoncia"/);
    assert.match(leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), /aperturaDelCaso: \{ diagnostico: juntoConElPlan/);
    const ruta = leer("app/api/orthodontics/photos/upload/route.ts");
    assert.match(ruta, /form\.get\("juegoNuevo"\) === "1"/);
  });
});
