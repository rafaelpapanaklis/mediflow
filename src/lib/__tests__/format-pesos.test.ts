import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtMXN, fmtMXNdec } from "../format";

test("montos negativos: el signo va antes del $", () => {
  assert.equal(fmtMXNdec(-50), "-$50.00");
  assert.equal(fmtMXN(-12400), "-$12,400");
});

test("montos positivos y cero no cambian", () => {
  assert.equal(fmtMXNdec(34450), "$34,450.00");
  assert.equal(fmtMXN(0), "$0");
  assert.equal(fmtMXN(undefined as unknown as number), "$0");
});

test("un negativo que redondea a cero no lleva signo", () => {
  assert.equal(fmtMXN(-0.4), "$0");
  assert.equal(fmtMXNdec(-0.001), "$0.00");
});
