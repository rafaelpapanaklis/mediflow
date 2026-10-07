// ws1-t9 — regla combinada del menú al agendar: genéricas marcadas + procedimientos
// marcados + Otro tratamiento (+ control de ortodoncia). Correr: npm run test:wa-menu-genericas
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { construirMenu, normalizarGenericas, opcionesPedidas, MAX_MARCADOS_EN_MENU } from "../menu-agenda-core";

const proc = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Proc ${i}`, duration: 30 }));
const todas = { consulta: true, limpieza: true, urgencia: true };
const labels = (m: { label: string }[]) => m.map((o) => o.label);

describe("menú combinado", () => {
  it("genéricas solas (de fábrica)", () => {
    assert.deepEqual(labels(construirMenu({ marcados: [], conOrto: false })), ["Consulta o valoración", "Limpieza", "Urgencia o dolor", "Otro tratamiento"]);
  });
  it("combinadas: las genéricas NO se ocultan por marcar procedimientos", () => {
    const m = labels(construirMenu({ marcados: proc(2), conOrto: false, genericas: todas }));
    assert.deepEqual(m, ["Consulta o valoración", "Limpieza", "Urgencia o dolor", "Proc 0 (30 min)", "Proc 1 (30 min)", "Otro tratamiento"]);
  });
  it("solo procedimientos: desmarcando las genéricas", () => {
    const m = labels(construirMenu({ marcados: proc(2), conOrto: false, genericas: { consulta: false, limpieza: false, urgencia: false } }));
    assert.deepEqual(m, ["Proc 0 (30 min)", "Proc 1 (30 min)", "Otro tratamiento"]);
  });
  it("una genérica desmarcada desaparece", () => {
    const m = labels(construirMenu({ marcados: [], conOrto: false, genericas: { ...todas, limpieza: false } }));
    assert.deepEqual(m, ["Consulta o valoración", "Urgencia o dolor", "Otro tratamiento"]);
  });
  it("nada marcado: vuelven las genéricas de fábrica", () => {
    const m = labels(construirMenu({ marcados: [], conOrto: false, genericas: { consulta: false, limpieza: false, urgencia: false } }));
    assert.deepEqual(m, ["Consulta o valoración", "Limpieza", "Urgencia o dolor", "Otro tratamiento"]);
  });
  it("control de ortodoncia entra después de las genéricas, antes de los procedimientos", () => {
    const m = labels(construirMenu({ marcados: proc(1), conOrto: true, genericas: todas }));
    assert.deepEqual(m, ["Consulta o valoración", "Limpieza", "Urgencia o dolor", "Control de ortodoncia", "Proc 0 (30 min)", "Otro tratamiento"]);
  });
  it("tope de 8 antes de «Otro tratamiento», que siempre va al final", () => {
    const m = construirMenu({ marcados: proc(12), conOrto: true, genericas: todas });
    assert.equal(m.length, MAX_MARCADOS_EN_MENU + 1);
    assert.equal(m[m.length - 1].label, "Otro tratamiento");
    assert.ok(labels(m).includes("Control de ortodoncia"), "el control no se recorta");
    assert.equal(labels(m)[7], "Proc 3 (30 min)");
  });
  it("opcionesPedidas avisa cuando se pasa del tope", () => {
    assert.equal(opcionesPedidas(todas, 5), 8);
    assert.ok(opcionesPedidas(todas, 6) > MAX_MARCADOS_EN_MENU);
  });
  it("normalizarGenericas: ausente o raro = activas; solo false apaga", () => {
    assert.deepEqual(normalizarGenericas(null), todas);
    assert.deepEqual(normalizarGenericas({ limpieza: false }), { ...todas, limpieza: false });
    assert.deepEqual(normalizarGenericas("x"), todas);
  });
});
