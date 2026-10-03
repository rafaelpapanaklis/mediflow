/**
 * ANALÍTICA Y REPORTES: TEXTOS EN CRISTIANO (ws1-t5, auditoría BEVADENT).
 *
 * Run: npm run test:textos-analitica
 *
 * Roles («SUPER_ADMIN»), estados del recorrido del paciente («Checked-out»,
 * «CHECKED_IN → IN_CHAIR»), tipos de recurso («SILLA_DENTAL») y fórmulas
 * («SUM(invoice.paid)») salían tal cual del código. Y los vencimientos de
 * cobranza de ortodoncia salían sin año («Vence el 02-nov»).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import es from "../../../../i18n/dictionaries/es.json";
import en from "../../../../i18n/dictionaries/en.json";
import { rolLegible } from "../doctors/rol-legible";
import { traducirRecorrido } from "../journey/textos-journey";
import { nombreDeTipoDeRecurso } from "../../reports/estados-de-cita";

const dic = (d: any) => (key: string, vars?: Record<string, string | number>): string => {
  let v: any = d;
  for (const p of key.split(".")) v = v?.[p];
  if (typeof v !== "string") return key;
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ""));
};
const tEs = dic(es);
const tEn = dic(en);

test("roles: «Dueño/a» y «Doctor/a», nunca el código", () => {
  assert.equal(rolLegible("SUPER_ADMIN", tEs), "Dueño/a");
  assert.equal(rolLegible("DOCTOR", tEs), "Doctor/a");
  assert.equal(rolLegible("RECEPTIONIST", tEs), "Recepción");
  assert.equal(rolLegible("SUPER_ADMIN", tEn), "Owner");
  assert.equal(rolLegible("OTRO_ROL", tEs), "OTRO_ROL");
});

test("tipos de recurso: «Sillón» en vez de SILLA_DENTAL; el desconocido es «Otro»", () => {
  assert.equal(nombreDeTipoDeRecurso("SILLA_DENTAL", tEs), "Sillón");
  assert.equal(nombreDeTipoDeRecurso("CHAIR", tEs), "Sillón");
  assert.equal(nombreDeTipoDeRecurso("RADIOGRAFIA", tEs), "Radiografía");
  assert.equal(nombreDeTipoDeRecurso("OTHER", tEs), "Otro");
  assert.equal(nombreDeTipoDeRecurso("SILLA_DENTAL", tEn), "Chair");
});

test("Reportes: el estado IN_PROGRESS se llama «En consulta», como en el resto del panel", () => {
  assert.equal(tEs("analytics.reports.statusInProgress"), "En consulta");
  assert.equal(tEn("analytics.reports.statusInProgress"), "In consultation");
});

test("recorrido del paciente: etapas y embudo en español, sin códigos", () => {
  const crudo = {
    totalAppts: 3,
    funnel: [
      { id: "arrived", label: "Llegaron", count: 2 },
      { id: "checkout", label: "Checked-out", count: 1 },
    ],
    dropOffs: { cancelled: 0, noShow: 0 },
    stages: [
      { id: "wait", label: "Espera", from: "Llegada (CHECKED_IN)", to: "En sillón (IN_CHAIR)", avgMin: 10, sample: 2 },
      { id: "checkout", label: "Checkout", from: "Fin consulta", to: "Salida (CHECKED_OUT)", avgMin: 4, sample: 1 },
    ],
    bottleneck: { id: "wait", label: "Espera", from: "Llegada (CHECKED_IN)", to: "En sillón (IN_CHAIR)", avgMin: 10, sample: 2 },
  };
  const r = traducirRecorrido(crudo, tEs);
  assert.equal(r.funnel[1].label, "Salieron");
  assert.equal(r.stages[0].from, "Llegada");
  assert.equal(r.stages[0].to, "Pasa al sillón");
  assert.equal(r.stages[1].label, "Salida");
  assert.equal(r.bottleneck?.to, "Pasa al sillón");
  const todo = JSON.stringify(r);
  assert.doesNotMatch(todo, /CHECKED|IN_CHAIR|IN_PROGRESS|Checked|Checkout/);
  const ingles = traducirRecorrido(crudo, tEn);
  assert.equal(ingles.funnel[1].label, "Left");
});

test("el API del recorrido ya no escribe códigos de estado en los textos", () => {
  const src = readFileSync(join(__dirname, "../../../api/analytics/journey/route.ts"), "utf8");
  assert.doesNotMatch(src, /"[^"]*\((CHECKED_IN|IN_CHAIR|IN_PROGRESS|COMPLETED|CHECKED_OUT)\)"/);
  assert.doesNotMatch(src, /Checked-out/);
});

test("el diccionario de Analítica no muestra fórmulas ni nombres de tablas al usuario", () => {
  for (const [nombre, d] of [["es", es], ["en", en]] as const) {
    const txt = JSON.stringify((d as any).analytics);
    assert.doesNotMatch(txt, /SUM\(|AppointmentTimeline|CHECKED_IN|IN_CHAIR|IN_PROGRESS → |status = |sample=0|invoice\.appointment/, nombre);
  }
});

test("cobranza de ortodoncia: los vencimientos llevan año (fmtDayLong), no «02-nov»", () => {
  const base = join(__dirname, "../../../../components/specialties/orthodontics");
  for (const f of ["cobranza/ResumenCobranza.tsx", "cobranza/ListaMensualidades.tsx", "redesign/sections/SectionFinance.tsx", "redesign/sidebar/RightRail.tsx"]) {
    const src = readFileSync(join(base, f), "utf8");
    assert.doesNotMatch(src, /\bfmtDay\(/, f);
    assert.match(src, /fmtDayLong\(/, f);
  }
});
