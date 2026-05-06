import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMPLANT_REFERRAL_TEMPLATES,
  getImplantReferralTemplate,
  isImplantReferralKind,
  referralKindLabel,
  renderImplantReferralTemplate,
} from "../referral-letters";

describe("clinical-shared/referral-letters", () => {
  it("hay 4 plantillas builtin de referencia implantológica", () => {
    assert.equal(IMPLANT_REFERRAL_TEMPLATES.length, 4);
  });

  it("plantillas tienen toSpecialty + secciones no vacías", () => {
    for (const t of IMPLANT_REFERRAL_TEMPLATES) {
      assert.ok(t.toSpecialty);
      assert.ok(t.reasonTemplate);
      assert.ok(t.summaryTemplate);
      assert.ok(t.treatmentPlanTemplate);
    }
  });

  it("isImplantReferralKind", () => {
    assert.equal(isImplantReferralKind("envio_cirujano_oral"), true);
    assert.equal(isImplantReferralKind("garbage"), false);
  });

  it("getImplantReferralTemplate busca por kind", () => {
    const t = getImplantReferralTemplate("envio_prostodoncista");
    assert.equal(t.kind, "envio_prostodoncista");
    assert.equal(t.toSpecialty, "Prostodoncia");
  });

  it("getImplantReferralTemplate lanza si kind inexistente", () => {
    assert.throws(() =>
      // @ts-expect-error — pasando key inválida a propósito
      getImplantReferralTemplate("foo"),
    );
  });

  it("referralKindLabel devuelve etiquetas humanas", () => {
    assert.equal(referralKindLabel("envio_cirujano_oral"), "Envío a cirujano oral");
    assert.equal(
      referralKindLabel("envio_prostodoncista"),
      "Envío a prostodoncista",
    );
    // unknown kind devuelve el value
    assert.equal(referralKindLabel("inventado"), "inventado");
  });

  it("renderImplantReferralTemplate hidrata las 4 secciones", () => {
    const out = renderImplantReferralTemplate("envio_cirujano_oral", {
      patientName: "Juan Pérez",
      patientAge: 42,
      patientSex: "M",
      toothFdi: 36,
      implantBrand: "Straumann SLActive",
      implantDiameter: 4.1,
      implantLength: 10,
      connectionType: "Bone Level",
      currentPhase: "planning",
      medicalHistory: "controlado",
      habits: "no fumador",
      asa: "I",
      protocol: "DELAYED_2_STAGE",
      sutureMaterial: "vicryl 4-0",
    });
    assert.match(out.subject, /36/);
    assert.match(out.summary, /Juan Pérez/);
    assert.match(out.summary, /Straumann/);
    assert.match(out.reason, /36/);
    assert.match(out.treatmentPlan, /DELAYED_2_STAGE/);
  });

  it("renderImplantReferralTemplate deja placeholders sin valor", () => {
    const out = renderImplantReferralTemplate("envio_periodoncista", {
      patientName: "Ana",
      toothFdi: 16,
    });
    assert.match(out.summary, /Ana/);
    // bop sin valor queda literal
    assert.match(out.summary, /\{\{bop\}\}/);
  });
});
