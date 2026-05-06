import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplateString,
  renderSoapTemplate,
  IMPLANT_EVOLUTION_TEMPLATES,
  getImplantEvolutionTemplate,
  builtinToRecord,
  listImplantEvolutionTemplates,
} from "../evolution-templates";

describe("clinical-shared/evolution-templates", () => {
  it("renderTemplateString hidrata placeholders", () => {
    const out = renderTemplateString(
      "Diente {{toothFdi}} marca {{brand}}",
      { toothFdi: 36, brand: "Straumann" },
    );
    assert.equal(out, "Diente 36 marca Straumann");
  });

  it("renderTemplateString deja placeholders sin valor", () => {
    const out = renderTemplateString("Hola {{x}} {{y}}", { x: "mundo" });
    assert.equal(out, "Hola mundo {{y}}");
  });

  it("renderSoapTemplate procesa las 4 secciones", () => {
    const out = renderSoapTemplate(
      { S: "S {{a}}", O: "O {{b}}", A: "A {{c}}", P: "P {{d}}" },
      { a: 1, b: 2, c: 3, d: 4 },
    );
    assert.equal(out.S, "S 1");
    assert.equal(out.O, "O 2");
    assert.equal(out.A, "A 3");
    assert.equal(out.P, "P 4");
  });

  it("hay exactamente 6 plantillas builtin de implantes", () => {
    assert.equal(IMPLANT_EVOLUTION_TEMPLATES.length, 6);
  });

  it("plantillas builtin tienen las 4 secciones SOAP no vacías", () => {
    for (const t of IMPLANT_EVOLUTION_TEMPLATES) {
      assert.ok(t.soapTemplate.S);
      assert.ok(t.soapTemplate.O);
      assert.ok(t.soapTemplate.A);
      assert.ok(t.soapTemplate.P);
      assert.ok(t.name);
      assert.ok(t.description);
    }
  });

  it("getImplantEvolutionTemplate busca por key", () => {
    const t = getImplantEvolutionTemplate("colocacion_implante");
    assert.equal(t.key, "colocacion_implante");
    assert.match(t.soapTemplate.O, /Torque inserción/);
  });

  it("getImplantEvolutionTemplate lanza si key inexistente", () => {
    assert.throws(() =>
      // @ts-expect-error — pasando key inválida a propósito
      getImplantEvolutionTemplate("garbage"),
    );
  });

  it("builtinToRecord crea EvolutionTemplateRecord válido", () => {
    const t = IMPLANT_EVOLUTION_TEMPLATES[0];
    const r = builtinToRecord(t);
    assert.equal(r.id, `builtin:${t.key}`);
    assert.equal(r.module, "implants");
    assert.equal(r.clinicId, null);
    assert.equal(r.isDefault, false);
  });

  it("listImplantEvolutionTemplates devuelve los 6 ordenados", () => {
    const list = listImplantEvolutionTemplates();
    assert.equal(list.length, 6);
    // los keys vienen en sortOrder ascendente
    const keys = list.map((x) => x.key);
    assert.deepEqual(keys, [
      "planificacion_quirurgica",
      "colocacion_implante",
      "segunda_fase",
      "colocacion_pilar",
      "instalacion_corona",
      "control_oseointegracion",
    ]);
  });
});
