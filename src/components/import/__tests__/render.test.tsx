/**
 * Ajuste 2 (ws1-t6) — render de los pasos del asistente de importación (SSR, sin navegador).
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/import/__tests__/render.test.tsx
 * (necesita el tsconfig de pruebas: el test importa componentes con JSX)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepOrigin } from "../step-origin";
import { StepReview } from "../step-review";
import { StepSheet } from "../step-sheet";
import { ORIGINS } from "../import-client";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const mk = (d: any) => (k: string, p?: Record<string, any>) => {
  let v: any = k.split(".").reduce((o: any, x) => o?.[x], d);
  if (v && typeof v === "object") v = p?.count === 1 ? v.one : v.other;
  if (typeof v !== "string") return `«${k}»`;
  return v.replace(/\{(\w+)\}/g, (_: string, n: string) => String(p?.[n] ?? ""));
};

for (const [lang, dic] of [["es", es], ["en", en]] as const) {
  const t = mk(dic) as any;

  test(`${lang}: paso 1 — los perfiles sin validar dicen «sin validar», no «listo»`, () => {
    const html = renderToStaticMarkup(<StepOrigin t={t} origins={ORIGINS} selected={null} onSelect={() => {}} onAssisted={() => {}} />);
    assert.ok(!html.includes("«shell."), "clave sin traducir");
    assert.equal((html.match(/imp-src-card__meta/g) ?? []).length, ORIGINS.length);
    assert.ok(!/Perfil listo|Profile ready/.test(html), "ninguna tarjeta dice «listo»: ninguno está validado");
    assert.ok(/Perfil sin validar|Unvalidated profile/.test(html));
    assert.ok(/Mapeo manual|Manual mapping/i.test(html), "Mi Excel / Otro siguen en manual");
    // Y si un perfil SÍ estuviera validado, sí diría «listo».
    const validado = renderToStaticMarkup(<StepOrigin t={t} origins={[{ ...ORIGINS[0], verified: true }]} selected={null} onSelect={() => {}} onAssisted={() => {}} />);
    assert.ok(/Perfil listo|Profile ready/.test(validado));
  });

  test(`${lang}: paso 6 de CITAS — fecha y hora, doctor, paciente y duración; filas con error con su nombre`, () => {
    const preview: any = {
      totalRows: 3, columns: [], targetFields: [], timezone: "America/Merida", stats: { valid: 1, errors: 1, duplicates: 0, omitted: 1 },
      rows: [
        { row: 2, name: "María Hernández", phone: "5551234567", balance: "—", when: "15/01/2030 15:30", doctor: "Ana López", duration: 45, status: "ok" },
        { row: 3, name: "María Hernández", phone: "—", balance: "—", when: "15/01/2020 10:00", doctor: "Ana López", duration: 30, status: "skipped", reason: "Cita pasada" },
        { row: 4, name: "Persona Inventada", phone: "555", balance: "—", when: "16/01/2030 09:00", doctor: "Nadie", duration: 30, status: "error", reason: "Doctor no encontrado" },
      ],
    };
    const html = renderToStaticMarkup(
      <StepReview t={t} entity="appointments" unverifiedName={null} amountFormat={null} preview={preview} skipDup onToggleSkip={() => {}} decisions={{}} onDecide={() => {}} />,
    );
    assert.ok(!html.includes("«shell."), "clave sin traducir: " + (html.match(/«shell[^»]*»/g) ?? []).join());
    for (const frag of ["15/01/2030 15:30", "Ana López", "45 min", "Persona Inventada", "America/Merida", "16/01/2030 09:00"]) assert.ok(html.includes(frag), frag);
    assert.ok(/Fecha y hora|Date and time/.test(html) && /Doctor/.test(html));
    // La tabla de pacientes (con saldo) sigue igual para lo que no son citas.
    const pac = renderToStaticMarkup(
      <StepReview t={t} entity="patients" unverifiedName={null} amountFormat={null} preview={{ ...preview, timezone: undefined }} skipDup onToggleSkip={() => {}} decisions={{}} onDecide={() => {}} />,
    );
    assert.ok(!pac.includes("15/01/2030 15:30"), "pacientes no muestra la hora de una cita");
    assert.ok(/Saldo|Balance/.test(pac));
  });

  test(`${lang}: paso 6 del ODONTOGRAMA — un hallazgo sin emparejar no ofrece "sin ligar" (no existe esa opción)`, () => {
    const preview: any = {
      totalRows: 1, columns: [], targetFields: [], stats: { valid: 1, errors: 0, duplicates: 0 },
      rows: [{ row: 2, name: "María Hernández", phone: "5551234567", balance: "—", detail: "Mancha rarísima XYZ · #21", status: "ok" }],
      unresolved: [{ field: "condition", key: "manchararisimaxyz", value: "Mancha rarísima XYZ", rows: 1 }],
      options: { condition: [{ id: "caries", label: "Caries" }, { id: "pigmentation", label: "Pigmentación" }] },
    };
    const html = renderToStaticMarkup(
      <StepReview t={t} entity="odontogram" unverifiedName={null} amountFormat={null} preview={preview} skipDup onToggleSkip={() => {}} decisions={{}} onDecide={() => {}} />,
    );
    assert.ok(!html.includes("«shell."), "clave sin traducir: " + (html.match(/«shell[^»]*»/g) ?? []).join());
    assert.ok(html.includes("Mancha rarísima XYZ") && html.includes("Caries") && html.includes("Pigmentación"));
    assert.ok(!/Solo el importe, sin ligar|Amount only, not linked/.test(html), "el odontograma no tiene un resguardo 'sin ligar'");
  });

  test(`${lang}: selector de pestañas — sugerida preseleccionada y vista previa; sin propuesta no elige nada`, () => {
    const sheets = [
      { name: "Notas", rows: 1, columns: ["Texto"], sample: [["recordar"]] },
      { name: "Pacientes morosos", rows: 2, columns: ["Celular", "Saldo"], sample: [["5551234567", "1500"], ["+56987654321", "300"]] },
    ];
    const con = renderToStaticMarkup(<StepSheet t={t} entity="balances" sheets={sheets} suggested="Pacientes morosos" current={null} onConfirm={() => {}} />);
    assert.ok(!con.includes("«shell."));
    assert.ok(con.includes("5551234567") && /Sugerida|Suggested/.test(con));
    const sin = renderToStaticMarkup(<StepSheet t={t} entity="balances" sheets={sheets} suggested={null} current={null} onConfirm={() => {}} />);
    assert.ok(!sin.includes('checked=""') && sin.includes("disabled"));
  });
}
