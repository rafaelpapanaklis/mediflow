/**
 * Tests unitarios de la lógica pura de active-clinic.
 *
 * Mantenemos esto en `active-clinic-core.ts` (sin imports de
 * `next/headers`) para que el runner de Node pueda ejecutarlo sin un
 * runtime de Next. Los tests cubren los 3 escenarios de bug Vercel
 * 2026-05-05T18:12:
 *   1. Cookie del propio user → conservar (preserva elección entre
 *      sesiones).
 *   2. Cookie de impersonate / cuenta cruzada → resetear a la primera
 *      por createdAt.
 *   3. Sin cookie / HMAC inválido → resetear a la primera.
 *
 * Correr con:
 *   npm run test:active-clinic
 *   # o:
 *   npx tsx --test src/lib/active-clinic-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { packClinicCookie, unpackClinicCookie, pickActiveClinicId } from "./active-clinic-core";

const SECRET_A = "test-secret-A-32bytes-fixture-ok";
const SECRET_B = "test-secret-B-32bytes-fixture-different";

test("pack/unpack roundtrip preserva el clinicId", () => {
  const packed = packClinicCookie("clinic-abc-123", SECRET_A);
  assert.equal(unpackClinicCookie(packed, SECRET_A), "clinic-abc-123");
});

test("unpack rechaza HMAC manipulado", () => {
  const packed = packClinicCookie("clinic-abc-123", SECRET_A);
  // Manipular el último char del HMAC. Si era "0" lo cambiamos a "1" y viceversa.
  const lastChar = packed.slice(-1);
  const flipped = lastChar === "a" ? "b" : "a";
  const tampered = packed.slice(0, -1) + flipped;
  assert.equal(unpackClinicCookie(tampered, SECRET_A), null);
});

test("unpack rechaza cookie firmada con otro secret (rotación / impersonate stale)", () => {
  const packed = packClinicCookie("clinic-abc-123", SECRET_A);
  assert.equal(unpackClinicCookie(packed, SECRET_B), null);
});

test("pickActiveClinicId conserva la cookie cuando apunta a una clínica del usuario", () => {
  const result = pickActiveClinicId("clinic-3", ["clinic-1", "clinic-2", "clinic-3"]);
  assert.deepEqual(result, { clinicId: "clinic-3", reason: "kept" });
});

test("pickActiveClinicId resetea a la primera cuando la cookie es de una clínica ajena (impersonate / cross-account)", () => {
  const result = pickActiveClinicId("clinic-99", ["clinic-1", "clinic-2"]);
  assert.deepEqual(result, { clinicId: "clinic-1", reason: "reset" });
});

test("pickActiveClinicId resetea a la primera cuando no hay cookie (login fresco multi-clínica)", () => {
  const result = pickActiveClinicId(null, ["clinic-1", "clinic-2"]);
  assert.deepEqual(result, { clinicId: "clinic-1", reason: "reset" });
});
