// Periodontics — tests para lab-order-types. SPEC §8, COMMIT 5.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERIO_LAB_ORDER_KIND,
  PERIO_LAB_ORDER_TYPE_TO_SCHEMA,
  PERIO_LAB_ORDER_LABEL,
  SplintSpecSchema,
  CustomGraftSpecSchema,
  MaintenanceTraySpecSchema,
  getPerioLabSpecSchema,
  summarizePerioLabSpec,
} from "../lab-order-types";

describe("PERIO_LAB_ORDER_KIND", () => {
  it("expone exactamente 3 tipos", () => {
    assert.equal(PERIO_LAB_ORDER_KIND.length, 3);
  });

  it("mapea cada slug a un valor schema con prefijo perio_", () => {
    for (const k of PERIO_LAB_ORDER_KIND) {
      const v = PERIO_LAB_ORDER_TYPE_TO_SCHEMA[k];
      assert.match(v, /^perio_/);
      assert.ok(PERIO_LAB_ORDER_LABEL[k]);
    }
  });

  it("mapeos exactos a los enum values añadidos por la migración", () => {
    assert.equal(PERIO_LAB_ORDER_TYPE_TO_SCHEMA.ferulizacion, "perio_splint");
    assert.equal(
      PERIO_LAB_ORDER_TYPE_TO_SCHEMA.injerto_personalizado,
      "perio_custom_graft",
    );
    assert.equal(
      PERIO_LAB_ORDER_TYPE_TO_SCHEMA.planchas_mantenimiento,
      "perio_maintenance_tray",
    );
  });
});

describe("SplintSpecSchema", () => {
  it("acepta una férula de 4 dientes anteriores", () => {
    const out = SplintSpecSchema.safeParse({
      technique: "fibra_vidrio_composite",
      teethFdi: [13, 12, 11, 21],
      surfaces: "lingual",
    });
    assert.equal(out.success, true);
  });

  it("rechaza ferulización de 1 solo diente", () => {
    const out = SplintSpecSchema.safeParse({
      technique: "alambre_composite",
      teethFdi: [11],
    });
    assert.equal(out.success, false);
  });

  it("rechaza FDI fuera de rango (eg. terceros molares en cuadrante 5)", () => {
    const out = SplintSpecSchema.safeParse({
      technique: "alambre_composite",
      teethFdi: [11, 51],
    });
    assert.equal(out.success, false);
  });
});

describe("CustomGraftSpecSchema", () => {
  it("acepta xenograft con membrana", () => {
    const out = CustomGraftSpecSchema.safeParse({
      graftType: "xenograft",
      defectMorphology: "3_paredes",
      receiverSiteFdi: 26,
      approxVolumeMm3: 150,
      membraneRequired: true,
      membraneType: "colageno_reabsorbible",
    });
    assert.equal(out.success, true);
  });

  it("rechaza tipo de injerto inválido", () => {
    const out = CustomGraftSpecSchema.safeParse({
      graftType: "autogenous",
      defectMorphology: "1_pared",
      receiverSiteFdi: 36,
    });
    assert.equal(out.success, false);
  });
});

describe("MaintenanceTraySpecSchema", () => {
  it("acepta plancha bilateral con reservorio de fluoruro", () => {
    const out = MaintenanceTraySpecSchema.safeParse({
      arch: "ambas",
      impressionType: "digital_scan",
      thicknessMm: 1.5,
      reservoir: "fluoruro",
    });
    assert.equal(out.success, true);
  });

  it("aplica default de 1.5mm de espesor", () => {
    const out = MaintenanceTraySpecSchema.safeParse({
      arch: "superior",
      impressionType: "silicona",
      reservoir: "clorhexidina",
    });
    assert.equal(out.success, true);
    if (out.success) assert.equal(out.data.thicknessMm, 1.5);
  });

  it("rechaza espesor fuera de rango (0.3mm)", () => {
    const out = MaintenanceTraySpecSchema.safeParse({
      arch: "inferior",
      impressionType: "alginato",
      thicknessMm: 0.3,
      reservoir: "sin_reservorio",
    });
    assert.equal(out.success, false);
  });
});

describe("getPerioLabSpecSchema", () => {
  it("devuelve el schema correcto para cada kind", () => {
    assert.equal(getPerioLabSpecSchema("ferulizacion"), SplintSpecSchema);
    assert.equal(
      getPerioLabSpecSchema("injerto_personalizado"),
      CustomGraftSpecSchema,
    );
    assert.equal(
      getPerioLabSpecSchema("planchas_mantenimiento"),
      MaintenanceTraySpecSchema,
    );
  });
});

describe("summarizePerioLabSpec", () => {
  it("ferulización", () => {
    const s = summarizePerioLabSpec("ferulizacion", {
      technique: "fibra_vidrio_composite",
      teethFdi: [13, 12, 11, 21],
      surfaces: "lingual",
    });
    assert.match(s, /fibra vidrio composite/);
    assert.match(s, /4 dientes/);
  });

  it("injerto personalizado", () => {
    const s = summarizePerioLabSpec("injerto_personalizado", {
      graftType: "allograft",
      defectMorphology: "2_paredes",
      receiverSiteFdi: 26,
    });
    assert.match(s, /allograft/);
    assert.match(s, /D26/);
  });

  it("planchas de mantenimiento", () => {
    const s = summarizePerioLabSpec("planchas_mantenimiento", {
      arch: "ambas",
      impressionType: "digital_scan",
      thicknessMm: 2,
      reservoir: "clorhexidina",
    });
    assert.match(s, /ambas/);
    assert.match(s, /2mm/);
    assert.match(s, /clorhexidina/);
  });

  it("devuelve mensaje de error para spec inválido", () => {
    const s = summarizePerioLabSpec("ferulizacion", { technique: "no-existe" });
    assert.equal(s, "Spec inválido");
  });
});
