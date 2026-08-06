// Tests puros de los borradores por hilo del composer del Inbox — hallazgo
// M-01 de la auditoría: "la nota interna sale al paciente equivocado".
//
// Lo que protegen: cambiar de conversación NUNCA arrastra texto ni modo de
// otra, y el modo "Nota interna" nunca sobrevive vacío a un cambio de hilo
// (si sobreviviera, la siguiente respuesta se guardaría como nota y el
// paciente jamás la recibiría).
//
// Patrón node:test + tsx. Correr: npm run test:inbox-drafts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyDraft,
  dropDraft,
  forgetEmptyDraft,
  getDraft,
  EMPTY_DRAFT,
  MAX_DRAFTS,
  type DraftMap,
} from "../composer-drafts";

const A = "cthreadaaa";
const B = "cthreadbbb";

/* Simula lo que hace el componente al ABANDONAR el hilo `from`: el cleanup del
   efecto corre con el id viejo antes de que el composer lea el del hilo nuevo. */
const leave = (drafts: DraftMap, from: string): DraftMap => forgetEmptyDraft(drafts, from);

/* ── 1. Cambiar de hilo no arrastra nada ──────────────────────────────────── */
describe("cambiar de conversación", () => {
  it("el hilo B llega vacío y en modo respuesta aunque A tenga una nota a medias", () => {
    let d: DraftMap = {};
    d = applyDraft(d, A, { mode: "internal" });
    d = applyDraft(d, A, { text: "paciente moroso, cobrar por adelantado" });

    d = leave(d, A);

    assert.deepEqual(getDraft(d, B), EMPTY_DRAFT);
    assert.equal(getDraft(d, B).text, "");
    assert.equal(getDraft(d, B).mode, "reply");
  });

  it("volver a A recupera su texto Y su modo intactos", () => {
    let d: DraftMap = {};
    d = applyDraft(d, A, { mode: "internal" });
    d = applyDraft(d, A, { text: "paciente moroso" });
    d = leave(d, A);
    d = applyDraft(d, B, { text: "claro, la esperamos" });
    d = leave(d, B);

    assert.deepEqual(getDraft(d, A), { text: "paciente moroso", mode: "internal" });
    assert.deepEqual(getDraft(d, B), { text: "claro, la esperamos", mode: "reply" });
  });

  it("escribir en B no toca el borrador de A", () => {
    let d: DraftMap = applyDraft({}, A, { text: "nota de Ana", mode: "internal" });
    d = applyDraft(d, B, { text: "hola Beto" });
    assert.deepEqual(getDraft(d, A), { text: "nota de Ana", mode: "internal" });
  });

  it("un hilo sin borrador previo devuelve el vacío por defecto, sin romper", () => {
    assert.deepEqual(getDraft({}, "cnuevo"), EMPTY_DRAFT);
    assert.deepEqual(getDraft({}, null), EMPTY_DRAFT);
    assert.deepEqual(getDraft({}, undefined), EMPTY_DRAFT);
    assert.deepEqual(getDraft({ [A]: { text: "x", mode: "reply" } }, null), EMPTY_DRAFT);
  });
});

/* ── 2. El modo "Nota interna" no se queda pegado sin texto ───────────────── */
describe("el modo nota no sobrevive vacío a un cambio de hilo", () => {
  it("tocar 'Nota interna' y salir sin escribir NO deja el hilo en modo nota", () => {
    // Sin esto, al volver a A la siguiente respuesta al paciente se guardaría
    // como nota interna y él nunca la recibiría.
    let d: DraftMap = applyDraft({}, A, { mode: "internal" });
    assert.equal(getDraft(d, A).mode, "internal", "mientras sigo en A, el modo se respeta");

    d = leave(d, A);

    assert.equal(getDraft(d, A).mode, "reply");
    assert.deepEqual(d, {});
  });

  it("tras enviar la nota (texto vacío, modo nota) y salir, el hilo vuelve a 'Responder'", () => {
    let d: DraftMap = applyDraft({}, A, { text: "llamó su esposo", mode: "internal" });
    d = applyDraft(d, A, { text: "" }); // sendReply limpia solo el texto
    assert.equal(getDraft(d, A).mode, "internal", "sigo en A: el modo no salta bajo mis dedos");

    d = leave(d, A);
    assert.equal(getDraft(d, A).mode, "reply");
  });

  it("borrar el texto SIN salir del hilo conserva el modo (no mueve el selector)", () => {
    // El salto de modo en caliente sería justo el camino por el que una nota
    // acaba saliendo al paciente.
    let d: DraftMap = applyDraft({}, A, { text: "nota a medias", mode: "internal" });
    d = applyDraft(d, A, { text: "" });
    assert.deepEqual(getDraft(d, A), { text: "", mode: "internal" });
  });

  it("salir de un hilo CON texto conserva todo (el fix M-01 sigue en pie)", () => {
    let d: DraftMap = applyDraft({}, A, { text: "nota", mode: "internal" });
    d = leave(d, A);
    assert.deepEqual(getDraft(d, A), { text: "nota", mode: "internal" });
  });

  it("un borrador de solo espacios cuenta como vacío (no se puede enviar igual)", () => {
    let d: DraftMap = applyDraft({}, A, { text: "   \n ", mode: "internal" });
    d = leave(d, A);
    assert.equal(getDraft(d, A).mode, "reply");
    assert.deepEqual(d, {});
  });

  it("salir de un hilo sin borrador no rompe ni crea basura", () => {
    assert.deepEqual(leave({}, A), {});
    const soloB: DraftMap = { [B]: { text: "x", mode: "reply" } };
    assert.equal(leave(soloB, A), soloB, "sin cambios devuelve el MISMO objeto");
  });
});

