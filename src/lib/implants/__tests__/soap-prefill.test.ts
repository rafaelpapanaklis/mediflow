// Implants — tests del SOAP pre-fill. Spec §8.2.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildImplantSoapPrefill } from "../soap-prefill";

describe("buildImplantSoapPrefill", () => {
  it("devuelve string vacío si no hay implantes activos", () => {
    const r = buildImplantSoapPrefill({ implants: [] });
    assert.equal(r, "");
  });

  it("ignora implantes REMOVED", () => {
    const r = buildImplantSoapPrefill({
      implants: [
        {
          toothFdi: 26,
          brand: "BIOHORIZONS",
          modelName: "Tapered Internal",
          currentStatus: "REMOVED",
          isqLatest: null,
          pdMaxLastFollowUp: null,
          boneLossAccumulatedMm: null,
          meetsAlbrektsson: null,
        },
      ],
    });
    assert.equal(r, "");
  });

  it("genera pre-fill para Roberto FUNCTIONAL con ISQ + Albrektsson ok", () => {
    const r = buildImplantSoapPrefill({
      implants: [
        {
          toothFdi: 36,
          brand: "STRAUMANN",
          modelName: "BLX",
          currentStatus: "FUNCTIONAL",
          isqLatest: 78,
          pdMaxLastFollowUp: 3,
          boneLossAccumulatedMm: 0.5,
          meetsAlbrektsson: true,
        },
      ],
    });
    assert.match(r, /\[Implantología\]/);
    assert.match(r, /Implantes activos: 1/);
    assert.match(r, /Implante 36: Straumann BLX, en función/);
    assert.match(r, /ISQ último 78/);
    assert.match(r, /PD máx 3 mm/);
    assert.match(r, /Albrektsson: ok/);
  });

  it("marca Albrektsson excedido cuando no cumple", () => {
    const r = buildImplantSoapPrefill({
      implants: [
        {
          toothFdi: 26,
          brand: "BIOHORIZONS",
          modelName: "Tapered Internal",
          currentStatus: "COMPLICATION",
          isqLatest: null,
          pdMaxLastFollowUp: 7,
          boneLossAccumulatedMm: 3.0,
          meetsAlbrektsson: false,
        },
      ],
    });
    assert.match(r, /con complicación activa/);
    assert.match(r, /PD máx 7 mm/);
    assert.match(r, /Pérdida ósea acumulada 3 mm \(Albrektsson: excedido\)/);
  });

  it("inyecta queja del paciente cuando viene", () => {
    const r = buildImplantSoapPrefill({
      patientComplaint: "mal sabor en zona del implante 26",
      implants: [
        {
          toothFdi: 26,
          brand: "BIOHORIZONS",
          modelName: "Tapered Internal",
          currentStatus: "COMPLICATION",
          isqLatest: null,
          pdMaxLastFollowUp: null,
          boneLossAccumulatedMm: null,
          meetsAlbrektsson: null,
        },
      ],
    });
    assert.match(r, /Paciente refiere: mal sabor en zona del implante 26/);
  });

  it("All-on-4 con 4 implantes activos lista los 4", () => {
    const r = buildImplantSoapPrefill({
      implants: [12, 14, 22, 24].map((fdi) => ({
        toothFdi: fdi,
        brand: "NEODENT",
        modelName: "Drive CM",
        currentStatus: "LOADED_DEFINITIVE" as const,
        isqLatest: null,
        pdMaxLastFollowUp: null,
        boneLossAccumulatedMm: null,
        meetsAlbrektsson: null,
      })),
    });
    assert.match(r, /Implantes activos: 4/);
    assert.match(r, /Implante 12:/);
    assert.match(r, /Implante 22:/);
  });
});
