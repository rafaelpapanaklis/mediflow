// WhatsApp — tests de las plantillas tutor pediátricas (4 keys requeridas
// por la spec del Sprint Cierre).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PED_TUTOR_TEMPLATES,
  PED_TUTOR_TEMPLATE_LIST,
  buildTutorMessage,
} from "../templates";

const ctx = {
  childName: "Sofía",
  guardianName: "Sra. Méndez",
  clinicName: "Clínica Demo",
  doctorName: "Dra. López",
};

describe("PED_TUTOR_TEMPLATES", () => {
  it("incluye exactamente las 4 keys del spec", () => {
    const keys = Object.keys(PED_TUTOR_TEMPLATES).sort();
    assert.deepEqual(keys, [
      "ped_aniversario_primera_visita",
      "ped_post_cita_buen_comportamiento",
      "ped_post_cita_recomendaciones",
      "ped_pre_cita",
    ]);
  });

  it("todas las plantillas comparten prefijo PED_TUTOR_", () => {
    for (const t of PED_TUTOR_TEMPLATE_LIST) {
      assert.equal(t.prefix, "PED_TUTOR_");
    }
  });

  it("ped_pre_cita menciona al niño, al tutor y la clínica", () => {
    const out = buildTutorMessage("ped_pre_cita", {
      ...ctx,
      appointmentDate: "lunes 6 de mayo",
      appointmentTime: "10:00",
    });
    assert.match(out, /Sofía/);
    assert.match(out, /Sra\. Méndez/);
    assert.match(out, /lunes 6 de mayo/);
    assert.match(out, /10:00/);
  });

  it("ped_post_cita_recomendaciones renderiza bullets", () => {
    const out = buildTutorMessage("ped_post_cita_recomendaciones", {
      ...ctx,
      recommendations: ["Cepillado 2x", "Evitar dulces 24h"],
    });
    assert.match(out, /• Cepillado 2x/);
    assert.match(out, /• Evitar dulces 24h/);
  });

  it("ped_post_cita_buen_comportamiento es refuerzo positivo", () => {
    const out = buildTutorMessage("ped_post_cita_buen_comportamiento", ctx);
    assert.match(out, /felicitar a Sofía/i);
    assert.match(out, /comportamiento/i);
  });

  it("ped_aniversario_primera_visita usa años en plural cuando aplica", () => {
    const out1 = buildTutorMessage("ped_aniversario_primera_visita", {
      ...ctx,
      yearsSinceFirstVisit: 1,
    });
    assert.match(out1, /el primer año/);
    const out3 = buildTutorMessage("ped_aniversario_primera_visita", {
      ...ctx,
      yearsSinceFirstVisit: 3,
    });
    assert.match(out3, /3 años/);
  });
});
