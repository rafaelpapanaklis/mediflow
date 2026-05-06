// Periodontics — tests share-token. SPEC §11, COMMIT 8.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateShareToken,
  isValidShareTokenShape,
  defaultShareExpiry,
} from "../share-token";

describe("generateShareToken", () => {
  it("genera tokens de 32 caracteres", () => {
    for (let i = 0; i < 20; i++) {
      const t = generateShareToken();
      assert.equal(t.length, 32, `token con length distinto: ${t}`);
    }
  });

  it("tokens son URL-safe (chars A-Za-z0-9_-)", () => {
    for (let i = 0; i < 20; i++) {
      const t = generateShareToken();
      assert.match(t, /^[A-Za-z0-9_-]+$/);
    }
  });

  it("tokens son únicos en muestra grande", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateShareToken());
    }
    assert.equal(seen.size, 1000);
  });
});

describe("isValidShareTokenShape", () => {
  it("acepta tokens generados", () => {
    for (let i = 0; i < 20; i++) {
      assert.equal(isValidShareTokenShape(generateShareToken()), true);
    }
  });

  it("rechaza length distinto a 32", () => {
    assert.equal(isValidShareTokenShape("abc"), false);
    assert.equal(isValidShareTokenShape("a".repeat(31)), false);
    assert.equal(isValidShareTokenShape("a".repeat(33)), false);
  });

  it("rechaza chars no URL-safe", () => {
    assert.equal(isValidShareTokenShape("a".repeat(31) + "!"), false);
    assert.equal(isValidShareTokenShape("a".repeat(31) + "/"), false);
    assert.equal(isValidShareTokenShape("a".repeat(31) + "+"), false);
  });
});

describe("defaultShareExpiry", () => {
  it("default es 30 días desde now", () => {
    const now = new Date("2026-05-05T12:00:00Z");
    const exp = defaultShareExpiry(now);
    const diffDays = Math.round((exp.getTime() - now.getTime()) / 86400000);
    assert.equal(diffDays, 30);
  });
});
