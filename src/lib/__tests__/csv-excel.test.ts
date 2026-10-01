import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOM_UTF8, armarCsvExcel, celdaCsv } from "../csv-excel";

test("el CSV empieza con BOM UTF-8 (Excel de Windows no rompe «Teléfono»)", () => {
  const csv = armarCsvExcel([["Teléfono", "Lucía"]]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.startsWith(BOM_UTF8), true);
  // Los bytes reales: EF BB BF al inicio y los acentos en UTF-8, no latin1.
  const bytes = Buffer.from(csv, "utf8");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(csv, /"Teléfono","Lucía"/);
});

test("comillas dobles escapadas, comas y saltos dentro de la celda no parten la fila", () => {
  assert.equal(celdaCsv('Ana "la Güera", López'), '"Ana ""la Güera"", López"');
  const csv = armarCsvExcel([["a", 'dijo "hola"\nadiós'], ["b", "c"]]);
  assert.equal(csv, `${BOM_UTF8}"a","dijo ""hola""\nadiós"\r\n"b","c"\r\n`);
});

test("números sin comillas (Excel los suma, incluso negativos); null y vacío quedan en blanco", () => {
  const csv = armarCsvExcel([["P0001", "Ana", null, undefined, 34, -1500.5, NaN]]);
  assert.equal(csv, `${BOM_UTF8}"P0001","Ana","","",34,-1500.5,""\r\n`);
});

test("un texto que empieza con = + - @ no se ejecuta como fórmula", () => {
  assert.equal(celdaCsv("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(celdaCsv("+52 55 1234"), `"'+52 55 1234"`);
  assert.equal(celdaCsv("@ana"), `"'@ana"`);
  assert.equal(celdaCsv("Ana"), `"Ana"`);
});

test("«Exportar CSV» de Pacientes usa el armador con BOM, no un join a mano", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/patients/patients-client.tsx"), "utf8");
  const i = src.indexOf("const bulkExportCsv");
  const bloque = src.slice(i, i + 1400);
  assert.match(bloque, /armarCsvExcel\(/);
  assert.doesNotMatch(bloque, /`"\$\{p\.fullName\}"`/, "ya no arma el nombre entre comillas sin escapar");
});

test("la subida de foto clínica valida con validarArchivo y no solo con la firma", () => {
  const src = readFileSync(join(process.cwd(), "src/app/actions/clinical-shared/photos.ts"), "utf8");
  assert.match(src, /validarArchivo\(\{[\s\S]*?perfil: PERFILES\.FOTO_CLINICA/);
  assert.doesNotMatch(src, /validateMagicNumber/);
});

test("ortodoncia/imagen/upload pone el motivo real en `error`, igual que photos/upload", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/orthodontics/imagen/upload/route.ts"), "utf8");
  assert.match(src, /error: `Archivo no válido: \$\{validado\.motivo\}`/);
  assert.doesNotMatch(src, /el contenido no coincide con la extensión/);
});
