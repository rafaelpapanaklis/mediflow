import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeDueDate,
  planImplantReminderRules,
  renderImplantReminderMessage,
  getImplantReminderRuleSpec,
  IMPLANT_REMINDER_RULES,
  isImplantReminderRuleKey,
  implantReminderRuleToReminderType,
} from "../reminder-rules";

describe("clinical-shared/reminder-rules", () => {
  it("computeDueDate suma días y fija 15Z", () => {
    const base = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const out = computeDueDate(base, 7);
    assert.equal(out.getUTCFullYear(), 2026);
    assert.equal(out.getUTCMonth(), 0);
    assert.equal(out.getUTCDate(), 8);
    assert.equal(out.getUTCHours(), 15);
    assert.equal(out.getUTCMinutes(), 0);
  });

  it("planImplantReminderRules vacío sin fechas", () => {
    assert.equal(planImplantReminderRules({}).length, 0);
  });

  it("planImplantReminderRules con surgeryDate programa 3", () => {
    const out = planImplantReminderRules({
      surgeryDate: new Date(Date.UTC(2026, 0, 1)),
    });
    assert.equal(
      out.filter((x) => x.rule.triggeredBy === "SURGERY_DATE").length,
      3,
    );
  });

  it("planImplantReminderRules con prosthesisDeliveredAt programa 2", () => {
    const out = planImplantReminderRules({
      prosthesisDeliveredAt: new Date(Date.UTC(2026, 5, 1)),
    });
    assert.equal(
      out.filter((x) => x.rule.triggeredBy === "PROSTHESIS_DELIVERED_AT").length,
      2,
    );
  });

  it("renderImplantReminderMessage hidrata placeholders", () => {
    const m = renderImplantReminderMessage("control_cicatrizacion_7d", {
      patientName: "Juan",
      toothFdi: 36,
    });
    assert.match(m, /Juan/);
    assert.match(m, /36/);
  });

  it("renderImplantReminderMessage deja placeholders sin valor", () => {
    const m = renderImplantReminderMessage("retiro_sutura_10d", {
      patientName: "Ana",
    });
    assert.match(m, /Ana/);
    assert.match(m, /\{\{toothFdi\}\}/);
  });

  it("getImplantReminderRuleSpec", () => {
    const r = getImplantReminderRuleSpec("control_anual_implante");
    assert.equal(r.triggeredBy, "PROSTHESIS_DELIVERED_AT");
    assert.equal(r.triggerOffsetDays, 365);
    assert.equal(r.reminderType, "implant_control_anual");
  });

  it("hay 5 reglas builtin", () => {
    assert.equal(IMPLANT_REMINDER_RULES.length, 5);
  });

  it("isImplantReminderRuleKey", () => {
    assert.equal(isImplantReminderRuleKey("control_anual_implante"), true);
    assert.equal(isImplantReminderRuleKey("garbage"), false);
  });

  it("implantReminderRuleToReminderType mapea al set v2", () => {
    assert.equal(
      implantReminderRuleToReminderType("control_anual_implante"),
      "implant_control_anual",
    );
    assert.equal(
      implantReminderRuleToReminderType("control_cicatrizacion_7d"),
      "implant_cicatrizacion_7d",
    );
    assert.equal(
      implantReminderRuleToReminderType("control_peri_implantitis_6m"),
      "implant_peri_implantitis_6m",
    );
  });
});
