/**
 * ws1-t6 — importador: la vista previa dice cuántas filas muestra y pone primero lo que hay que mirar; la pantalla
 * final no celebra cuando no se importó nada; el perfil de Dentalink ya no lleva el aviso de «sin validar».
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/import/__tests__/revision-y-resultado.test.tsx
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepReview } from "../step-review";
import { ResultPanel } from "../result-panel";
import { adaptPreview, filasAMostrar } from "@/lib/import/client";
import { filasParaVistaPrevia } from "@/lib/import/engine";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const mk = (d: any) => (k: string, p?: Record<string, any>) => {
  let v: any = k.split(".").reduce((o: any, x) => o?.[x], d);
  if (v && typeof v === "object") v = p?.count === 1 ? v.one : v.other;
  if (typeof v !== "string") return `«${k}»`;
  return v.replace(/\{(\w+)\}/g, (_: string, n: string) => String(p?.[n] ?? ""));
};

const fila = (row: number, status: string) => ({ row, status, data: { firstName: `P${row}` }, errors: status === "error" ? ["Teléfono inválido"] : [], warnings: [] });

test("engine: la vista previa manda primero error/omitidas, luego duplicados y luego válidas (orden del archivo dentro de cada grupo)", () => {
  const filas: any[] = [];
  for (let i = 1; i <= 300; i++) filas.push(fila(i, i === 250 || i === 260 ? "error" : i === 7 ? "duplicate" : i === 9 ? "skipped" : "ok"));
  const v = filasParaVistaPrevia(filas);
  assert.equal(v.length, 200);
  assert.deepEqual(v.slice(0, 4).map((r) => [r.row, r.status]), [[250, "error"], [260, "error"], [9, "skipped"], [7, "duplicate"]]);
  assert.equal(v[4].row, 1);
  // Si caben todas: tal cual, en el orden del archivo (el cliente las ordena).
  const cortas: any[] = [fila(1, "ok"), fila(2, "error")];
  assert.equal(filasParaVistaPrevia(cortas), cortas);
});

test("cliente: los errores nunca se recortan aunque pasen de 100 filas; el resto se completa hasta 100", () => {
  const filas = Array.from({ length: 200 }, (_, i) => ({ row: i + 2, status: i < 130 ? "error" : "ok" }));
  assert.equal(filasAMostrar(filas).length, 130);
  const pocas = Array.from({ length: 200 }, (_, i) => ({ row: i + 2, status: i === 150 ? "error" : "ok" }));
  const m = filasAMostrar(pocas);
  assert.equal(m.length, 100);
  assert.equal(m[0].row, 152, "el error de la fila 152 sale primero");
});

const preview = (rows: any[], total: number, errors: number): any => ({
  totalRows: total, columns: [], targetFields: [], stats: { valid: total - errors, errors, duplicates: 0 }, rows,
});
const fpv = (row: number, status: string) => ({ row, name: `P${row}`, phone: "—", balance: "—", status, ...(status === "error" ? { reason: "Teléfono inválido" } : {}) });

for (const [lang, dic] of [["es", es], ["en", en]] as const) {
  const t = mk(dic) as any;
  const pintar = (p: any, unverifiedName: string | null = null) =>
    renderToStaticMarkup(<StepReview t={t} entity="patients" unverifiedName={unverifiedName} amountFormat={null} preview={p} skipDup onToggleSkip={() => {}} decisions={{}} onDecide={() => {}} />);

  test(`${lang}: revisar dice «Mostrando 100 de 954 filas», ofrece «solo errores» y avisa que es una muestra`, () => {
    const rows = Array.from({ length: 100 }, (_, i) => fpv(i + 2, i === 0 ? "error" : "ok"));
    const html = pintar(preview(rows, 954, 3));
    assert.ok(!html.includes("«shell."), "clave sin traducir: " + (html.match(/«shell[^»]*»/g) ?? []).join());
    assert.match(html, lang === "es" ? /Mostrando 100 de 954 filas/ : /Showing 100 of 954 rows/);
    assert.match(html, lang === "es" ? /Solo errores/ : /Errors only/);
    assert.match(html, lang === "es" ? /son una muestra|el resto es una muestra/ : /the rest is a sample/);
  });

  test(`${lang}: revisar con todas las filas a la vista no repite la nota de muestra ni ofrece «solo errores» sin errores`, () => {
    const html = pintar(preview([fpv(2, "ok"), fpv(3, "ok")], 2, 0));
    assert.match(html, lang === "es" ? /Mostrando 2 de 2 filas/ : /Showing 2 of 2 rows/);
    assert.ok(!/Solo errores|Errors only/.test(html));
    assert.ok(!/es una muestra|is a sample/.test(html));
  });

  test(`${lang}: revisar sin perfil sin validar no trae el aviso; con uno sin validar sí`, () => {
    assert.ok(!/aún no está validado|not been validated/.test(pintar(preview([fpv(2, "ok")], 1, 0), null)));
    assert.match(pintar(preview([fpv(2, "ok")], 1, 0), "Medilink"), /Medilink/);
  });

  const final = (result: any) =>
    renderToStaticMarkup(<ResultPanel t={t} result={result} onGoPatients={() => {}} onImportAnother={() => {}} onDownloadReport={() => {}} />);

  test(`${lang}: 0 registros importados dice que no había nada nuevo (y cuántos ID se recordaron)`, () => {
    const solo = final({ created: 0, errors: 0, duplicates: 5, summary: { patients: 0 } });
    assert.match(solo, lang === "es" ? /No había nada nuevo que importar/ : /nothing new to import/);
    assert.ok(!/¡Listo!|Done!|correctamente|successfully/.test(solo));
    const con = final({ created: 0, errors: 0, duplicates: 5, remembered: 5, summary: { patients: 0 } });
    assert.match(con, lang === "es" ? /Se recordaron 5 ID de pacientes duplicados/ : /5 duplicate patient IDs were remembered/);
    // Con algo importado, sigue el mensaje de siempre.
    assert.match(final({ created: 3, errors: 0, duplicates: 0, summary: { patients: 3 } }), lang === "es" ? /¡Listo!/ : /Done!/);
  });
}

test("adaptPreview: totalRows es el del archivo aunque la tabla muestre menos", () => {
  const b: any = { entity: "patients", total: 954, validos: 950, invalidos: 4, duplicados: 0, columns: [], preview: Array.from({ length: 200 }, (_, i) => fila(i + 2, i === 150 ? "error" : "ok")) };
  const r = adaptPreview("patients", b);
  assert.equal(r.totalRows, 954);
  assert.equal(r.rows.length, 100);
  assert.equal(r.rows[0].status, "error");
});
