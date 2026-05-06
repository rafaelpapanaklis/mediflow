// clinical-shared/evolution-templates — tests del seed orto.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORTHO_DEFAULT_TEMPLATES,
} from "../seed-orthodontics";
import { isSoapTemplateBody } from "../types";

const REQUIRED_NAMES = [
  "Cementado de brackets",
  "Activación de arco",
  "Control mensual general",
  "Cambio de alineador",
  "Retiro de brackets",
  "Entrega de retenedor",
] as const;

describe("ORTHO_DEFAULT_TEMPLATES", () => {
  it("tiene exactamente 6 plantillas", () => {
    assert.equal(ORTHO_DEFAULT_TEMPLATES.length, 6);
  });

  it("cubre los 6 nombres requeridos por spec", () => {
    const names = new Set(ORTHO_DEFAULT_TEMPLATES.map((t) => t.name));
    for (const required of REQUIRED_NAMES) {
      assert.ok(names.has(required), `Falta plantilla: ${required}`);
    }
  });

  it("tiene al menos una marcada como default", () => {
    const defaults = ORTHO_DEFAULT_TEMPLATES.filter((t) => t.isDefault);
    assert.ok(defaults.length >= 1, "Debe haber al menos 1 default");
  });

  it("ninguna plantilla tiene SOAP vacío", () => {
    for (const t of ORTHO_DEFAULT_TEMPLATES) {
      assert.ok(t.soap.S.length > 0, `S vacío en ${t.name}`);
      assert.ok(t.soap.O.length > 0, `O vacío en ${t.name}`);
      assert.ok(t.soap.A.length > 0, `A vacío en ${t.name}`);
      assert.ok(t.soap.P.length > 0, `P vacío en ${t.name}`);
    }
  });

  it("SOAP body pasa el type guard isSoapTemplateBody", () => {
    for (const t of ORTHO_DEFAULT_TEMPLATES) {
      assert.ok(isSoapTemplateBody(t.soap));
    }
  });

  it("nombres son únicos (no duplicados)", () => {
    const names = ORTHO_DEFAULT_TEMPLATES.map((t) => t.name);
    const unique = new Set(names);
    assert.equal(names.length, unique.size);
  });

  it("isSoapTemplateBody rechaza objetos malformados", () => {
    assert.equal(isSoapTemplateBody(null), false);
    assert.equal(isSoapTemplateBody({ S: "x", O: "y", A: "z" }), false);
    assert.equal(isSoapTemplateBody({ S: 1, O: "y", A: "z", P: "w" }), false);
  });
});
