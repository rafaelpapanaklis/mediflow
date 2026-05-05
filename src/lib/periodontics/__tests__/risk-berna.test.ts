// Periodontics — tests computeBernaRisk. SPEC §13.1

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeBernaRisk } from "../risk-berna";

describe("computeBernaRisk", () => {
  it("riesgo BAJO con BoP <10, sitios residuales ≤4, sin tabaco, sin diabetes", () => {
    const out = computeBernaRisk({
      bopPct: 5,
      residualSites5Plus: 2,
      lostTeethPerio: 1,
      smokingStatus: "NO",
      hba1c: 5.5,
      boneLossAgeRatio: 0.1,
    });
    assert.equal(out.riskCategory, "BAJO");
    assert.equal(out.recommendedRecallMonths, 6);
    assert.equal(out.factors.length, 6);
  });

  it("riesgo ALTO si BoP ≥25%", () => {
    const out = computeBernaRisk({
      bopPct: 30,
      residualSites5Plus: 0,
      lostTeethPerio: 0,
      smokingStatus: "NO",
    });
    assert.equal(out.riskCategory, "ALTO");
    assert.equal(out.recommendedRecallMonths, 3);
  });

  it("riesgo ALTO si tabaquismo ≥10/día", () => {
    const out = computeBernaRisk({
      bopPct: 5,
      residualSites5Plus: 0,
      lostTeethPerio: 0,
      smokingStatus: "MAYOR_O_IGUAL_10",
    });
    assert.equal(out.riskCategory, "ALTO");
  });

  it("riesgo ALTO si HbA1c ≥7.5", () => {
    const out = computeBernaRisk({
      bopPct: 5,
      residualSites5Plus: 0,
      lostTeethPerio: 0,
      smokingStatus: "NO",
      hba1c: 8.0,
    });
    assert.equal(out.riskCategory, "ALTO");
  });

  it("riesgo MODERADO con sitios residuales 5-8", () => {
    const out = computeBernaRisk({
      bopPct: 5,
      residualSites5Plus: 6,
      lostTeethPerio: 0,
      smokingStatus: "NO",
    });
    assert.equal(out.riskCategory, "MODERADO");
    assert.equal(out.recommendedRecallMonths, 4);
  });

  it("recommendedRecallMonths: BAJO=6, MODERADO=4, ALTO=3", () => {
    const bajo = computeBernaRisk({ bopPct: 5, residualSites5Plus: 0, lostTeethPerio: 0, smokingStatus: "NO" });
    const moderado = computeBernaRisk({ bopPct: 15, residualSites5Plus: 0, lostTeethPerio: 0, smokingStatus: "NO" });
    const alto = computeBernaRisk({ bopPct: 30, residualSites5Plus: 0, lostTeethPerio: 0, smokingStatus: "NO" });
    assert.equal(bajo.recommendedRecallMonths, 6);
    assert.equal(moderado.recommendedRecallMonths, 4);
    assert.equal(alto.recommendedRecallMonths, 3);
  });

  it("omite factores opcionales no provistos (boneLossAgeRatio, hba1c)", () => {
    const out = computeBernaRisk({
      bopPct: 5,
      residualSites5Plus: 0,
      lostTeethPerio: 0,
      smokingStatus: "NO",
      // hba1c y boneLossAgeRatio omitidos
    });
    // 6 - 2 opcionales = 4 factores
    assert.equal(out.factors.length, 4);
    assert.ok(!out.factors.some((f) => f.name === "HbA1c"));
    assert.ok(!out.factors.some((f) => f.name === "BL/edad"));
  });

  it("BL/edad >1.0 contribuye nivel ALTO", () => {
    const out = computeBernaRisk({
      bopPct: 5,
      residualSites5Plus: 0,
      lostTeethPerio: 0,
      smokingStatus: "NO",
      boneLossAgeRatio: 1.5,
    });
    assert.equal(out.riskCategory, "ALTO");
  });
});
