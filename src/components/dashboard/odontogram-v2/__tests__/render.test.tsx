/**
 * ws1-t12 ronda 5 — N4 (QA ws1-t10 ronda 4): un hallazgo de SUPERFICIE
 * (caries…) importado sin cara específica se guardaba pero no se dibujaba en
 * ningún lado — `ToothGlyph` solo pinta condiciones de diente completo, y
 * `Surface2D` solo pintaba las de `record.surfaces` (por cara). Un hallazgo
 * con `surface: null` cae en `record.tooth`, así que ninguno de los dos lo
 * mostraba: desaparecía en silencio.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/dashboard/odontogram-v2/__tests__/render.test.tsx
 *
 * Solo Surface2D/ToothGlyph (SVG puros, sin CSS ni next/font): App.tsx importa
 * `./odontogram.css` y `@/fonts/odo` (next/font/local), que necesitan el
 * pipeline de build de Next y no se pueden renderizar con `tsx` a secas — ver
 * el reporte de esta ronda, verificado en vivo en dev.108 en su lugar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Surface2D } from "../Surface2D";
import { ToothGlyph } from "../ToothGlyph";
import { classify } from "../data";
import type { ToothRecord } from "../types";

const meta36 = classify(36); // molar inferior izquierdo, posterior

test("N4: una caries (surface target) sin cara específica SÍ se ve en el círculo — antes desaparecía", () => {
  const record: ToothRecord = { surfaces: {}, tooth: ["caries"] };
  const html = renderToStaticMarkup(
    <Surface2D meta={meta36} record={record} onSurface={() => {}} />,
  );
  // El marcador nuevo: un círculo pequeño con el color del grupo "diagnostic" y
  // un <title> que dice explícitamente que no tiene cara asignada — nunca se
  // pinta en una zona real (eso mentiría sobre cuál cara es).
  assert.match(html, /sin cara específica/, "el hallazgo sin cara debe verse marcado, no desaparecer");
  assert.match(html, /Caries/);
});

test("N4: el mismo hallazgo CON cara sigue pintándose en su zona de siempre (sin el marcador nuevo)", () => {
  const record: ToothRecord = { surfaces: { M: ["caries"] }, tooth: [] };
  const html = renderToStaticMarkup(
    <Surface2D meta={meta36} record={record} onSurface={() => {}} />,
  );
  assert.ok(!html.includes("sin cara específica"), "con cara asignada, no hace falta el marcador genérico");
});

test("N4: una condición de DIENTE COMPLETO (corona) no dispara el marcador — solo las de superficie", () => {
  const record: ToothRecord = { surfaces: {}, tooth: ["crown"] };
  const html = renderToStaticMarkup(
    <Surface2D meta={meta36} record={record} onSurface={() => {}} />,
  );
  assert.ok(!html.includes("sin cara específica"), "una condición de diente completo no es una superficie sin cara: no aplica el marcador");
});

test("N4: dos hallazgos de superficie sin cara en el mismo diente se ven los DOS (no se pisan)", () => {
  const record: ToothRecord = { surfaces: {}, tooth: ["caries", "pigmentation"] };
  const html = renderToStaticMarkup(
    <Surface2D meta={meta36} record={record} onSurface={() => {}} />,
  );
  assert.match(html, /Caries/);
  assert.match(html, /Pigmentación/);
  assert.equal((html.match(/sin cara específica/g) ?? []).length, 2);
});

test("ToothGlyph no revienta con un hallazgo de superficie sin cara (aunque no lo dibuje ahí: lo dibuja Surface2D)", () => {
  const record: ToothRecord = { surfaces: {}, tooth: ["caries"] };
  const html = renderToStaticMarkup(<ToothGlyph meta={meta36} record={record} />);
  assert.ok(html.includes("<svg"));
});
