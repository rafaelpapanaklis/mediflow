// Orthodontics — tests del shape de ComparisonPdf.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ComparisonPdfData } from "../pdf-templates/comparison-pdf";
import type { DatosDelMembreteOrto } from "../pdf/membrete-orto";

// ws1-t4: todos los PDF de ortodoncia llevan el membrete común.
const membrete: DatosDelMembreteOrto = {
  clinicName: "Test",
  zonaHoraria: "America/Mexico_City",
  emitidoEl: new Date().toISOString(),
  lugar: null,
  paciente: { nombre: "Juan Pérez", fechaNacimiento: null, folio: null },
  doctor: null,
};

describe("ComparisonPdf shape", () => {
  it("ComparisonPdfData expone los campos requeridos del libro de progreso", () => {
    const data: ComparisonPdfData = {
      membrete,
      patientName: "Juan Pérez",
      patientDobIso: null,
      doctorName: "Dr. Test",
      doctorCedula: "12345",
      clinicName: "Test",
      techniqueLabel: "braces",
      durationMonthsActual: 12,
      estimatedDurationMonths: 18,
      diagnosisSummary: "Test summary",
      retentionPlanText: "Retención fija + removible",
      initialSet: null,
      midSets: [],
      finalSet: null,
      generatedAtIso: new Date().toISOString(),
      hasPhotoUseConsent: false,
    };
    assert.equal(data.midSets.length, 0);
    assert.equal(data.initialSet, null);
    assert.equal(data.hasPhotoUseConsent, false);
  });

  it("midSets es array — soporta 0..N controles intermedios", () => {
    const data: ComparisonPdfData = {
      membrete,
      patientName: "x",
      patientDobIso: null,
      doctorName: "x",
      doctorCedula: null,
      clinicName: "x",
      techniqueLabel: "x",
      durationMonthsActual: 0,
      estimatedDurationMonths: 0,
      diagnosisSummary: "x",
      retentionPlanText: "x",
      initialSet: null,
      midSets: [
        {
          label: "Mes 3",
          capturedAtIso: new Date().toISOString(),
          monthInTreatment: 3,
          pairs: [],
        },
      ],
      finalSet: null,
      generatedAtIso: new Date().toISOString(),
      hasPhotoUseConsent: true,
    };
    assert.equal(data.midSets.length, 1);
    assert.equal(data.midSets[0].monthInTreatment, 3);
  });
});
