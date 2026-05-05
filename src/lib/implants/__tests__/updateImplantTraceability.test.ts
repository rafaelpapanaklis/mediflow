// Implants — tests del schema zod de updateImplantTraceability.
// Spec §1.9, §10.2.
//
// La validación COFEPRIS depende de 2 capas: (1) zod ≥20 chars
// y (2) audit log con cofeprisTraceability:true. Este archivo
// cubre la capa zod — NO requiere DB. La capa audit se valida
// implícitamente cada vez que la action se ejecuta en un test E2E
// con DATABASE_URL configurado.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updateImplantTraceabilitySchema } from "@/lib/validation/implants";

const baseInput = {
  implantId: "imp_test_123",
  field: "lotNumber" as const,
  newValue: "NEW-LOT-456",
};

describe("updateImplantTraceabilitySchema (capa zod COFEPRIS)", () => {
  it("rechaza justification vacía", () => {
    const r = updateImplantTraceabilitySchema.safeParse({
      ...baseInput,
      justification: "",
    });
    assert.equal(r.success, false);
  });

  it("rechaza justification de 5 chars", () => {
    const r = updateImplantTraceabilitySchema.safeParse({
      ...baseInput,
      justification: "lote ",
    });
    assert.equal(r.success, false);
    if (!r.success) {
      const msg = r.error.errors.map((e) => e.message).join(" ");
      assert.match(msg, /≥20|caracteres/);
    }
  });

  it("rechaza justification de 19 chars (límite inferior)", () => {
    const j = "a".repeat(19);
    const r = updateImplantTraceabilitySchema.safeParse({
      ...baseInput,
      justification: j,
    });
    assert.equal(r.success, false);
  });

  it("acepta justification de 20 chars exactos", () => {
    const j = "a".repeat(20);
    const r = updateImplantTraceabilitySchema.safeParse({
      ...baseInput,
      justification: j,
    });
    assert.equal(r.success, true);
  });

  it("acepta justification razonable (corrección de lote real)", () => {
    const r = updateImplantTraceabilitySchema.safeParse({
      ...baseInput,
      justification:
        "Lote correcto del paquete original — verificación con factura del proveedor.",
    });
    assert.equal(r.success, true);
  });

  it("rechaza si falta justification", () => {
    const r = updateImplantTraceabilitySchema.safeParse(baseInput);
    assert.equal(r.success, false);
  });

  it("acepta field=brand con justification válida", () => {
    const r = updateImplantTraceabilitySchema.safeParse({
      implantId: "imp_test_123",
      field: "brand",
      newValue: "NEODENT",
      justification: "Marca correcta — el paquete original era Neodent.",
    });
    assert.equal(r.success, true);
  });

  it("acepta field=placedAt con justification válida y Date", () => {
    const r = updateImplantTraceabilitySchema.safeParse({
      implantId: "imp_test_123",
      field: "placedAt",
      newValue: new Date("2024-10-15T09:00:00Z"),
      justification: "Fecha real corregida — el archivo de cita confirma el día.",
    });
    assert.equal(r.success, true);
  });

  it("rechaza field inválido (solo brand/lotNumber/placedAt permitidos)", () => {
    const r = updateImplantTraceabilitySchema.safeParse({
      implantId: "imp_test_123",
      field: "modelName",
      newValue: "BLX",
      justification: "intento de modificar modelo — debe rechazarse",
    });
    assert.equal(r.success, false);
  });

  it("rechaza implantId vacío", () => {
    const r = updateImplantTraceabilitySchema.safeParse({
      ...baseInput,
      implantId: "",
      justification: "intento de modificar sin implantId — debe rechazarse",
    });
    assert.equal(r.success, false);
  });
});
