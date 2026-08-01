import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  folioToInt,
  formatPatientNumber,
  maxFolioInt,
  nextPatientNumberFrom,
  nextPatientNumberFromFolios,
} from "../next-patient-number-core";

// Genera folios contiguos P0001..Pnnnn.
const seq = (n: number) =>
  Array.from({ length: n }, (_, i) => formatPatientNumber(i + 1));

test("clínica sin pacientes → primer folio P0001", () => {
  assert.equal(nextPatientNumberFromFolios([]), "P0001");
  assert.equal(nextPatientNumberFrom(null), "P0001");
});

test("folios contiguos → sigue el máximo", () => {
  assert.equal(nextPatientNumberFromFolios(seq(5)), "P0006");
  assert.equal(nextPatientNumberFromFolios(["P0001"]), "P0002");
});

test("con huecos → NO reasigna un folio ya emitido", () => {
  // El bug original: 3 filas → count+1 = P0004, que ya existe.
  assert.equal(nextPatientNumberFromFolios(["P0001", "P0003", "P0004"]), "P0005");
});

test("con bajas definitivas → el folio nunca retrocede", () => {
  // Se emitieron 10 y se borraron en duro 7: quedan 3 filas pero el máximo es 10.
  const vivos = ["P0002", "P0006", "P0010"];
  assert.equal(nextPatientNumberFromFolios(vivos), "P0011");
  // Y con COUNT habría dado P0004 → colisión con el P0004 ya emitido.
  assert.notEqual(nextPatientNumberFromFolios(vivos), "P0004");
});

test("caso real Menta Dental: 30 filas, último P0031 → P0032", () => {
  const folios = [...seq(30).slice(0, 29), "P0031"]; // 30 filas, máximo 31
  assert.equal(folios.length, 30);
  assert.equal(nextPatientNumberFromFolios(folios), "P0032");
});

test("caso real Rafael Clinica: 124 filas, último P0126 → P0127", () => {
  const folios = [...seq(123), "P0126"]; // 124 filas, máximo 126
  assert.equal(folios.length, 124);
  assert.equal(nextPatientNumberFromFolios(folios), "P0127");
});

test("folio > 9999 → crece a 5 dígitos, no se trunca", () => {
  assert.equal(nextPatientNumberFromFolios(["P9999"]), "P10000");
  assert.equal(formatPatientNumber(10000), "P10000");
  assert.equal(formatPatientNumber(123456), "P123456");
});

test("comparación NUMÉRICA, no de texto: P10000 > P9999", () => {
  // Como string, "P9999" > "P10000" y el folio retrocedería a P10000 otra vez.
  assert.equal(maxFolioInt(["P9999", "P10000"]), 10000);
  assert.equal(nextPatientNumberFromFolios(["P9999", "P10000"]), "P10001");
  assert.equal(nextPatientNumberFromFolios(["P10000", "P9999"]), "P10001");
});

test("filas con folio corrupto o no numérico se ignoran", () => {
  const folios = ["P0007", "ABC", "", "SIN-FOLIO", null, undefined, "   "];
  assert.equal(nextPatientNumberFromFolios(folios), "P0008");
  assert.equal(folioToInt("ABC"), null);
  assert.equal(folioToInt(""), null);
  assert.equal(folioToInt(null), null);
});

test("folio con dígitos absurdos se ignora (protege el CAST a BIGINT)", () => {
  assert.equal(folioToInt("P" + "9".repeat(40)), null);
  // Y no arrastra al resto: el máximo usable sigue siendo el válido.
  assert.equal(nextPatientNumberFromFolios(["P0003", "P" + "9".repeat(40)]), "P0004");
});

test("formatos mixtos: extrae los dígitos del folio", () => {
  assert.equal(folioToInt("P0012"), 12);
  assert.equal(folioToInt("0012"), 12);
  assert.equal(nextPatientNumberFromFolios(["P0012", "0015"]), "P0016");
});

test("solo folios corruptos → arranca en P0001", () => {
  assert.equal(nextPatientNumberFromFolios(["ABC", "---"]), "P0001");
});

test("el folio no se recicla: la query NO filtra por deletedAt", () => {
  // Guard de regresión. Si alguien añade `deletedAt IS NULL` a lastPatientFolio,
  // los folios de pacientes archivados se reasignan y vuelve el P2002.
  const sql = readFileSync(join(__dirname, "..", "next-patient-number.ts"), "utf8");
  const query = sql.slice(sql.indexOf("SELECT MAX"), sql.indexOf("`;", sql.indexOf("SELECT MAX")));
  assert.ok(query.includes('FROM "patients"'), "la query debe leer de patients");
  assert.ok(!/deletedAt/.test(query), "la query NO debe filtrar por deletedAt");
});
