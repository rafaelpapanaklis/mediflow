// Clinical-shared — tests de las plantillas WhatsApp para reminders clínicos
// (pediatrics + orto unificados — el archivo templates.ts vive en main).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CLINICAL_REMINDER_TEMPLATES } from "../templates";

const PEDIATRIC_KEYS = [
  "ped_profilaxis_6m",
  "ped_control_erupcion_anual",
  "ped_cumpleanos_paciente",
] as const;

const ORTHO_KEYS = [
  "ortho_control_30d",
  "ortho_retention_check",
  "ortho_aligner_change_2w",
  "ortho_aligner_change_1w_urgent",
  "ortho_appliance_removal_soon",
] as const;

describe("CLINICAL_REMINDER_TEMPLATES — pediatrics", () => {
  const ctx = {
    childName: "Sofía",
    guardianName: "Sra. Méndez",
    clinicName: "Clínica Demo",
  };

  it("incluye los 3 tipos pediátricos requeridos", () => {
    for (const k of PEDIATRIC_KEYS) {
      assert.ok(k in CLINICAL_REMINDER_TEMPLATES, `Falta template ${k}`);
    }
  });

  it("ped_profilaxis_6m menciona al niño por nombre y al tutor", () => {
    const out = CLINICAL_REMINDER_TEMPLATES.ped_profilaxis_6m.build(ctx);
    assert.match(out, /Sofía/);
    assert.match(out, /Sra\. Méndez/);
    assert.match(out, /Clínica Demo/);
  });

  it("ped_cumpleanos_paciente felicita al menor", () => {
    const out = CLINICAL_REMINDER_TEMPLATES.ped_cumpleanos_paciente.build(ctx);
    assert.match(out, /Felicidades/i);
    assert.match(out, /Sofía/);
  });

  it("todos los pediátricos usan prefijo PED_REMINDER_", () => {
    for (const k of PEDIATRIC_KEYS) {
      assert.equal(CLINICAL_REMINDER_TEMPLATES[k].prefix, "PED_REMINDER_");
    }
  });
});

describe("CLINICAL_REMINDER_TEMPLATES — orto", () => {
  it("expone los 5 tipos orto requeridos", () => {
    for (const k of ORTHO_KEYS) {
      assert.ok(k in CLINICAL_REMINDER_TEMPLATES, `Falta template ${k}`);
    }
  });

  it("todos los templates orto usan prefijo ORTHO_REMINDER_", () => {
    for (const k of ORTHO_KEYS) {
      assert.equal(CLINICAL_REMINDER_TEMPLATES[k].prefix, "ORTHO_REMINDER_");
    }
  });

  it("builders producen mensajes no vacíos con interpolación correcta", () => {
    const ctx = {
      patientName: "Andrés",
      clinicName: "Clínica Test",
      monthInTreatment: 6,
    };
    for (const k of ORTHO_KEYS) {
      const msg = CLINICAL_REMINDER_TEMPLATES[k].build(ctx);
      assert.ok(msg.length > 30, `${k} produjo mensaje vacío`);
      assert.ok(
        msg.includes("Andrés") || msg.includes("Clínica Test"),
        `${k} no usa el contexto`,
      );
    }
  });

  it("cada template orto tiene label legible en español", () => {
    for (const k of ORTHO_KEYS) {
      assert.ok(CLINICAL_REMINDER_TEMPLATES[k].label.length > 0);
    }
  });
});
