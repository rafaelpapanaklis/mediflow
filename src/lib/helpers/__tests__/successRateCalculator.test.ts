// Endodontics — tests para successRateCalculator. Spec §11.3, §15.1

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSuccessKpis,
  breakdownByToothCategory,
  breakdownByInstrumentationSystem,
} from "../successRateCalculator";
import type {
  EndodonticTreatmentRow,
  EndodonticFollowUpRow,
} from "@/lib/types/endodontics";

const baseTx: Omit<EndodonticTreatmentRow, "id" | "toothFdi" | "treatmentType"> = {
  clinicId: "c1", patientId: "p1", doctorId: "d1",
  diagnosisId: null,
  startedAt: new Date("2025-01-01"),
  completedAt: new Date("2025-01-02"),
  sessionsCount: 1, currentStep: 4, isMultiSession: false,
  rubberDamPlaced: true, accessType: null,
  instrumentationSystem: null, technique: null,
  motorBrand: null, torqueSettings: null, rpmSetting: null,
  irrigants: null, irrigationActivation: null, totalIrrigationMinutes: null,
  obturationTechnique: null, sealer: null, masterConePresetIso: null,
  postOpRestorationPlan: null, requiresPost: false, postMaterial: null,
  restorationUrgencyDays: null, restorationDoctorId: null,
  postOpRestorationCompletedAt: null,
  outcomeStatus: "COMPLETADO",
  notes: null,
  createdByUserId: "d1",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-02"),
  deletedAt: null,
};

const tx = (id: string, fdi: number, type: EndodonticTreatmentRow["treatmentType"], extra: Partial<EndodonticTreatmentRow> = {}): EndodonticTreatmentRow =>
  ({ ...baseTx, id, toothFdi: fdi, treatmentType: type, ...extra } as EndodonticTreatmentRow);

const fu = (
  id: string,
  txId: string,
  milestone: EndodonticFollowUpRow["milestone"],
  conclusion: EndodonticFollowUpRow["conclusion"] | null,
  performed: boolean,
): EndodonticFollowUpRow => ({
  id, treatmentId: txId, milestone,
  scheduledAt: new Date("2025-07-01"),
  performedAt: performed ? new Date("2025-07-15") : null,
  paiScore: null,
  symptomsPresent: null,
  conclusion,
  recommendedAction: null,
  controlFileId: null,
  notes: null,
  createdByUserId: "d1",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

describe("computeSuccessKpis", () => {
  it("devuelve 0 en todos los KPIs cuando no hay tratamientos", () => {
    const kpis = computeSuccessKpis({ treatments: [], followUps: [] });
    assert.equal(kpis.totalTreatments, 0);
    assert.equal(kpis.successRate12m, 0);
    assert.equal(kpis.successRate24m, 0);
    assert.equal(kpis.retreatmentRate, 0);
  });

  it("éxito 12m correcto: 3 controles, 2 éxitos = 66.7%", () => {
    const txs = [tx("t1", 36, "TC_PRIMARIO"), tx("t2", 26, "TC_PRIMARIO"), tx("t3", 16, "TC_PRIMARIO")];
    const fus = [
      fu("f1", "t1", "CONTROL_12M", "EXITO", true),
      fu("f2", "t2", "CONTROL_12M", "EXITO", true),
      fu("f3", "t3", "CONTROL_12M", "FRACASO", true),
    ];
    const kpis = computeSuccessKpis({ treatments: txs, followUps: fus });
    assert.equal(kpis.successRate12m, 66.7);
  });

  it("controles no realizados (performedAt null) no cuentan en éxito", () => {
    const txs = [tx("t1", 36, "TC_PRIMARIO"), tx("t2", 26, "TC_PRIMARIO")];
    const fus = [
      fu("f1", "t1", "CONTROL_12M", "EXITO", true),
      fu("f2", "t2", "CONTROL_12M", null, false),
    ];
    const kpis = computeSuccessKpis({ treatments: txs, followUps: fus });
    assert.equal(kpis.successRate12m, 100);
  });

  it("retreatmentRate: 1 retratamiento de 4 TC = 25%", () => {
    const txs = [
      tx("t1", 36, "TC_PRIMARIO"),
      tx("t2", 26, "TC_PRIMARIO"),
      tx("t3", 16, "TC_PRIMARIO"),
      tx("t4", 21, "RETRATAMIENTO"),
    ];
    const kpis = computeSuccessKpis({ treatments: txs, followUps: [] });
    assert.equal(kpis.totalTreatments, 4);
    assert.equal(kpis.retreatmentRate, 25);
  });

  it("ignora tratamientos abandonados o eliminados", () => {
    const txs = [
      tx("t1", 36, "TC_PRIMARIO"),
      tx("t2", 26, "TC_PRIMARIO", { outcomeStatus: "ABANDONADO" }),
      tx("t3", 16, "TC_PRIMARIO", { deletedAt: new Date() }),
    ];
    const kpis = computeSuccessKpis({ treatments: txs, followUps: [] });
    assert.equal(kpis.totalTreatments, 1);
  });

  it("followUpAdherence: 2 realizados de 3 ya pasados = 66.7%", () => {
    const past = new Date("2024-01-01");
    const txs = [tx("t1", 36, "TC_PRIMARIO")];
    const fus = [
      { ...fu("f1", "t1", "CONTROL_6M", "EXITO", true), scheduledAt: past },
      { ...fu("f2", "t1", "CONTROL_12M", "EXITO", true), scheduledAt: past },
      { ...fu("f3", "t1", "CONTROL_24M", null, false), scheduledAt: past },
    ];
    const kpis = computeSuccessKpis({ treatments: txs, followUps: fus });
    assert.equal(kpis.followUpAdherence, 66.7);
  });
});

describe("breakdownByToothCategory", () => {
  it("agrupa anterior/premolar/molar correctamente", () => {
    const txs = [
      tx("t1", 11, "TC_PRIMARIO"),  // anterior
      tx("t2", 13, "TC_PRIMARIO"),  // anterior (canino)
      tx("t3", 14, "TC_PRIMARIO"),  // premolar
      tx("t4", 36, "TC_PRIMARIO"),  // molar
      tx("t5", 26, "TC_PRIMARIO"),  // molar
    ];
    const result = breakdownByToothCategory({ treatments: txs, followUps: [] });
    const anterior = result.find((r) => r.category === "anterior")!;
    const premolar = result.find((r) => r.category === "premolar")!;
    const molar = result.find((r) => r.category === "molar")!;
    assert.equal(anterior.treatments, 2);
    assert.equal(premolar.treatments, 1);
    assert.equal(molar.treatments, 2);
  });
});

describe("breakdownByInstrumentationSystem", () => {
  it("agrupa por sistema de instrumentación e ignora null", () => {
    const txs = [
      tx("t1", 36, "TC_PRIMARIO", { instrumentationSystem: "PROTAPER_GOLD" }),
      tx("t2", 26, "TC_PRIMARIO", { instrumentationSystem: "PROTAPER_GOLD" }),
      tx("t3", 16, "TC_PRIMARIO", { instrumentationSystem: "WAVEONE_GOLD" }),
      tx("t4", 11, "TC_PRIMARIO", { instrumentationSystem: null }),
    ];
    const result = breakdownByInstrumentationSystem({ treatments: txs, followUps: [] });
    const protaper = result.find((r) => r.system === "PROTAPER_GOLD");
    const waveone = result.find((r) => r.system === "WAVEONE_GOLD");
    assert.equal(protaper?.treatments, 2);
    assert.equal(waveone?.treatments, 1);
    assert.equal(result.length, 2); // null excluido
  });
});
