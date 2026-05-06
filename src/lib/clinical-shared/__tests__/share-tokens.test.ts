import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateShareToken,
  computeExpiresAt,
  isShareTokenLive,
  buildShareUrl,
  DEFAULT_SHARE_EXPIRES_DAYS,
} from "../share-tokens";

describe("clinical-shared/share-tokens", () => {
  it("generateShareToken devuelve URL-safe", () => {
    const t = generateShareToken();
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.ok(t.length >= 32);
  });

  it("genera tokens distintos", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    assert.notEqual(a, b);
  });

  it("computeExpiresAt suma días", () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    const exp = computeExpiresAt(now, 60);
    const diffDays = Math.round(
      (exp.getTime() - now.getTime()) / (24 * 3600 * 1000),
    );
    assert.equal(diffDays, 60);
  });

  it("DEFAULT_SHARE_EXPIRES_DAYS = 60", () => {
    assert.equal(DEFAULT_SHARE_EXPIRES_DAYS, 60);
  });

  it("isShareTokenLive: revocado", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000);
    assert.equal(
      isShareTokenLive(
        { revokedAt: past, expiresAt: new Date(now.getTime() + 1e6) },
        now,
      ),
      false,
    );
  });

  it("isShareTokenLive: expirado", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1);
    assert.equal(
      isShareTokenLive({ revokedAt: null, expiresAt: past }, now),
      false,
    );
  });

  it("isShareTokenLive: vivo", () => {
    const now = new Date();
    const future = new Date(now.getTime() + 24 * 3600 * 1000);
    assert.equal(
      isShareTokenLive({ revokedAt: null, expiresAt: future }, now),
      true,
    );
  });

  it("buildShareUrl normaliza trailing slash", () => {
    assert.equal(
      buildShareUrl("https://app.test/", "abc"),
      "https://app.test/share/p/abc",
    );
    assert.equal(
      buildShareUrl("https://app.test", "abc"),
      "https://app.test/share/p/abc",
    );
  });
});
