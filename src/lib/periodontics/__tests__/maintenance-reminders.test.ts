// Periodontics — tests de auto-reminder de mantenimiento. SPEC §13.1, COMMIT 11.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAINTENANCE_REMINDER_TYPES,
  dueDateForMaintenance,
  maintenanceReminderTypeForMonths,
  recallMonthsForRisk,
} from "../maintenance-reminders";

describe("maintenanceReminderTypeForMonths", () => {
  it("3m → perio_maintenance_3m", () => {
    assert.equal(maintenanceReminderTypeForMonths(3), "perio_maintenance_3m");
  });

  it("4m → perio_maintenance_4m", () => {
    assert.equal(maintenanceReminderTypeForMonths(4), "perio_maintenance_4m");
  });

  it("6m → perio_maintenance_6m", () => {
    assert.equal(maintenanceReminderTypeForMonths(6), "perio_maintenance_6m");
  });

  it("redondea hacia arriba cuando no es exacto (5m → 6m)", () => {
    assert.equal(maintenanceReminderTypeForMonths(5), "perio_maintenance_6m");
  });

  it("clamp a 3m si meses ≤ 3", () => {
    assert.equal(maintenanceReminderTypeForMonths(1), "perio_maintenance_3m");
    assert.equal(maintenanceReminderTypeForMonths(2), "perio_maintenance_3m");
  });
});

describe("recallMonthsForRisk", () => {
  it("ALTO → 3m", () => {
    assert.equal(recallMonthsForRisk("ALTO"), 3);
  });

  it("MODERADO → 4m", () => {
    assert.equal(recallMonthsForRisk("MODERADO"), 4);
  });

  it("BAJO → 6m", () => {
    assert.equal(recallMonthsForRisk("BAJO"), 6);
  });

  it("null/undefined → 3m (conservador)", () => {
    assert.equal(recallMonthsForRisk(null), 3);
    assert.equal(recallMonthsForRisk(undefined), 3);
  });
});

describe("dueDateForMaintenance", () => {
  it("añade exactamente N meses", () => {
    const base = new Date("2026-01-15T10:00:00Z");
    const due3 = dueDateForMaintenance(3, base);
    assert.equal(due3.getUTCMonth(), 3); // abril (0-indexed)
    assert.equal(due3.getUTCFullYear(), 2026);

    const due6 = dueDateForMaintenance(6, base);
    assert.equal(due6.getUTCMonth(), 6); // julio
  });

  it("cruza año correctamente (oct + 6m → abril sig año)", () => {
    const base = new Date("2026-10-15T10:00:00Z");
    const due = dueDateForMaintenance(6, base);
    assert.equal(due.getUTCFullYear(), 2027);
    assert.equal(due.getUTCMonth(), 3); // abril
  });
});

describe("MAINTENANCE_REMINDER_TYPES", () => {
  it("contiene los 3 tipos perio (3m/4m/6m)", () => {
    assert.deepEqual([...MAINTENANCE_REMINDER_TYPES].sort(), [
      "perio_maintenance_3m",
      "perio_maintenance_4m",
      "perio_maintenance_6m",
    ]);
  });
});
