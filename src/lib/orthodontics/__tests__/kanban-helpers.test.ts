// Orthodontics — tests kanban-helpers. SPEC §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KANBAN_COLUMN_CAP,
  PHASE_LABELS,
  groupCardsByPhase,
  progressPct,
} from "../kanban-helpers";
import { PHASE_ORDER } from "../phase-machine";
import type { OrthoKanbanCard } from "@/lib/types/orthodontics";

function card(overrides: Partial<OrthoKanbanCard> = {}): OrthoKanbanCard {
  return {
    treatmentPlanId: overrides.treatmentPlanId ?? "plan-1",
    patientId: overrides.patientId ?? "p-1",
    patientName: overrides.patientName ?? "Andrea",
    monthInTreatment: overrides.monthInTreatment ?? 1,
    estimatedDurationMonths: overrides.estimatedDurationMonths ?? 18,
    progressPct: overrides.progressPct ?? 0,
    currentPhaseKey: overrides.currentPhaseKey ?? "ALIGNMENT",
    technique: overrides.technique ?? "METAL_BRACKETS",
    compliance: overrides.compliance ?? { level: "ok", attended: 3 },
    paymentStatus: overrides.paymentStatus ?? "ON_TIME",
    amountOverdueMxn: overrides.amountOverdueMxn ?? 0,
    daysOverdue: overrides.daysOverdue ?? 0,
  };
}

describe("kanban-helpers", () => {
  it("PHASE_LABELS tiene una etiqueta por fase", () => {
    for (const phase of PHASE_ORDER) {
      assert.ok(PHASE_LABELS[phase].length > 0);
    }
  });

  it("groupCardsByPhase agrupa correctamente y crea las 6 columnas", () => {
    const cards = [
      card({ currentPhaseKey: "ALIGNMENT" }),
      card({ currentPhaseKey: "LEVELING" }),
      card({ currentPhaseKey: "ALIGNMENT" }),
    ];
    const map = groupCardsByPhase(cards);
    assert.equal(map.size, 6);
    assert.equal(map.get("ALIGNMENT")!.cards.length, 2);
    assert.equal(map.get("LEVELING")!.cards.length, 1);
    assert.equal(map.get("RETENTION")!.cards.length, 0);
  });

  it("ordena por monthInTreatment desc dentro de cada columna", () => {
    const cards = [
      card({ monthInTreatment: 3, treatmentPlanId: "a" }),
      card({ monthInTreatment: 12, treatmentPlanId: "b" }),
      card({ monthInTreatment: 7, treatmentPlanId: "c" }),
    ];
    const map = groupCardsByPhase(cards);
    const align = map.get("ALIGNMENT")!.cards;
    assert.deepEqual(
      align.map((c) => c.treatmentPlanId),
      ["b", "c", "a"],
    );
  });

  it("aplica cap 50 y reporta truncatedCount", () => {
    const many = Array.from({ length: 75 }, (_, i) =>
      card({ treatmentPlanId: `p-${i}`, monthInTreatment: i }),
    );
    const map = groupCardsByPhase(many);
    const col = map.get("ALIGNMENT")!;
    assert.equal(col.cards.length, KANBAN_COLUMN_CAP);
    assert.equal(col.totalCount, 75);
    assert.equal(col.truncatedCount, 25);
  });

  it("progressPct clamped entre 0 y 100", () => {
    assert.equal(progressPct(0, 18), 0);
    assert.equal(progressPct(9, 18), 50);
    assert.equal(progressPct(18, 18), 100);
    assert.equal(progressPct(20, 18), 100); // clamped
    assert.equal(progressPct(0, 0), 0); // safe div
    assert.equal(progressPct(-1, 18), 0); // clamped
  });
});
