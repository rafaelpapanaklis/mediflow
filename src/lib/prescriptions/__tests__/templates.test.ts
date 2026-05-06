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
  ENDO_POST_TC_BASIC_TEMPLATE,
  ENDO_POST_TC_ABSCESO_TEMPLATE,
  ENDO_POST_CIRUGIA_APICAL_TEMPLATE,
} from "../templates";

describe("prescriptions/templates", () => {
  it("incluye 3 plantillas implants + 3 endodoncia (6 total)", () => {
    assert.equal(PRESCRIPTION_TEMPLATES.length, 6);
  });

  it("cada plantilla tiene specialty implants o endodontics", () => {
    for (const t of PRESCRIPTION_TEMPLATES) {
      assert.ok(t.specialty === "implants" || t.specialty === "endodontics");
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

  it("endo_post_tc_basic — ibuprofeno 600 mg c/8h x 3d (Roberto Salinas TC 36)", () => {
    const drugs = ENDO_POST_TC_BASIC_TEMPLATE.items.map((i) => i.drugName);
    assert.equal(drugs.length, 1);
    const ibu = ENDO_POST_TC_BASIC_TEMPLATE.items[0]!;
    assert.match(ibu.drugName, /Ibuprofeno/i);
    assert.match(ibu.presentation, /600 mg/);
    assert.match(ibu.dosage, /cada 8 horas/);
    assert.match(ibu.duration, /3 días/);
  });

  it("endo_post_tc_absceso — incluye amoxi+clavu + ibuprofeno (Mariana Torres retx 21)", () => {
    const drugs = ENDO_POST_TC_ABSCESO_TEMPLATE.items.map((i) => i.drugName);
    assert.ok(drugs.some((d) => /Amoxicilina/i.test(d)));
    assert.ok(drugs.some((d) => /Ibuprofeno/i.test(d)));
    const amoxi = ENDO_POST_TC_ABSCESO_TEMPLATE.items.find((i) =>
      /Amoxicilina/i.test(i.drugName),
    )!;
    assert.match(amoxi.presentation, /500\/125 mg/);
    assert.match(amoxi.duration, /7 días/);
  });

  it("endo_post_cirugia_apical — incluye amoxi+clavu + ibu + clorhexidina", () => {
    const drugs = ENDO_POST_CIRUGIA_APICAL_TEMPLATE.items.map((i) => i.drugName);
    assert.ok(drugs.some((d) => /Amoxicilina/i.test(d)));
    assert.ok(drugs.some((d) => /Ibuprofeno/i.test(d)));
    assert.ok(drugs.some((d) => /Clorhexidina/i.test(d)));
  });

  it("indicaciones de cirugía apical incluyen hielo y retiro de puntos", () => {
    assert.match(ENDO_POST_CIRUGIA_APICAL_TEMPLATE.indications.toLowerCase(), /hielo/);
    assert.match(ENDO_POST_CIRUGIA_APICAL_TEMPLATE.indications.toLowerCase(), /retiro/);
  });

  it("getPrescriptionTemplate", () => {
    const t = getPrescriptionTemplate("implant_post_surgery");
    assert.equal(t.key, "implant_post_surgery");
    const t2 = getPrescriptionTemplate("endo_post_tc_basic");
    assert.equal(t2.key, "endo_post_tc_basic");
  });

  it("getPrescriptionTemplate lanza si key inexistente", () => {
    assert.throws(() =>
      // @ts-expect-error — pasando key inválida a propósito
      getPrescriptionTemplate("garbage"),
    );
  });

  it("listPrescriptionTemplatesBySpecialty filtra por especialidad", () => {
    assert.equal(listPrescriptionTemplatesBySpecialty("implants").length, 3);
    assert.equal(listPrescriptionTemplatesBySpecialty("endodontics").length, 3);
  });

  it("renderPrescriptionTextPreview incluye drug + dosage + indicaciones", () => {
    const txt = renderPrescriptionTextPreview(IMPLANT_POST_SURGERY_TEMPLATE);
    assert.match(txt, /Amoxicilina/);
    assert.match(txt, /cada 12 horas/);
    assert.match(txt, /Indicaciones generales/);
    assert.match(txt, /No fumar/);
  });

  it("renderPrescriptionTextPreview funciona para plantillas endo (Carlos Mendoza control 12m)", () => {
    const txt = renderPrescriptionTextPreview(ENDO_POST_TC_BASIC_TEMPLATE);
    assert.match(txt, /Ibuprofeno/);
    assert.match(txt, /600 mg/);
    assert.match(txt, /Indicaciones generales/);
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
