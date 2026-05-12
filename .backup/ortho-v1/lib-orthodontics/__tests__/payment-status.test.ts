// Orthodontics — tests payment-status. SPEC §13.1 + §13.5.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePaymentStatus, daysBetween } from "../payment-status";

const NOW = new Date("2026-05-05T12:00:00Z");

function inst(overrides: {
  amount?: number;
  dueDate?: string;
  status?: "PENDING" | "PAID" | "OVERDUE" | "WAIVED";
  paidAt?: string | null;
}) {
  return {
    amount: overrides.amount ?? 2400,
    dueDate: new Date(overrides.dueDate ?? "2026-05-15"),
    status: (overrides.status ?? "PENDING") as
      | "PENDING"
      | "PAID"
      | "OVERDUE"
      | "WAIVED",
    paidAt:
      overrides.paidAt === undefined
        ? null
        : overrides.paidAt === null
          ? null
          : new Date(overrides.paidAt),
  };
}

describe("computePaymentStatus", () => {
  it("ON_TIME cuando ningún installment está vencido", () => {
    const result = computePaymentStatus(
      [
        inst({ status: "PAID", paidAt: "2026-04-15", dueDate: "2026-04-15" }),
        inst({ status: "PENDING", dueDate: "2026-06-15" }),
      ],
      NOW,
    );
    assert.equal(result.status, "ON_TIME");
    assert.equal(result.daysOverdue, 0);
    assert.equal(result.amountOverdue, 0);
  });

  it("LIGHT_DELAY con vencido <30 días", () => {
    const result = computePaymentStatus(
      [
        inst({ status: "PAID", paidAt: "2026-03-15", dueDate: "2026-03-15" }),
        inst({ status: "PENDING", dueDate: "2026-04-15" }), // 20 días vencido
      ],
      NOW,
    );
    assert.equal(result.status, "LIGHT_DELAY");
    assert.equal(result.daysOverdue, 20);
    assert.equal(result.amountOverdue, 2400);
  });

  it("regla límite: día 30 = LIGHT_DELAY", () => {
    const result = computePaymentStatus(
      [inst({ status: "PENDING", dueDate: "2026-04-05" })],
      NOW,
    );
    assert.equal(result.status, "LIGHT_DELAY");
    assert.equal(result.daysOverdue, 30);
  });

  it("regla límite: día 31 = SEVERE_DELAY", () => {
    const result = computePaymentStatus(
      [inst({ status: "PENDING", dueDate: "2026-04-04" })],
      NOW,
    );
    assert.equal(result.status, "SEVERE_DELAY");
    assert.equal(result.daysOverdue, 31);
  });

  it("regla 'max severity': SEVERE gana sobre LIGHT cuando hay ambos", () => {
    const result = computePaymentStatus(
      [
        inst({ status: "PENDING", dueDate: "2026-04-15", amount: 2400 }), // 20 días
        inst({ status: "PENDING", dueDate: "2026-02-15", amount: 2400 }), // 79 días
      ],
      NOW,
    );
    assert.equal(result.status, "SEVERE_DELAY");
    assert.equal(result.amountOverdue, 4800);
  });

  it("PAID_IN_FULL cuando todas son PAID o WAIVED", () => {
    const result = computePaymentStatus(
      [
        inst({ status: "PAID", paidAt: "2026-04-15", dueDate: "2026-04-15" }),
        inst({ status: "WAIVED", dueDate: "2026-05-15" }),
      ],
      NOW,
    );
    assert.equal(result.status, "PAID_IN_FULL");
  });

  it("WAIVED no cuenta como vencida aunque dueDate haya pasado", () => {
    const result = computePaymentStatus(
      [
        inst({ status: "PAID", paidAt: "2026-04-15", dueDate: "2026-04-15" }),
        inst({ status: "WAIVED", dueDate: "2026-02-01" }),
      ],
      NOW,
    );
    assert.equal(result.status, "PAID_IN_FULL");
  });

  it("daysBetween calcula diferencia entera", () => {
    const a = new Date("2026-05-01T00:00:00Z");
    const b = new Date("2026-05-05T12:00:00Z");
    assert.equal(daysBetween(a, b), 4);
  });
});
