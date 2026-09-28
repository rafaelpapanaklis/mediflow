/**
 * B7 (QA ws1-t10) — el asistente de "Importar mi clínica" mostraba un 502 del
 * servidor como "No pudimos leer tu archivo. Revisa que sea un .xlsx o .csv
 * válido", cuando el archivo era válido y el problema era del servidor
 * (dev.108 estuvo inestable durante la QA). El wizard ahora distingue una
 * falla TRANSITORIA (5xx / timeout / red) de un archivo genuinamente inválido
 * (4xx) con `esErrorTransitorio` (src/lib/import/client.ts) y muestra un
 * mensaje distinto ("hubo un problema del servidor", con Reintentar) en vez
 * de culpar al archivo.
 *
 * Run: npx tsx --test src/lib/import/__tests__/errores-transitorios.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ImportHttpError, esErrorTransitorio } from "../client";

test("un 502/503 del backend es transitorio: no se le echa la culpa al archivo", () => {
  assert.equal(esErrorTransitorio(new ImportHttpError("No se pudo procesar el archivo (error 502)", 502)), true);
  assert.equal(esErrorTransitorio(new ImportHttpError("No se pudo procesar el archivo (error 503)", 503)), true);
});

test("un 400/413 del backend SÍ es del archivo: no se trata como transitorio", () => {
  assert.equal(esErrorTransitorio(new ImportHttpError("El archivo no es un .xlsx/.csv válido", 400)), false);
  assert.equal(esErrorTransitorio(new ImportHttpError("El archivo pesa más de lo permitido", 413)), false);
});

test("un error genérico (no tipado) no se asume transitorio", () => {
  assert.equal(esErrorTransitorio(new Error("algo raro")), false);
  assert.equal(esErrorTransitorio("no ni siquiera un Error"), false);
});
