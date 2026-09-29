/**
 * ws1-t10 — la pantalla final de la importación con errores: no dice «correctamente» si algo falló, dice QUÉ falló y
 * por qué (por archivo y por fila) y ofrece el reporte.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/import/__tests__/resultado-con-errores.test.tsx
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultPanel } from "../result-panel";
import type { CommitResult } from "../import-client";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const mk = (d: any) => (k: string, p?: Record<string, any>) => {
  let v: any = k.split(".").reduce((o: any, x) => o?.[x], d);
  if (v && typeof v === "object") v = p?.count === 1 ? v.one : v.other;
  if (typeof v !== "string") return `«${k}»`;
  return v.replace(/\{(\w+)\}/g, (_: string, n: string) => String(p?.[n] ?? ""));
};

const MOTIVO = "Tratamiento #7001: La base de datos rechazó el caso: el costo total (0) debe ser mayor que cero.";
const conErrores = (created: number): CommitResult => ({
  created,
  errors: 5,
  duplicates: 0,
  summary: { treatmentPlans: created },
  errorRows: [2, 3, 4, 5, 6].map((row) => ({ entity: "treatmentPlans" as const, fileName: "06.csv", row, errors: [MOTIVO] })),
});
const pintar = (t: any, result: CommitResult) =>
  renderToStaticMarkup(<ResultPanel t={t} result={result} onGoPatients={() => {}} onImportAnother={() => {}} onDownloadReport={() => {}} />);

for (const [lang, dic] of [["es", es], ["en", en]] as const) {
  const t = mk(dic) as any;

  test(`${lang}: sin errores dice que salió bien y no enseña la lista de fallas`, () => {
    const html = pintar(t, { created: 3, errors: 0, duplicates: 0, summary: { treatmentPlans: 3 } });
    assert.ok(!html.includes("«shell."), "clave sin traducir: " + (html.match(/«shell[^»]*»/g) ?? []).join());
    assert.match(html, lang === "es" ? /Importamos tus datos correctamente\./ : /imported your data successfully\./);
    assert.doesNotMatch(html, /Descargar reporte|Download report/);
  });

  test(`${lang}: si NADA entró no dice «correctamente» ni «Listo»: dice qué falló, dónde y por qué`, () => {
    const html = pintar(t, conErrores(0));
    assert.ok(!html.includes("«shell."), "clave sin traducir: " + (html.match(/«shell[^»]*»/g) ?? []).join());
    assert.doesNotMatch(html, /correctamente|successfully|¡Listo!|Done!/);
    assert.match(html, lang === "es" ? /No se importó nada/ : /Nothing was imported/);
    assert.match(html, lang === "es" ? /No se importó ningún registro: 5 registros con error/ : /No records were imported: 5 records with errors/);
    // Por archivo y por fila, con el motivo una sola vez (mismo motivo = una línea, filas juntas).
    assert.match(html, /06\.csv/);
    assert.match(html, lang === "es" ? /Filas 2, 3, 4, 5, 6/ : /Rows 2, 3, 4, 5, 6/);
    assert.equal(html.split("debe ser mayor que cero").length - 1, 1);
    assert.match(html, /Descargar reporte|Download report/);
  });

  test(`${lang}: si entró una parte lo dice con la cuenta y también enseña las fallas`, () => {
    const html = pintar(t, conErrores(2));
    assert.doesNotMatch(html, /correctamente|successfully/);
    assert.match(html, lang === "es" ? /Importación terminada con errores/ : /Import finished with errors/);
    assert.match(html, lang === "es" ? /Se importaron 2 registros\. 5 registros con error/ : /2 records were imported\. 5 records with errors/);
    assert.match(html, /Tratamiento #7001/);
  });

  test(`${lang}: una falla de todo el archivo (fila 0) no se llama «fila 0»`, () => {
    const html = pintar(t, { created: 1, errors: 1, duplicates: 0, summary: {}, errorRows: [{ entity: "balances", fileName: "04.csv", row: 0, errors: ["No se pudo procesar el archivo"] }] });
    assert.match(html, lang === "es" ? /Todo el archivo/ : /Whole file/);
    assert.doesNotMatch(html, /Fila 0|Row 0/);
  });

  test(`${lang}: con más fallas que filas recibidas lo dice`, () => {
    const html = pintar(t, { ...conErrores(0), errors: 900 });
    assert.match(html, lang === "es" ? /Se muestran 5 de 900 filas con error/ : /Showing 5 of 900 rows with errors/);
  });
}
