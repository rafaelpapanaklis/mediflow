// §1 completo (ws1-t8): "Firmar control" fallaba en dev.108 con "Unique
// constraint failed on (treatmentPlanId, cardNumber)" por dos caminos.
// Este archivo prueba los dos, contra el `reducer`/`initialState` reales
// de `treatment-card-state.ts` — separado de `DrawerTreatmentCard.tsx`
// justamente para poder importarlo aquí sin arrastrar su `.module.css`
// (Node no sabe leerlo; mismo motivo que ya movió `phase-criteria.ts`/
// `wire-options.ts` a su propio archivo).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialState, reducer, type DrawerState } from "../drawers/treatment-card-state";

describe("Camino 1 — guardar un borrador y firmar después, en la MISMA sesión del cajón", () => {
  it("una tarjeta NUEVA empieza con learnedCardId null (buildSubmit mandaría cardId: null)", () => {
    const state = initialState(null);
    assert.equal(state.learnedCardId, null);
  });

  it("tras 'learn-card-id' (lo que dispara onSave al recibir el id del servidor), el siguiente submit ya no manda null", () => {
    let state: DrawerState = initialState(null);

    // 1. Primer submit ("Guardar borrador"): buildSubmit() manda cardId=null.
    assert.equal(state.learnedCardId, null);

    // 2. El servidor CREA la tarjeta y devuelve su id — el cajón lo aprende
    //    (esto es lo que hace el onClick de "Guardar borrador" tras el await).
    state = reducer(state, { kind: "learn-card-id", id: "card-recien-creada" });

    // 3. Segundo submit ("Firmar control"), MISMA sesión del cajón, sin
    //    cerrar ni remontar: antes de este arreglo, buildSubmit() seguía
    //    devolviendo null aquí (props.card nunca cambió) y el servidor
    //    intentaba CREAR la tarjeta OTRA VEZ con el mismo cardNumber →
    //    "Unique constraint failed". Ahora manda el id aprendido.
    assert.equal(state.learnedCardId, "card-recien-creada");
  });

  it("una tarjeta EXISTENTE (reabrir un control ya guardado) arranca con learnedCardId = su id, sin necesitar la acción", () => {
    const card = fixtureCard({ id: "card-existente", status: "DRAFT" });
    const state = initialState(card);
    assert.equal(state.learnedCardId, "card-existente");
  });

  it("learn-card-id no toca ningún otro campo del estado", () => {
    const antes = initialState(null);
    const despues = reducer(antes, { kind: "learn-card-id", id: "x" });
    assert.deepEqual({ ...despues, learnedCardId: null }, antes);
  });
});

describe("Camino 2 — doble clic en 'Guardar borrador'/'Firmar control'", () => {
  it("SIN la acción learn-card-id, dos lecturas seguidas de una tarjeta nueva dan el mismo cardId (por eso hace falta enVuelo)", () => {
    // Simula lo que buildSubmit() leería en dos clics que salen ANTES de
    // que el primero resuelva: los dos ven el mismo estado (ninguno tuvo
    // tiempo de aprender un id todavía) — la única defensa real contra
    // mandar dos CREATE con el mismo cardNumber es no dejar que el
    // segundo clic dispare la llamada, que es lo que hace `enVuelo` en
    // el componente (comprobado abajo por inspección de fuente: los dos
    // botones se deshabilitan y el onClick corta en seco si ya hay uno
    // en vuelo).
    const state = initialState(null);
    const primeraLectura = state.learnedCardId;
    const segundaLectura = state.learnedCardId; // el reducer no corrió entre medio
    assert.equal(primeraLectura, segundaLectura);
    assert.equal(primeraLectura, null);
  });

  it("los dos botones (Guardar borrador / Firmar control) se deshabilitan mientras hay una llamada en vuelo, y el onClick corta si ya hay una en curso", () => {
    const src = readFileSync(
      join(__dirname, "..", "drawers", "DrawerTreatmentCard.tsx"),
      "utf8",
    );
    // El guardia: no arrancar un segundo submit mientras el primero sigue.
    assert.match(src, /if \(enVuelo\) return;/, "falta el corte al inicio del onClick");
    // Los dos botones quedan deshabilitados mientras `enVuelo` es true.
    assert.match(src, /disabled=\{enVuelo\}/, "\"Guardar borrador\" no se deshabilita en vuelo");
    assert.match(src, /disabled=\{!canSign \|\| enVuelo\}/, "\"Firmar control\" no se deshabilita en vuelo");
  });
});

function fixtureCard(overrides: { id: string; status: "DRAFT" | "SIGNED" }) {
  return {
    id: overrides.id,
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
    status: overrides.status,
    signedAt: null,
    signedByName: null,
    elastics: [],
    iprPoints: [],
    brokenBrackets: [],
    activationsNote: null,
    indications: null,
  } as Parameters<typeof initialState>[0];
}
