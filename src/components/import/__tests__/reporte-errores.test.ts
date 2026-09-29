/**
 * ws1-t10 — el reporte de errores de la importación: qué falló, en qué archivo y fila, y por qué; y que se descarga.
 * Run: npx tsx --test src/components/import/__tests__/reporte-errores.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorArchivo, agruparPorMotivo, armarReporteCsv, celdaCsv, filasConError, nombreDelArchivo, nombreDelReporte } from "../reporte-errores";
import type { CommitResult, ErrorDeFila } from "../import-client";

const F = (entity: ErrorDeFila["entity"], fileName: string, row: number, ...errors: string[]): ErrorDeFila => ({ entity, fileName, row, errors });

test("el nombre del archivo lleva la pestaña cuando el libro trae varias", () => {
  assert.equal(nombreDelArchivo({ name: "06.csv" }), "06.csv");
  assert.equal(nombreDelArchivo({ name: "libro.xlsx" }, "Presupuestos"), "libro.xlsx · Presupuestos");
  assert.equal(nombreDelArchivo(null), "");
});

test("filas de varios resultados, agrupadas por archivo y ordenadas por fila", () => {
  const a: CommitResult = { created: 0, errors: 2, duplicates: 0, summary: {}, errorRows: [F("treatmentPlans", "06.csv", 5, "x"), F("treatmentPlans", "06.csv", 2, "y")] };
  const b: CommitResult = { created: 3, errors: 1, duplicates: 0, summary: {}, errorRows: [F("patients", "01.csv", 9, "z")] };
  const sinFilas: CommitResult = { created: 1, errors: 0, duplicates: 0, summary: {} };
  const todas = filasConError([a, undefined, sinFilas, b, null]);
  assert.equal(todas.length, 3);
  const g = agruparPorArchivo(todas);
  assert.deepEqual(g.map((x) => [x.fileName, x.entity, x.filas.map((f) => f.row)]), [["06.csv", "treatmentPlans", [2, 5]], ["01.csv", "patients", [9]]]);
});

test("CSV: encabezado, una línea por motivo, comillas escapadas, BOM y saltos CRLF", () => {
  const csv = armarReporteCsv(
    [
      F("treatmentPlans", "06.csv", 3, "Tratamiento #7001: la base de datos rechazó el caso: el costo total (0) debe ser mayor que cero."),
      F("patients", "01.csv · Hoja 1", 12, 'Falta el "nombre"', "Teléfono, con coma"),
      F("patients", "01.csv", 13),
    ],
    (e) => (e === "treatmentPlans" ? "Tratamientos activos" : "Pacientes"),
  );
  assert.ok(csv.startsWith("﻿Archivo,Datos,Fila,Motivo\r\n"));
  const lineas = csv.replace("﻿", "").trimEnd().split("\r\n");
  assert.equal(lineas.length, 1 + 1 + 2 + 1);
  assert.equal(lineas[1], "06.csv,Tratamientos activos,3,Tratamiento #7001: la base de datos rechazó el caso: el costo total (0) debe ser mayor que cero.");
  assert.equal(lineas[2], '01.csv · Hoja 1,Pacientes,12,"Falta el ""nombre"""');
  assert.equal(lineas[3], '01.csv · Hoja 1,Pacientes,12,"Teléfono, con coma"');
  assert.equal(lineas[4], "01.csv,Pacientes,13,Sin motivo registrado", "una fila sin motivo no desaparece del reporte");
});

test("CSV: un valor que empieza con = + - @ no se abre como fórmula en Excel", () => {
  assert.equal(celdaCsv("=cmd|'/c calc'!A1"), "'=cmd|'/c calc'!A1");
  assert.equal(celdaCsv("+52 55"), "'+52 55");
  assert.equal(celdaCsv("@x"), "'@x");
  assert.equal(celdaCsv("normal"), "normal");
  assert.equal(celdaCsv(null), "");
  const csv = armarReporteCsv([F("patients", "=HYPERLINK(\"http://x\")", 2, "-1+1")]);
  assert.doesNotMatch(csv, /^[^\r\n]*\r\n=/, "ninguna línea empieza con =");
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /,'-1\+1\r\n$/);
});

test("nombre del reporte con la fecha local", () => {
  assert.equal(nombreDelReporte(new Date(2026, 8, 29, 23, 59)), "reporte-de-errores-2026-09-29.csv");
  assert.equal(nombreDelReporte(new Date(2026, 0, 5)), "reporte-de-errores-2026-01-05.csv");
});

test("las filas con el mismo motivo van juntas, en orden, sin repetir la fila", () => {
  const g = agruparPorMotivo([
    F("treatmentPlans", "06.csv", 4, "No se pudo guardar el caso"),
    F("treatmentPlans", "06.csv", 2, "No se pudo guardar el caso"),
    F("treatmentPlans", "06.csv", 3, "No se pudo guardar el caso", "Falta el paciente"),
    F("treatmentPlans", "06.csv", 9),
  ]);
  assert.deepEqual(g, [
    { motivo: "No se pudo guardar el caso", filas: [2, 3, 4] },
    { motivo: "Falta el paciente", filas: [3] },
    { motivo: "Sin motivo registrado", filas: [9] },
  ]);
});
