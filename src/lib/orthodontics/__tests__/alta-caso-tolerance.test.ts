// Ortodoncia — Ola 1 (ws1-t6), «Alta del caso»: si alguien cambia el
// criterio de "columna todavía no existe" (P2021/P2022), las actions de alta
// dejarían de reintentar sin los campos nuevos y romperían la creación del
// caso mientras sql/ortodoncia-alta-caso.sql no esté pegado en Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMissingColumnError } from "../alta-caso-tolerance";

test("P2022 (columna inexistente) se considera tolerable", () => {
  assert.equal(isMissingColumnError({ code: "P2022" }), true);
});

test("P2021 (tabla inexistente) se considera tolerable", () => {
  assert.equal(isMissingColumnError({ code: "P2021" }), true);
});

test("otro código de Prisma NO se tolera (no hay que tragarse errores reales)", () => {
  assert.equal(isMissingColumnError({ code: "P2002" }), false);
});

test("errores sin código (Error genérico) no se tratan como columna faltante", () => {
  assert.equal(isMissingColumnError(new Error("boom")), false);
});

test("valores no-objeto no rompen el check", () => {
  assert.equal(isMissingColumnError(null), false);
  assert.equal(isMissingColumnError(undefined), false);
  assert.equal(isMissingColumnError("P2022"), false);
});
