// Endodontics — tests para canalAnatomy. Spec §7.6, §15.1

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultCanalsForFdi,
  categorizeTooth,
  selectCanalSvg,
  QUALITY_COLORS,
  labelQuality,
  labelCanalCanonicalName,
  canonicalNameToSvgId,
} from "../canalAnatomy";

describe("defaultCanalsForFdi", () => {
  it("incisivos centrales y laterales: 1 conducto único", () => {
    for (const fdi of [11, 12, 21, 22, 31, 32, 41, 42]) {
      assert.deepEqual(defaultCanalsForFdi(fdi), ["CONDUCTO_UNICO"]);
    }
  });

  it("caninos (13, 23, 33, 43): 1 conducto único", () => {
    for (const fdi of [13, 23, 33, 43]) {
      assert.deepEqual(defaultCanalsForFdi(fdi), ["CONDUCTO_UNICO"]);
    }
  });

  it("primeros premolares superiores (14, 24): V + P", () => {
    assert.deepEqual(defaultCanalsForFdi(14), ["V", "P"]);
    assert.deepEqual(defaultCanalsForFdi(24), ["V", "P"]);
  });

  it("segundos premolares superiores (15, 25): conducto único", () => {
    assert.deepEqual(defaultCanalsForFdi(15), ["CONDUCTO_UNICO"]);
    assert.deepEqual(defaultCanalsForFdi(25), ["CONDUCTO_UNICO"]);
  });

  it("premolares inferiores (34, 35, 44, 45): conducto único", () => {
    for (const fdi of [34, 35, 44, 45]) {
      assert.deepEqual(defaultCanalsForFdi(fdi), ["CONDUCTO_UNICO"]);
    }
  });

  it("primeros y segundos molares superiores (16, 17, 26, 27): MB, MB2, DB, P", () => {
    for (const fdi of [16, 26, 17, 27]) {
      assert.deepEqual(defaultCanalsForFdi(fdi), ["MB", "MB2", "DB", "P"]);
    }
  });

  it("terceros molares superiores (18, 28): MB, DB, P (sin MB2 por default)", () => {
    assert.deepEqual(defaultCanalsForFdi(18), ["MB", "DB", "P"]);
    assert.deepEqual(defaultCanalsForFdi(28), ["MB", "DB", "P"]);
  });

  it("molares inferiores (36, 37, 46, 47): MV, ML, D (NO incluye MB2)", () => {
    // El SPEC §7.6 lo aclara: el mockup muestra MB2 en 36 pero el helper
    // estándar devuelve MV/ML/D — esa decisión visual no se replica acá.
    for (const fdi of [36, 46, 37, 47]) {
      assert.deepEqual(defaultCanalsForFdi(fdi), ["MV", "ML", "D"]);
    }
  });

  it("terceros molares inferiores (38, 48): MV, ML, D", () => {
    assert.deepEqual(defaultCanalsForFdi(38), ["MV", "ML", "D"]);
    assert.deepEqual(defaultCanalsForFdi(48), ["MV", "ML", "D"]);
  });

  it("FDI desconocido devuelve conducto único como fallback", () => {
    assert.deepEqual(defaultCanalsForFdi(99), ["CONDUCTO_UNICO"]);
  });
});

describe("categorizeTooth", () => {
  it("clasifica incisivos correctamente (last 1 o 2)", () => {
    assert.equal(categorizeTooth(11), "incisor");
    assert.equal(categorizeTooth(22), "incisor");
    assert.equal(categorizeTooth(31), "incisor");
    assert.equal(categorizeTooth(42), "incisor");
  });

  it("caninos (last == 3)", () => {
    for (const fdi of [13, 23, 33, 43]) {
      assert.equal(categorizeTooth(fdi), "canine");
    }
  });

  it("premolares superiores (4 o 5 con cuadrante 1 o 2)", () => {
    assert.equal(categorizeTooth(14), "premolar_upper");
    assert.equal(categorizeTooth(15), "premolar_upper");
    assert.equal(categorizeTooth(24), "premolar_upper");
    assert.equal(categorizeTooth(25), "premolar_upper");
  });

  it("premolares inferiores (4 o 5 con cuadrante 3 o 4)", () => {
    assert.equal(categorizeTooth(34), "premolar_lower");
    assert.equal(categorizeTooth(45), "premolar_lower");
  });

  it("molares superiores (6, 7, 8 con cuadrante 1 o 2)", () => {
    assert.equal(categorizeTooth(16), "molar_upper");
    assert.equal(categorizeTooth(28), "molar_upper");
  });

  it("molares inferiores (6, 7, 8 con cuadrante 3 o 4)", () => {
    assert.equal(categorizeTooth(36), "molar_lower");
    assert.equal(categorizeTooth(47), "molar_lower");
  });
});

