// Clinical-shared — tests de las plantillas de WhatsApp para reminders clínicos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CLINICAL_REMINDER_TEMPLATES } from "../templates";

describe("CLINICAL_REMINDER_TEMPLATES", () => {
  const ctx = {
    childName: "Sofía",
    guardianName: "Sra. Méndez",
    clinicName: "Clínica Demo",
  };

  it("incluye los 3 tipos pediátricos requeridos por la spec", () => {
    assert.ok("ped_profilaxis_6m" in CLINICAL_REMINDER_TEMPLATES);
    assert.ok("ped_control_erupcion_anual" in CLINICAL_REMINDER_TEMPLATES);
    assert.ok("ped_cumpleanos_paciente" in CLINICAL_REMINDER_TEMPLATES);
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

  it("todos los pediátricos comparten prefijo PED_REMINDER_", () => {
    for (const k of Object.keys(CLINICAL_REMINDER_TEMPLATES)) {
      assert.equal(
        CLINICAL_REMINDER_TEMPLATES[k as keyof typeof CLINICAL_REMINDER_TEMPLATES]
          .prefix,
        "PED_REMINDER_",
      );
    }
  });
});
