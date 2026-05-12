// Orthodontics — tests de los 5 sub-tipos LabOrder.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORTHO_LAB_SUBTYPES,
  ORTHO_LAB_SUBTYPE_LABELS,
  ORTHO_LAB_TYPE_MAP,
  ORTHO_LAB_REQUIRED_SPEC_FIELDS,
  ORTHO_LAB_DEFAULT_SPEC,
} from "../lab-orders";

describe("Ortho lab subtypes", () => {
  it("expone los 5 sub-tipos requeridos", () => {
    assert.equal(ORTHO_LAB_SUBTYPES.length, 5);
    assert.deepEqual(
      [...ORTHO_LAB_SUBTYPES].sort(),
      [
        "alineadores_serie",
        "expansor_personalizado",
        "modelos_estudio_digital",
        "retenedor_essix",
        "retenedor_hawley",
      ],
    );
  });

  it("cada sub-tipo tiene label, type-map, required y default spec", () => {
    for (const t of ORTHO_LAB_SUBTYPES) {
      assert.ok(ORTHO_LAB_SUBTYPE_LABELS[t]);
      assert.ok(ORTHO_LAB_TYPE_MAP[t]);
      assert.ok(ORTHO_LAB_REQUIRED_SPEC_FIELDS[t]);
      assert.ok(ORTHO_LAB_DEFAULT_SPEC[t]);
    }
  });

  it("default spec incluye ortho_subtype igual al sub-tipo", () => {
    for (const t of ORTHO_LAB_SUBTYPES) {
      assert.equal(ORTHO_LAB_DEFAULT_SPEC[t].ortho_subtype, t);
    }
  });

  it("type-map mapea solo a tipos válidos del enum", () => {
    const validTypes = new Set(["ortho_appliance", "retainer", "other"]);
    for (const t of ORTHO_LAB_SUBTYPES) {
      assert.ok(validTypes.has(ORTHO_LAB_TYPE_MAP[t]));
    }
  });

  it("required fields son subset del default spec", () => {
    for (const t of ORTHO_LAB_SUBTYPES) {
      const required = ORTHO_LAB_REQUIRED_SPEC_FIELDS[t];
      const defaultKeys = Object.keys(ORTHO_LAB_DEFAULT_SPEC[t]);
      for (const f of required) {
        assert.ok(
          defaultKeys.includes(f),
          `Campo requerido ${f} no está en default spec de ${t}`,
        );
      }
    }
  });
});
