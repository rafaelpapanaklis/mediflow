import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseImplantLabOrderInput,
  validateImplantLabSpecs,
  canTransitionLabOrder,
  isLabOrderTerminal,
  nextLabOrderStatuses,
  IMPLANT_LAB_ORDER_SUBTYPES,
  implantLabOrderSubtypeLabel,
  labOrderStatusLabel,
} from "../lab-orders";

describe("clinical-shared/lab-orders", () => {
  it("validateImplantLabSpecs valida pilar_personalizado", () => {
    const out = validateImplantLabSpecs({
      implantOrderSubtype: "pilar_personalizado",
      implantBrand: "Straumann SLActive",
      implantPlatform: "RC",
      implantDiameterMm: 4.1,
      abutmentMaterial: "ZIRCONIO",
      emergenceProfile: "RECTO",
      mucosalHeightMm: 2.5,
      angulationDeg: 0,
      finishLineHeightMm: 1.0,
    });
    assert.equal(out.implantOrderSubtype, "pilar_personalizado");
    if (out.implantOrderSubtype === "pilar_personalizado") {
      assert.equal(out.abutmentMaterial, "ZIRCONIO");
    }
  });

  it("validateImplantLabSpecs falla si faltan campos críticos", () => {
    assert.throws(() =>
      validateImplantLabSpecs({
        implantOrderSubtype: "protesis_atornillada",
        implantBrand: "x",
      }),
    );
  });

  it("parseImplantLabOrderInput exige module=implants", () => {
    assert.throws(() =>
      parseImplantLabOrderInput({
        patientId: "p1",
        module: "endodontics",
        orderType: "custom_abutment",
        spec: {},
      }),
    );
  });

  it("parseImplantLabOrderInput valida spec por subtype", () => {
    const out = parseImplantLabOrderInput({
      patientId: "p1",
      module: "implants",
      orderType: "surgical_guide",
      spec: {
        implantOrderSubtype: "guia_quirurgica",
        implantBrand: "Nobel",
        implantPlatform: "NP",
        guideType: "TOOTH_SUPPORTED",
        drillKit: "Nobel Active",
        fullyGuided: true,
      },
    });
    assert.equal(out.subtype, "guia_quirurgica");
    assert.equal(out.base.orderType, "surgical_guide");
  });

  it("parseImplantLabOrderInput rechaza orderType incompatible con subtype", () => {
    assert.throws(() =>
      parseImplantLabOrderInput({
        patientId: "p1",
        module: "implants",
        orderType: "crown", // debería ser surgical_guide
        spec: {
          implantOrderSubtype: "guia_quirurgica",
          implantBrand: "Nobel",
          implantPlatform: "NP",
          guideType: "TOOTH_SUPPORTED",
          drillKit: "Nobel Active",
          fullyGuided: true,
        },
      }),
    );
  });

  it("máquina de estados estricta", () => {
    assert.equal(canTransitionLabOrder("draft", "sent"), true);
    assert.equal(canTransitionLabOrder("draft", "received"), false);
    assert.equal(canTransitionLabOrder("received", "sent"), false);
    assert.equal(canTransitionLabOrder("sent", "received"), true);
    assert.equal(canTransitionLabOrder("in_progress", "received"), true);
  });

  it("isLabOrderTerminal", () => {
    assert.equal(isLabOrderTerminal("received"), true);
    assert.equal(isLabOrderTerminal("cancelled"), true);
    assert.equal(isLabOrderTerminal("draft"), false);
    assert.equal(isLabOrderTerminal("sent"), false);
  });

  it("nextLabOrderStatuses para terminales devuelve []", () => {
    assert.deepEqual(nextLabOrderStatuses("received"), []);
    assert.deepEqual(nextLabOrderStatuses("cancelled"), []);
  });

  it("hay 5 implant lab order subtypes", () => {
    assert.equal(IMPLANT_LAB_ORDER_SUBTYPES.length, 5);
  });

  it("etiquetas en español", () => {
    assert.equal(
      implantLabOrderSubtypeLabel("pilar_personalizado"),
      "Pilar personalizado",
    );
    assert.equal(labOrderStatusLabel("draft"), "Borrador");
    assert.equal(labOrderStatusLabel("received"), "Recibida");
  });
});
