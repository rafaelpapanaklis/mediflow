// Clinical-shared — tests para seeds y type guards de plantillas SOAP.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PEDIATRIC_DEFAULT_TEMPLATES } from "../seed-pediatrics";
import { isSoapTemplateBody } from "../types";

describe("PEDIATRIC_DEFAULT_TEMPLATES", () => {
  it("incluye exactamente los 5 nombres requeridos por la spec", () => {
    const names = PEDIATRIC_DEFAULT_TEMPLATES.map((t) => t.name);
    assert.equal(names.length, 5);
    assert.ok(names.includes("Profilaxis pediátrica"));
    assert.ok(names.includes("Aplicación de sellantes"));
    assert.ok(names.includes("Fluoruro tópico (barniz)"));
    assert.ok(names.includes("Evaluación conductual (Frankl)"));
    assert.ok(names.includes("Control de hábitos orales"));
  });

  it("solo una plantilla es default", () => {
    const defaults = PEDIATRIC_DEFAULT_TEMPLATES.filter((t) => t.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0]?.name, "Profilaxis pediátrica");
  });

  it("cada plantilla tiene los 4 campos SOAP no vacíos", () => {
    for (const t of PEDIATRIC_DEFAULT_TEMPLATES) {
      assert.ok(t.soap.S.length > 10, `S vacío en ${t.name}`);
      assert.ok(t.soap.O.length > 10, `O vacío en ${t.name}`);
      assert.ok(t.soap.A.length > 10, `A vacío en ${t.name}`);
      assert.ok(t.soap.P.length > 10, `P vacío en ${t.name}`);
    }
  });
});

describe("isSoapTemplateBody", () => {
  it("acepta objeto con S/O/A/P string", () => {
    assert.ok(isSoapTemplateBody({ S: "a", O: "b", A: "c", P: "d" }));
  });
  it("rechaza null/undefined", () => {
    assert.equal(isSoapTemplateBody(null), false);
    assert.equal(isSoapTemplateBody(undefined), false);
  });
  it("rechaza si falta un campo", () => {
    assert.equal(isSoapTemplateBody({ S: "a", O: "b", A: "c" }), false);
  });
  it("rechaza si un campo no es string", () => {
    assert.equal(isSoapTemplateBody({ S: 1, O: "b", A: "c", P: "d" }), false);
  });
});
