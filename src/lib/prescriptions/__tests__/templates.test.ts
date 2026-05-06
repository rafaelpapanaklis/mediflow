import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRESCRIPTION_TEMPLATES,
  getPrescriptionTemplate,
  listPrescriptionTemplatesBySpecialty,
  renderPrescriptionTextPreview,
  IMPLANT_POST_SURGERY_TEMPLATE,
  IMPLANT_POST_SECOND_STAGE_TEMPLATE,
  IMPLANT_PERI_IMPLANTITIS_TEMPLATE,
} from "../templates";

describe("prescriptions/templates", () => {
  it("hay 3 plantillas builtin para implantes", () => {
    assert.equal(PRESCRIPTION_TEMPLATES.length, 3);
  });

  it("cada plantilla tiene specialty=implants", () => {
    for (const t of PRESCRIPTION_TEMPLATES) {
      assert.equal(t.specialty, "implants");
    }
  });

  it("post-surgery incluye amoxi+clavu, ibu, clorhexidina y colchicina", () => {
    const drugs = IMPLANT_POST_SURGERY_TEMPLATE.items.map((i) => i.drugName);
    assert.ok(drugs.some((d) => /Amoxicilina/i.test(d)));
    assert.ok(drugs.some((d) => /Ibuprofeno/i.test(d)));
    assert.ok(drugs.some((d) => /Clorhexidina/i.test(d)));
    assert.ok(drugs.some((d) => /Colchicina/i.test(d)));
  });

  it("post-second-stage NO incluye antibiótico (ibu + clorhexidina)", () => {
    const drugs = IMPLANT_POST_SECOND_STAGE_TEMPLATE.items.map((i) => i.drugName);
    assert.equal(drugs.length, 2);
    assert.ok(drugs.some((d) => /Ibuprofeno/i.test(d)));
    assert.ok(drugs.some((d) => /Clorhexidina/i.test(d)));
    assert.ok(!drugs.some((d) => /Amoxicilina/i.test(d)));
  });

  it("peri-implantitis incluye amoxi+clavu, ibu, clorhexidina", () => {
    const drugs = IMPLANT_PERI_IMPLANTITIS_TEMPLATE.items.map((i) => i.drugName);
    assert.ok(drugs.some((d) => /Amoxicilina/i.test(d)));
    assert.ok(drugs.some((d) => /Ibuprofeno/i.test(d)));
    assert.ok(drugs.some((d) => /Clorhexidina/i.test(d)));
  });

  it("getPrescriptionTemplate", () => {
    const t = getPrescriptionTemplate("implant_post_surgery");
    assert.equal(t.key, "implant_post_surgery");
  });

  it("getPrescriptionTemplate lanza si key inexistente", () => {
    assert.throws(() =>
      // @ts-expect-error — pasando key inválida a propósito
      getPrescriptionTemplate("garbage"),
    );
  });

  it("listPrescriptionTemplatesBySpecialty(implants) devuelve las 3", () => {
    assert.equal(listPrescriptionTemplatesBySpecialty("implants").length, 3);
  });

  it("renderPrescriptionTextPreview incluye drug + dosage + indicaciones", () => {
    const txt = renderPrescriptionTextPreview(IMPLANT_POST_SURGERY_TEMPLATE);
    assert.match(txt, /Amoxicilina/);
    assert.match(txt, /cada 12 horas/);
    assert.match(txt, /Indicaciones generales/);
    assert.match(txt, /No fumar/);
  });

  it("plantillas tienen indicaciones no vacías y posología", () => {
    for (const t of PRESCRIPTION_TEMPLATES) {
      assert.ok(t.indications.length > 0);
      for (const it of t.items) {
        assert.ok(it.dosage);
        assert.ok(it.duration);
        assert.ok(it.route);
      }
    }
  });
});