/* ── 3. Enviar limpia solo el borrador del hilo enviado ───────────────────── */
describe("envío con éxito", () => {
  it("limpia SOLO el borrador de A; el de B no se toca", () => {
    let d: DraftMap = {};
    d = applyDraft(d, A, { text: "respuesta a Ana" });
    d = applyDraft(d, B, { text: "respuesta a Beto" });

    d = applyDraft(d, A, { text: "" }); // lo que hace sendReply

    assert.deepEqual(getDraft(d, A), EMPTY_DRAFT);
    assert.equal(A in d, false, "un borrador vacío en modo respuesta no se guarda");
    assert.deepEqual(getDraft(d, B), { text: "respuesta a Beto", mode: "reply" });
  });

  it("si el usuario saltó a B durante el POST, se limpia A y no lo que teclea en B", () => {
    let d: DraftMap = applyDraft({}, A, { text: "ya le confirmo" });
    d = applyDraft(d, B, { text: "escribiendo mientras viaja el POST" });
    d = applyDraft(d, A, { text: "" }); // sendReply usa el id del hilo ENVIADO
    assert.equal(getDraft(d, B).text, "escribiendo mientras viaja el POST");
  });

  it("resolver/archivar el hilo olvida su borrador por completo", () => {
    let d: DraftMap = applyDraft({}, A, { text: "nota", mode: "internal" });
    d = applyDraft(d, B, { text: "otra" });
    d = dropDraft(d, A);
    assert.equal(A in d, false);
    assert.deepEqual(getDraft(d, B), { text: "otra", mode: "reply" });
  });

  it("dropDraft de un hilo sin borrador devuelve el mismo objeto", () => {
    const d: DraftMap = { [B]: { text: "x", mode: "reply" } };
    assert.equal(dropDraft(d, A), d);
  });
});

/* ── 4. Detalles de la estructura ─────────────────────────────────────────── */
describe("estructura del mapa", () => {
  it("acepta un updater y ve el valor previo (lo usa insertTemplate)", () => {
    let d: DraftMap = applyDraft({}, A, { text: "hola" });
    d = applyDraft(d, A, (prev) => ({ text: `${prev.text}\nplantilla` }));
    assert.equal(getDraft(d, A).text, "hola\nplantilla");
  });

  it("el updater conserva el modo si el patch no lo trae", () => {
    let d: DraftMap = applyDraft({}, A, { mode: "internal" });
    d = applyDraft(d, A, { text: "nota" });
    assert.equal(getDraft(d, A).mode, "internal");
  });

  it("un patch que no cambia nada devuelve el MISMO objeto (no re-renderiza)", () => {
    const d: DraftMap = applyDraft({}, A, { text: "hola" });
    assert.equal(applyDraft(d, A, { text: "hola" }), d);
    assert.equal(applyDraft(d, A, {}), d);
    assert.equal(applyDraft(d, A, { mode: "reply" }), d);
    const vacio: DraftMap = {};
    assert.equal(applyDraft(vacio, A, { text: "" }), vacio, "escribir vacío en un hilo sin borrador no cambia nada");
  });

  it("no muta el mapa que recibe", () => {
    const d: DraftMap = applyDraft({}, A, { text: "hola" });
    const copia = JSON.parse(JSON.stringify(d));
    applyDraft(d, A, { text: "otra cosa" });
    applyDraft(d, B, { text: "nueva" });
    dropDraft(d, A);
    forgetEmptyDraft(d, A);
    assert.deepEqual(d, copia);
  });

  it("nunca muta EMPTY_DRAFT (es compartido por todos los hilos sin borrador)", () => {
    let d: DraftMap = applyDraft({}, A, { text: "x" });
    d = applyDraft(d, B, { mode: "internal" });
    assert.deepEqual(EMPTY_DRAFT, { text: "", mode: "reply" });
  });

  it(`sobre ${MAX_DRAFTS} borradores se sueltan los menos recientes, nunca el que se escribe`, () => {
    let d: DraftMap = {};
    for (let i = 0; i < MAX_DRAFTS + 5; i++) d = applyDraft(d, `cthread${i}`, { text: `t${i}` });

    assert.equal(Object.keys(d).length, MAX_DRAFTS);
    assert.equal("cthread0" in d, false, "el más viejo se soltó");
    assert.equal(getDraft(d, `cthread${MAX_DRAFTS + 4}`).text, `t${MAX_DRAFTS + 4}`);

    // Volver a escribir en uno viejo lo devuelve al final de la cola.
    const viejo = `cthread${MAX_DRAFTS - 1}`;
    d = applyDraft(d, viejo, { text: "revivido" });
    for (let i = 0; i < 5; i++) d = applyDraft(d, `cextra${i}`, { text: "x" });
    assert.equal(getDraft(d, viejo).text, "revivido", "el uso reciente lo salvó de la poda");
  });
});
