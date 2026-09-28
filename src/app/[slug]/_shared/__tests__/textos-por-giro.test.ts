/**
 * WS1-T4 ronda 6 · G5 — textos por defecto de la página pública según el giro.
 *
 * Run: npx tsx --test "src/app/[slug]/_shared/__tests__/textos-por-giro.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { porDefectoSegunGiro } from "../textos-por-giro";
import { manifestOf } from "../template-manifest";

const LITERALES = [
  ["Equipo médico", "Nuestro equipo"],
  ["Tratamientos con tecnología de vanguardia para tu salud y bienestar", "Tratamientos con tecnología de vanguardia para tu salud bucal"],
  ["Profesionales certificados comprometidos con tu salud", "Profesionales certificados comprometidos con tu salud bucal"],
] as const;

test("una clínica DENTAL ve la versión dental de los tres textos", () => {
  for (const [literal, dental] of LITERALES) assert.equal(porDefectoSegunGiro("DENTAL", literal), dental);
});

test("las demás categorías (y sin categoría) ven el literal de siempre", () => {
  for (const c of ["MEDICINE", "NUTRITION", "SPA", "PODIATRY", "OTHER", "dental", "", null, undefined]) {
    for (const [literal] of LITERALES) assert.equal(porDefectoSegunGiro(c, literal), literal, String(c));
  }
});

test("en DENTAL, un texto que no está en la lista no cambia", () => {
  assert.equal(porDefectoSegunGiro("DENTAL", "Nuestros especialistas"), "Nuestros especialistas");
  assert.equal(porDefectoSegunGiro("DENTAL", "Servicios"), "Servicios");
  assert.equal(porDefectoSegunGiro("DENTAL", ""), "");
});

test("los literales siguen siendo los REALES del manifiesto y de las plantillas", () => {
  // Si alguien cambia el literal en la plantilla, la versión dental dejaría de
  // aplicarse en silencio. Esto lo avisa.
  const classic = manifestOf("classic");
  const healthtech = manifestOf("healthtech");
  const defaults = (m: ReturnType<typeof manifestOf>) => [
    ...m.textos.map((t) => t.porDefecto),
    ...(m.copia ?? []).map((c) => c.porDefecto),
  ];
  for (const [literal] of LITERALES) assert.ok(defaults(classic).includes(literal), `classic: ${literal}`);
  assert.ok(defaults(healthtech).includes("Equipo médico"));

  const fuenteClassic = readFileSync(join(process.cwd(), "src/app/[slug]/landing-client.tsx"), "utf8");
  for (const [literal] of LITERALES) assert.ok(fuenteClassic.includes(`"${literal}"`), `landing-client: ${literal}`);
  const fuenteHealthtech = readFileSync(join(process.cwd(), "src/app/[slug]/templates/template-healthtech.tsx"), "utf8");
  assert.ok(fuenteHealthtech.includes(`"Equipo médico"`));
});
