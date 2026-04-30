// Pediatrics — tests para CAMBRA scoring. Spec: §4.A.1, §6.1 casos del brief.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreCambra } from "../cambra";

describe("scoreCambra", () => {
  it("Mateo (Alto): 1 indicador + biberón nocturno + dieta cariogénica + higiene deficiente -> alto, recall 4m", () => {
    const result = scoreCambra({
      diseaseIndicators: ["mancha_blanca"],
      riskFactors: ["biberon_nocturno", "dieta_cariogenica", "higiene_deficiente"],
      protectiveFactors: ["pasta_fluor"],
    });
    assert.equal(result.category, "extremo");
    assert.equal(result.recallMonths, 3);
  });

  it("Sofía (Moderado): 0 indicadores + 2 riesgos + 2 protectores -> moderado, recall 6m", () => {
    const result = scoreCambra({
      diseaseIndicators: [],
      riskFactors: ["snacks_frecuentes", "higiene_deficiente"],
      protectiveFactors: ["pasta_fluor", "agua_fluorada"],
    });
    assert.equal(result.category, "moderado");
    assert.equal(result.recallMonths, 6);
  });

  it("Diego (Bajo): 0 indicadores, 0 riesgos, 4+ protectores -> bajo, recall 6m", () => {
    const result = scoreCambra({
      diseaseIndicators: [],
      riskFactors: [],
      protectiveFactors: ["pasta_fluor", "agua_fluorada", "barniz_6m", "selladores"],
    });
    assert.equal(result.category, "bajo");
    assert.equal(result.recallMonths, 6);
  });

  it("Extremo: 2 indicadores -> extremo, recall 3m", () => {
    const result = scoreCambra({
      diseaseIndicators: ["lesion_cavitaria", "mancha_blanca"],
      riskFactors: [],
      protectiveFactors: [],
    });
    assert.equal(result.category, "extremo");
    assert.equal(result.recallMonths, 3);
  });

  it("Alto: 3 riesgos sin indicadores -> alto", () => {
    const result = scoreCambra({
      diseaseIndicators: [],
      riskFactors: ["biberon_nocturno", "dieta_cariogenica", "higiene_deficiente"],
      protectiveFactors: ["pasta_fluor"],
    });
    assert.equal(result.category, "alto");
    assert.equal(result.recallMonths, 4);
  });

  it("rationale resume los conteos en una oración", () => {
    const result = scoreCambra({
      diseaseIndicators: ["mancha_blanca"],
      riskFactors: ["dieta_cariogenica"],
      protectiveFactors: ["pasta_fluor"],
    });
    assert.match(result.rationale, /1 indicador/);
    assert.match(result.rationale, /1 factor de riesgo/);
    assert.match(result.rationale, /1 factor protector/);
  });
});
