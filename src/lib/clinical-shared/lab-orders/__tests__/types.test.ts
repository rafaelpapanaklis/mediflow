// Clinical-shared — tests de labels y enum coverage para lab orders.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LAB_ORDER_STATUS_LABELS, LAB_ORDER_TYPE_LABELS } from "../types";

describe("LAB_ORDER_TYPE_LABELS", () => {
  it("incluye los tipos por módulo declarados en el enum Prisma", () => {
    const expected = [
      "post_core",
      "surgical_guide",
      "custom_abutment",
      "crown",
      "ortho_appliance",
      "retainer",
      "ped_space_maintainer_lab",
      "other",
    ];
    for (const key of expected) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(LAB_ORDER_TYPE_LABELS, key),
        `Falta label para ${key}`,
      );
    }
  });
});

describe("LAB_ORDER_STATUS_LABELS", () => {
  it("traduce los 5 estados a español", () => {
    assert.equal(LAB_ORDER_STATUS_LABELS.draft, "Borrador");
    assert.equal(LAB_ORDER_STATUS_LABELS.sent, "Enviada");
    assert.equal(LAB_ORDER_STATUS_LABELS.in_progress, "En proceso");
    assert.equal(LAB_ORDER_STATUS_LABELS.received, "Recibida");
    assert.equal(LAB_ORDER_STATUS_LABELS.cancelled, "Cancelada");
  });
});
