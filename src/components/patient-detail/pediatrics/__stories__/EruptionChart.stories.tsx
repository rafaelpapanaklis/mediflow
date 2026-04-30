// Pediatrics — Storybook story para EruptionChart. Spec: §1.9, commit 20

import { EruptionChart } from "../charts/EruptionChart";
import type { EruptionRecordRow } from "@/types/pediatrics";

export default {
  title: "Pediatrics/Charts/EruptionChart",
  component: EruptionChart,
};

const baseRecord = (fdi: number, ageDecimal: number, deviation: string): EruptionRecordRow => ({
  id: `r-${fdi}`,
  clinicId: "demo",
  patientId: "demo",
  pediatricRecordId: "demo",
  toothFdi: fdi,
  observedAt: new Date(2024, 0, 1),
  ageAtEruptionDecimal: ageDecimal as unknown as EruptionRecordRow["ageAtEruptionDecimal"],
  withinExpectedRange: deviation === "within",
  deviation,
  notes: null,
  recordedBy: "demo",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

export const MateoSinRegistros = {
  render: () => (
    <EruptionChart
      patientAgeMonths={55}
      records={[]}
    />
  ),
};

export const SofiaConRegistros = {
  render: () => (
    <EruptionChart
      patientAgeMonths={98}
      records={[
        baseRecord(11, 6.6, "within"),
        baseRecord(21, 6.7, "within"),
        baseRecord(31, 5.9, "within"),
        baseRecord(41, 6.1, "within"),
        baseRecord(16, 7.5, "mild"),
      ]}
    />
  ),
};
