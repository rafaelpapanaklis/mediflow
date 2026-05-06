// Clinical-shared — tests del PDF document builder.
// El summary builder hace queries a Prisma; aquí solo testeamos los
// helpers puros (humanizeGender se exporta indirectamente vía la firma
// del summary). Por ahora validamos que el schema del input sea estable.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReferralLetterDocumentProps } from "../../../pdf/referral-letter-document";

describe("ReferralLetterDocument props shape", () => {
  it("acepta una props mínima válida", () => {
    const p: ReferralLetterDocumentProps = {
      clinicName: "Clínica Demo",
      doctorAuthorName: "Dra. María López",
      doctorAuthorCedula: null,
      module: "pediatrics",
      generatedAt: "2026-05-05T10:00:00Z",
      patientName: "Sofía Méndez",
      patientDob: "2018-02-15T00:00:00Z",
      patientGender: "FEMALE",
      contactName: null,
      contactSpecialty: null,
      contactClinicName: null,
      contactPhone: null,
      contactEmail: null,
      reason: "Interconsulta con ortopedia maxilar",
      summary: "Paciente pediátrica de 8 años con mordida cruzada bilateral.",
    };
    assert.equal(p.module, "pediatrics");
    assert.equal(p.patientName, "Sofía Méndez");
  });
});
