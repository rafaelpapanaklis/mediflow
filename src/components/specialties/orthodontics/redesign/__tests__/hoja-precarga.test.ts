// Fila 12 — la hoja NUEVA nace con lo del control anterior (estado inicial
// del cajón), marcado como «del control anterior» hasta que se cambia, y la
// nota precargada no estorba a las plantillas.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  notaBaseParaPlantilla,
  reducer,
  type PrecargaHoja,
} from "../drawers/treatment-card-state";
import { aplicarPlantillaAlControl } from "../../../../../lib/orthodontics/consulta-ortodoncia";

const nota = { s: "S pre", o: "O pre", a: "A pre", p: "P pre ____" };

const precarga: PrecargaHoja = {
  arcoId: "arco-1",
  elastics: [{ elasticClass: "CLASE_II", config: '3/16" 6oz', zone: "INTERMAXILAR" }],
  brackets: [{ toothFdi: 25, brokenDate: "2026-09-01T12:00:00.000Z", notes: null }],
  indications: "Elásticos 22 h al día",
  nota,
};

describe("initialState con precarga (hoja nueva)", () => {
  it("sin precarga sigue empezando en blanco", () => {
    const s = initialState(null);
    assert.deepEqual(s.soap, { s: "", o: "", a: "", p: "" });
    assert.deepEqual(s.elastics, []);
    assert.equal(s.wireToId, null);
    assert.equal(s.notaPrecargada, null);
    assert.deepEqual(s.delAnterior, { arco: false, elasticos: [], brackets: [], indicaciones: false });
  });

  it("hereda arco, elásticos, brackets pendientes, indicaciones y nota, todo marcado", () => {
    const s = initialState(null, precarga);
    assert.equal(s.wireToId, "arco-1");
    assert.equal(s.elastics.length, 1);
    assert.equal(s.elastics[0].elasticClass, "CLASE_II");
    assert.equal(s.brokenBrackets.length, 1);
    assert.equal(s.brokenBrackets[0].reBondedDate, null);
    assert.equal(s.indications, "Elásticos 22 h al día");
    assert.deepEqual(s.soap, nota);
    assert.deepEqual(s.notaPrecargada, nota);
    assert.equal(s.delAnterior.arco, true);
    assert.deepEqual(s.delAnterior.elasticos, [s.elastics[0].id]);
    assert.deepEqual(s.delAnterior.brackets, [s.brokenBrackets[0].id]);
    assert.equal(s.delAnterior.indicaciones, true);
    assert.equal(s.learnedCardId, null);
  });

  it("la nota se copia: editar la hoja no toca la precarga guardada", () => {
    const s = reducer(initialState(null, precarga), { kind: "set-soap", field: "s", value: "otra" });
    assert.equal(s.notaPrecargada?.s, "S pre");
  });

  it("con una hoja existente se ignora la precarga", () => {
    const card = {
      ...initialStateFixture(),
    } as Parameters<typeof initialState>[0];
    const s = initialState(card, precarga);
    assert.deepEqual(s.elastics, []);
    assert.equal(s.notaPrecargada, null);
    assert.equal(s.delAnterior.arco, false);
  });

  it("indicaciones en blanco no se marcan como heredadas", () => {
    const s = initialState(null, { indications: "   " });
    assert.equal(s.indications, "");
    assert.equal(s.delAnterior.indicaciones, false);
  });
});

describe("marcas «del control anterior»", () => {
  it("cambiar el arco (incluso a «Sin cambio») quita la marca y NO vuelve solo", () => {
    let s = initialState(null, precarga);
    s = reducer(s, { kind: "set-wire-to", value: null });
    assert.equal(s.wireToId, null);
    assert.equal(s.delAnterior.arco, false);
  });

  it("editar o quitar un elástico heredado le quita la marca; uno nuevo no se marca", () => {
    const s0 = initialState(null, precarga);
    const id = s0.elastics[0].id;
    const s1 = reducer(s0, { kind: "update-elastic", id, patch: { config: '1/4" 4oz' } });
    assert.deepEqual(s1.delAnterior.elasticos, []);
    const s2 = reducer(s0, { kind: "remove-elastic", id });
    assert.deepEqual(s2.elastics, []);
    assert.deepEqual(s2.delAnterior.elasticos, []);
    const s3 = reducer(s0, {
      kind: "add-elastic",
      value: { id: "tmp-x", elasticClass: "BOX", config: "x", zone: "ANTERIOR" },
    });
    assert.deepEqual(s3.delAnterior.elasticos, [id]);
  });

  it("recementar el bracket heredado lo resuelve y le quita la marca", () => {
    const s0 = initialState(null, precarga);
    const id = s0.brokenBrackets[0].id;
    const s1 = reducer(s0, { kind: "mark-rebonded", id });
    assert.notEqual(s1.brokenBrackets[0].reBondedDate, null);
    assert.deepEqual(s1.delAnterior.brackets, []);
  });

  it("editar las indicaciones quita la marca", () => {
    const s = reducer(initialState(null, precarga), { kind: "set-indications", value: "Nuevas" });
    assert.equal(s.delAnterior.indicaciones, false);
  });
});

describe("notaBaseParaPlantilla (plantilla sobre la nota precargada)", () => {
  const llena = { S: "s", O: "o", A: "a", P: "p" };

  it("sin precarga no cambia nada (la plantilla se añade como siempre)", () => {
    const soap = { s: "escrito", o: "", a: "", p: "" };
    assert.deepEqual(notaBaseParaPlantilla(soap, null, llena), soap);
  });

  it("los campos sin tocar se vacían para que la plantilla los reemplace; lo escrito se queda", () => {
    const soap = { ...nota, a: "Lo que escribió el doctor" };
    assert.deepEqual(notaBaseParaPlantilla(soap, nota, llena), { s: "", o: "", a: "Lo que escribió el doctor", p: "" });
  });

  it("si la plantilla no trae texto para un campo, la precarga de ese campo se queda", () => {
    assert.deepEqual(notaBaseParaPlantilla({ ...nota }, nota, { S: "x", O: "  ", A: "", P: "y" }), {
      s: "",
      o: "O pre",
      a: "A pre",
      p: "",
    });
  });

  it("de punta a punta: la plantilla reemplaza la precarga y respeta lo escrito", () => {
    const soap = { ...nota, a: "Buen avance" };
    const plantilla = { S: "Sin molestias", O: "", A: "Mes {{monthInTreatment}}", P: "Cambio de arco" };
    const contexto = { mes: 4, duracionMeses: null, fase: null, arcoActual: null, arcoNuevo: null };
    const r = aplicarPlantillaAlControl(notaBaseParaPlantilla(soap, nota, plantilla), plantilla, contexto);
    assert.equal(r.s, "Sin molestias");
    assert.equal(r.o, "O pre");
    assert.equal(r.a, "Buen avance\n\nMes 4");
    assert.equal(r.p, "Cambio de arco");
  });
});

function initialStateFixture() {
  return {
    id: "card-1",
    cardNumber: 1,
    visitDate: "2026-09-28T12:00:00.000Z",
    durationMin: 30,
    phaseKey: "LEVELING",
    monthAt: 1,
    wireFrom: null,
    wireTo: null,
    soap: { s: "", o: "", a: "", p: "" },
    hygiene: { plaquePct: null, gingivitis: null, whiteSpots: false },
    hasProgressPhoto: false,
    photoSetId: null,
    nextDate: null,
    nextDurationMin: null,
    status: "DRAFT",
    signedAt: null,
    signedByName: null,
    elastics: [],
    iprPoints: [],
    brokenBrackets: [],
    activationsNote: null,
    indications: null,
  };
}
