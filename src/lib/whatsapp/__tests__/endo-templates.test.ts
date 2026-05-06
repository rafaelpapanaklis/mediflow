// Tests para las 4 plantillas WhatsApp endo.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ENDO_WA_TEMPLATES,
  ENDO_WA_TEMPLATE_LIST,
  buildEndoWhatsAppMessage,
} from "../endo-templates";

describe("ENDO_WA_TEMPLATES", () => {
  it("expone las 4 plantillas core (precita, post_tc_inmediato, recordatorio_restauracion, control_seguimiento)", () => {
    const keys = Object.keys(ENDO_WA_TEMPLATES).sort();
    assert.deepEqual(keys, [
      "endo_control_seguimiento",
      "endo_post_tc_inmediato",
      "endo_precita_tc",
      "endo_recordatorio_restauracion",
    ]);
  });

  it("cada plantilla tiene prefix=ENDO_, label y description", () => {
    for (const def of ENDO_WA_TEMPLATE_LIST) {
      assert.equal(def.prefix, "ENDO_");
      assert.ok(def.label.length > 0);
      assert.ok(def.description.length > 0);
    }
  });

  it("endo_precita_tc menciona fecha + recomendaciones (Roberto Salinas TC 36)", () => {
    const out = buildEndoWhatsAppMessage("endo_precita_tc", {
      patientName: "Roberto Salinas",
      dateTime: "lunes 10:00",
      doctorName: "Ana Rivas",
    });
    assert.match(out, /Roberto Salinas/);
    assert.match(out, /lunes 10:00/);
    assert.match(out, /Recomendaciones/);
  });

  it("endo_post_tc_inmediato menciona pieza y sensibilidad 24-72 h (Mariana Torres retx 21)", () => {
    const out = buildEndoWhatsAppMessage("endo_post_tc_inmediato", {
      patientName: "Mariana Torres",
      toothFdi: 21,
    });
    assert.match(out, /Mariana Torres/);
    assert.match(out, /pieza 21/);
    assert.match(out, /24 y 72 horas/);
  });

  it("endo_recordatorio_restauracion alerta sobre fracturas", () => {
    const out = buildEndoWhatsAppMessage("endo_recordatorio_restauracion", {
      patientName: "Mariana Torres",
      toothFdi: 21,
    });
    assert.match(out, /restauración definitiva/);
    assert.match(out, /fractura/);
  });

  it("endo_control_seguimiento menciona control radiográfico (Carlos Mendoza control 12m)", () => {
    const out = buildEndoWhatsAppMessage("endo_control_seguimiento", {
      patientName: "Carlos Mendoza",
      toothFdi: 47,
    });
    assert.match(out, /Carlos Mendoza/);
    assert.match(out, /pieza 47/);
    assert.match(out, /control radiográfico/);
  });

  it("usa placeholders cuando faltan datos", () => {
    const out = buildEndoWhatsAppMessage("endo_post_tc_inmediato", {});
    assert.match(out, /\[paciente\]/);
    assert.match(out, /\[diente\]/);
  });

  it("buildEndoWhatsAppMessage lanza si la key no existe", () => {
    assert.throws(
      () => buildEndoWhatsAppMessage("xx" as never, {}),
      /desconocida/,
    );
  });
});

describe("ENDO_WA_TEMPLATE_LIST", () => {
  it("contiene exactamente 4 plantillas", () => {
    assert.equal(ENDO_WA_TEMPLATE_LIST.length, 4);
  });
});
