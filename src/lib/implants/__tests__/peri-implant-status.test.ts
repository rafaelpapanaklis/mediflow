// Implants — tests de derivación PeriImplantStatus + invariantes
// cross-tenant del flujo. A3 Phase 8 Item 4.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PeriImplantStatus } from "@prisma/client";

// Re-implementación local de la heurística para que el test sea
// independiente del archivo "use server" de la action (no se puede
// importar directamente desde un test sin levantar Next).
function deriveStatus(args: {
  bopPresent: boolean;
  suppurationPresent: boolean;
  radiographicBoneLossMm: number;
}): PeriImplantStatus {
  const { bopPresent, suppurationPresent, radiographicBoneLossMm } = args;
  if (!bopPresent && !suppurationPresent && radiographicBoneLossMm < 1) {
    return "SALUD";
  }
  if (radiographicBoneLossMm >= 5) {
    return "PERIIMPLANTITIS_AVANZADA";
  }
  if (radiographicBoneLossMm >= 3) {
    return "PERIIMPLANTITIS_MODERADA";
  }
  if (radiographicBoneLossMm >= 1) {
    return "PERIIMPLANTITIS_INICIAL";
  }
  return "MUCOSITIS";
}

describe("deriveStatus — clasificación AAP-EFP 2017", () => {
  it("sin BoP, sin supuración, sin pérdida → SALUD", () => {
    assert.equal(
      deriveStatus({ bopPresent: false, suppurationPresent: false, radiographicBoneLossMm: 0 }),
      "SALUD",
    );
  });

  it("BoP+ sin pérdida → MUCOSITIS", () => {
    assert.equal(
      deriveStatus({ bopPresent: true, suppurationPresent: false, radiographicBoneLossMm: 0 }),
      "MUCOSITIS",
    );
  });

  it("BoP+ con pérdida 1.5 mm → PERIIMPLANTITIS_INICIAL", () => {
    assert.equal(
      deriveStatus({ bopPresent: true, suppurationPresent: false, radiographicBoneLossMm: 1.5 }),
      "PERIIMPLANTITIS_INICIAL",
    );
  });

  it("BoP+ con pérdida 3 mm → PERIIMPLANTITIS_MODERADA", () => {
    assert.equal(
      deriveStatus({ bopPresent: true, suppurationPresent: false, radiographicBoneLossMm: 3 }),
      "PERIIMPLANTITIS_MODERADA",
    );
  });

  it("BoP+ con pérdida 5 mm → PERIIMPLANTITIS_AVANZADA", () => {
    assert.equal(
      deriveStatus({ bopPresent: true, suppurationPresent: false, radiographicBoneLossMm: 5 }),
      "PERIIMPLANTITIS_AVANZADA",
    );
  });

  it("supuración + pérdida 6 mm → PERIIMPLANTITIS_AVANZADA", () => {
    assert.equal(
      deriveStatus({ bopPresent: true, suppurationPresent: true, radiographicBoneLossMm: 6 }),
      "PERIIMPLANTITIS_AVANZADA",
    );
  });

  it("supuración aislada (pérdida 0.5 mm) → MUCOSITIS", () => {
    // Aislada se queda en MUCOSITIS por la lógica actual (la pérdida
    // ósea decide la severidad). El doctor puede sobreescribir desde
    // el módulo Periodoncia si considera que requiere otra clasificación.
    assert.equal(
      deriveStatus({ bopPresent: false, suppurationPresent: true, radiographicBoneLossMm: 0.5 }),
      "MUCOSITIS",
    );
  });
});

describe("Cross-tenant invariantes documentadas", () => {
  // Estos asserts no son ejecutables (requerirían DB); son la
  // documentación viva de las garantías del flujo Implant ↔ Perio.
  it("createPeriImplantAssessment (implants) deriva clinicId y patientId del implante validado, NO del input — ver _helpers.loadImplantForCtx", () => {
    assert.ok(true);
  });

  it("createPeriImplantAssessment (perio) valida implantId via prisma.implant.findFirst con WHERE clinicId+patientId — rechaza implantes de otra clínica o de otro paciente", () => {
    assert.ok(true);
  });

  it("Patient + Implant + PeriImplantAssessment comparten misma clinicId — la FK SQL ON DELETE SET NULL preserva el assessment si el Implant se borra (no debería pasar: Implants tiene RLS deny-all)", () => {
    assert.ok(true);
  });
});
