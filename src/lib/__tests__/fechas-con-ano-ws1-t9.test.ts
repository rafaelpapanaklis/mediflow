/**
 * Fechas con año en Caja, tarjeta de plan, Inicio y Agenda (revisión de Chrome, ws1-t9 #9).
 *
 * Run: npx tsx --test src/lib/__tests__/fechas-con-ano-ws1-t9.test.ts
 *
 * Con el código viejo salían «18 jul», «Próxima: 3 nov», «Jue 15 oct» y «Miércoles 2 de septiembre».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fechaPanel } from "@/lib/formato-fecha-panel";
import { tituloDePeriodo } from "@/lib/agenda-nueva/fechas";

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

test("el formato corto del panel lleva año", () => {
  assert.equal(fechaPanel("2026-07-18T18:00:00Z", "America/Mexico_City"), "18 jul 2026");
  assert.equal(fechaPanel("2026-11-03T18:00:00Z", "America/Mexico_City"), "3 nov 2026");
});

test("el encabezado de Agenda (vista Día) trae el año", () => {
  assert.equal(tituloDePeriodo("dia", "2026-10-15"), "Jueves 15 de octubre de 2026");
});

test("Caja: el prefijo y el encabezado del día usan el formato con año", () => {
  const c = src("src/app/dashboard/caja/caja-client.tsx");
  assert.match(c, /const fmtDayShort = \(iso: string\) => fechaPanel\(iso, tz, locale\)/);
  assert.doesNotMatch(c, /day: "2-digit", month: "short", timeZone: tz/);
});

test("Inicio y la tarjeta de plan usan fechaPanel, no «día mes» sin año", () => {
  for (const rel of [
    "src/components/dashboard/hoy-rediseno/tarjeta-proximas.tsx",
    "src/components/dashboard/home/parts/upcoming-appointments-card.tsx",
    "src/components/dashboard/expediente-rediseno/plan-tratamiento.tsx",
    "src/app/dashboard/patients/[id]/patient-detail-client.tsx",
  ]) {
    assert.match(src(rel), /fechaPanel\(/, rel);
  }
  assert.doesNotMatch(src("src/components/dashboard/expediente-rediseno/plan-tratamiento.tsx"), /nextExpectedDate\)\.toLocaleDateString/);
});