describe("selectCanalSvg", () => {
  it("incisivo → incisor", () => {
    assert.equal(selectCanalSvg({ fdi: 11 }), "incisor");
  });

  it("canino → canine", () => {
    assert.equal(selectCanalSvg({ fdi: 13 }), "canine");
  });

  it("premolar superior 14 sin canales registrados → 2-canal (default)", () => {
    assert.equal(selectCanalSvg({ fdi: 14 }), "premolar-upper-2canal");
  });

  it("premolar superior 15 sin canales registrados → 1-canal (default)", () => {
    assert.equal(selectCanalSvg({ fdi: 15 }), "premolar-upper-1canal");
  });

  it("premolar superior 14 con 1 canal real registrado → 1-canal", () => {
    assert.equal(
      selectCanalSvg({ fdi: 14, actualCanals: ["CONDUCTO_UNICO"] }),
      "premolar-upper-1canal",
    );
  });

  it("premolar superior 15 con 2 canales reales → 2-canal", () => {
    assert.equal(
      selectCanalSvg({ fdi: 15, actualCanals: ["V", "P"] }),
      "premolar-upper-2canal",
    );
  });

  it("premolar inferior → premolar-lower", () => {
    assert.equal(selectCanalSvg({ fdi: 34 }), "premolar-lower");
  });

  it("molar superior 36 con MB2 registrado igual usa molar-upper-mb2", () => {
    assert.equal(selectCanalSvg({ fdi: 26 }), "molar-upper-mb2");
  });

  it("molar inferior 36 sin C-shape → molar-lower estándar", () => {
    assert.equal(
      selectCanalSvg({ fdi: 36, actualCanals: ["MV", "ML", "D"] }),
      "molar-lower",
    );
  });

  it("molar inferior con conductos C-shape (BUCCAL/LINGUAL) → c-shape", () => {
    assert.equal(
      selectCanalSvg({ fdi: 37, actualCanals: ["C_BUCCAL", "C_LINGUAL"] }),
      "molar-lower-cshape",
    );
  });
});

describe("QUALITY_COLORS", () => {
  it("tiene una entrada por cada calidad + 'none'", () => {
    const keys = Object.keys(QUALITY_COLORS).sort();
    assert.deepEqual(keys, [
      "ADECUADA", "CON_HUECOS", "HOMOGENEA",
      "SOBREOBTURADA", "SUBOBTURADA", "none",
    ]);
  });

  it("homogénea verde, sobreobturada rojo (clínicamente correcto)", () => {
    assert.match(QUALITY_COLORS.HOMOGENEA, /^#[0-9A-F]{6}$/i);
    assert.equal(QUALITY_COLORS.HOMOGENEA, "#22C55E");
    assert.equal(QUALITY_COLORS.SOBREOBTURADA, "#EF4444");
  });
});

describe("labelQuality", () => {
  it("traduce calidades al español", () => {
    assert.equal(labelQuality("HOMOGENEA"), "Homogénea");
    assert.equal(labelQuality("CON_HUECOS"), "Con huecos");
    assert.equal(labelQuality("SOBREOBTURADA"), "Sobreobturada");
  });

  it("null/undefined → 'Sin obturar'", () => {
    assert.equal(labelQuality(null), "Sin obturar");
    assert.equal(labelQuality(undefined), "Sin obturar");
  });
});

describe("labelCanalCanonicalName", () => {
  it("MB → Mesiovestibular, MB2 → MB2 (mantiene técnico)", () => {
    assert.equal(labelCanalCanonicalName("MB"), "Mesiovestibular");
    assert.equal(labelCanalCanonicalName("MB2"), "MB2");
  });

  it("CONDUCTO_UNICO → 'Conducto único'", () => {
    assert.equal(labelCanalCanonicalName("CONDUCTO_UNICO"), "Conducto único");
  });
});

describe("canonicalNameToSvgId", () => {
  it("MB → canal-mb", () => {
    assert.equal(canonicalNameToSvgId("MB"), "canal-mb");
  });

  it("MB2 → canal-mb2", () => {
    assert.equal(canonicalNameToSvgId("MB2"), "canal-mb2");
  });

  it("CONDUCTO_UNICO → canal-conducto-unico", () => {
    assert.equal(canonicalNameToSvgId("CONDUCTO_UNICO"), "canal-conducto-unico");
  });
});
