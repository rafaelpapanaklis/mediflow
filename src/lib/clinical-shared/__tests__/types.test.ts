import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isImplantPhaseKey,
  isImplantPhotoType,
  isImplantLabOrderSubtype,
  IMPLANT_PHASE_KEYS,
  IMPLANT_PHOTO_TYPES,
  IMPLANT_LAB_ORDER_SUBTYPES,
  IMPLANT_REMINDER_OFFSETS_DAYS,
  IMPLANT_REMINDER_RULE_KEYS,
  implantSubtypeToLabOrderType,
  implantReminderRuleToReminderType,
  implantPhotoTypeToPhase,
} from "../types";

describe("clinical-shared/types", () => {
  it("phase keys conocidos", () => {
    for (const k of IMPLANT_PHASE_KEYS) {
      assert.equal(isImplantPhaseKey(k), true);
    }
    assert.equal(isImplantPhaseKey("inventado"), false);
  });

  it("photo types específicos de implantes", () => {
    for (const t of IMPLANT_PHOTO_TYPES) {
      assert.equal(isImplantPhotoType(t), true);
    }
    assert.equal(isImplantPhotoType("garbage"), false);
  });

  it("lab order subtypes", () => {
    for (const s of IMPLANT_LAB_ORDER_SUBTYPES) {
      assert.equal(isImplantLabOrderSubtype(s), true);
    }
    assert.equal(isImplantLabOrderSubtype("foo"), false);
  });

  it("offsets de reminder coherentes", () => {
    for (const k of IMPLANT_REMINDER_RULE_KEYS) {
      assert.equal(typeof IMPLANT_REMINDER_OFFSETS_DAYS[k], "number");
      assert.ok(IMPLANT_REMINDER_OFFSETS_DAYS[k] > 0);
    }
    assert.equal(IMPLANT_REMINDER_OFFSETS_DAYS.control_cicatrizacion_7d, 7);
    assert.equal(IMPLANT_REMINDER_OFFSETS_DAYS.retiro_sutura_10d, 10);
    assert.equal(IMPLANT_REMINDER_OFFSETS_DAYS.control_anual_implante, 365);
  });

  it("implantSubtypeToLabOrderType mapea correctamente", () => {
    assert.equal(
      implantSubtypeToLabOrderType("pilar_personalizado"),
      "custom_abutment",
    );
    assert.equal(implantSubtypeToLabOrderType("guia_quirurgica"), "surgical_guide");
    assert.equal(implantSubtypeToLabOrderType("protesis_atornillada"), "crown");
    assert.equal(implantSubtypeToLabOrderType("modelo_estudio_digital"), "other");
  });

  it("implantReminderRuleToReminderType mapea al set v2 granular", () => {
    assert.equal(
      implantReminderRuleToReminderType("control_anual_implante"),
      "implant_control_anual",
    );
    assert.equal(
      implantReminderRuleToReminderType("control_oseointegracion_4m"),
      "implant_oseointegracion_4m",
    );
    assert.equal(
      implantReminderRuleToReminderType("control_cicatrizacion_7d"),
      "implant_cicatrizacion_7d",
    );
  });

  it("implantPhotoTypeToPhase para set v2", () => {
    assert.equal(implantPhotoTypeToPhase("pre_surgical"), "planning");
    assert.equal(implantPhotoTypeToPhase("surgical_phase"), "surgical");
    assert.equal(implantPhotoTypeToPhase("implant_healing"), "healing");
    assert.equal(implantPhotoTypeToPhase("second_stage"), "second_stage");
    assert.equal(implantPhotoTypeToPhase("prosthetic_placement"), "prosthetic");
    assert.equal(implantPhotoTypeToPhase("follow_up_radiograph"), "follow_up");
    assert.equal(implantPhotoTypeToPhase("peri_implant_check"), "follow_up");
  });
});
