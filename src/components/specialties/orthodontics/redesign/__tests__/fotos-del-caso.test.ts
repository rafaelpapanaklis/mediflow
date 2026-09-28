/**
 * «Comparar» fotos y los PDFs del caso en Documentos.
 *
 * Run: npx tsx --test src/components/specialties/orthodontics/redesign/__tests__/fotos-del-caso.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PhotoSetSummary } from "../sections/SectionPhotos";
import {
  MOTIVO_SIN_REPORTE_DE_AVANCE,
  etapaActualParaComparar,
  etapasParaComparar,
  hayReporteDeAvance,
  juegoParaComparar,
  sePuedeComparar,
} from "../fotos-del-caso";

const RAIZ = join(__dirname, "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const juego = (stage: PhotoSetSummary["stage"], date: string | null, fotos: Record<string, string> = {}): PhotoSetSummary => ({
  stage,
  date,
  photoCount: Object.keys(fotos).length,
  slots: Object.fromEntries(Object.entries(fotos).map(([k, url]) => [k, { url, uploadedAt: "" }])),
  hasRxPan: false,
  hasRxLatCef: false,
});

test("reporte de avance: hace falta el T0 y uno posterior (la misma regla que su ruta)", () => {
  assert.equal(hayReporteDeAvance([]), false);
  assert.equal(hayReporteDeAvance([juego("T0", "2026-01-01")]), false);
  assert.equal(hayReporteDeAvance([juego("CONTROL", "2026-03-01")]), false);
  for (const posterior of ["T1", "T2", "CONTROL"] as const) {
    assert.equal(hayReporteDeAvance([juego("T0", "2026-01-01"), juego(posterior, "2026-06-01")]), true, posterior);
  }
  assert.equal(MOTIVO_SIN_REPORTE_DE_AVANCE, "Hace falta el juego de fotos inicial y uno posterior");
  // La ruta acepta exactamente esas tres etapas como «después».
  const ruta = readFileSync(
    join(__dirname, "..", "..", "..", "..", "..", "app", "api", "orthodontics", "treatment-plans", "[id]", "progress-report-pdf", "route.tsx"),
    "utf8",
  );
  assert.match(ruta, /setType === "T0"/);
  for (const e of ["T2", "T1", "CONTROL"]) assert.match(ruta, new RegExp(`setType === "${e}"`));
});

test("comparar: solo con fotos en el inicial y en alguna etapa posterior", () => {
  assert.equal(sePuedeComparar([juego("T0", "2026-01-01", { frontal: "a" })]), false);
  assert.equal(sePuedeComparar([juego("T0", "2026-01-01"), juego("T1", "2026-04-01", { frontal: "b" })]), false, "T0 vacío");
  assert.equal(sePuedeComparar([juego("T0", "2026-01-01", { frontal: "a" }), juego("T1", "2026-04-01")]), false, "T1 vacío");
  const sets = [
    juego("T0", "2026-01-01", { frontal: "a" }),
    juego("T1", "2026-04-01", { frontal: "b" }),
    juego("CONTROL", "2026-05-01", { frontal: "c" }),
    juego("CONTROL", "2026-08-01", { frontal: "d", sonrisa: "e" }),
  ];
  assert.equal(sePuedeComparar(sets), true);
  assert.deepEqual(etapasParaComparar(sets), ["T1", "CONTROL"]);
  assert.equal(etapaActualParaComparar(sets), "CONTROL", "abre con la más reciente");
  // En CONTROL hay un juego por visita: se compara el último.
  assert.deepEqual(juegoParaComparar(sets, "CONTROL"), {
    stage: "CONTROL",
    takenAt: "2026-08-01",
    photos: { frontal: "d", sonrisa: "e" },
  });
  assert.equal(juegoParaComparar(sets, "T2"), null);
});

test("la ficha conecta «Comparar» y los PDFs de Documentos", () => {
  const cliente = leer("OrthodonticsRedesignClient.tsx");
  assert.match(cliente, /<ModalCompare\b/);
  assert.match(cliente, /onCompare=\{\s*sePuedeComparar\(juegosDeFotos\)/);
  assert.match(cliente, /treatmentPlanId=\{t\.treatmentPlanId \|\| null\}/);
  assert.match(cliente, /hayReporteDeAvance\(juegosDeFotos\) \? null : MOTIVO_SIN_REPORTE_DE_AVANCE/);

  const docs = leer("sections/SectionDocs.tsx");
  assert.match(docs, /\/api\/orthodontics\/treatment-plans\/\$\{encodeURIComponent\(treatmentPlanId\)\}\/treatment-plan-pdf/);
  assert.match(docs, /\/api\/orthodontics\/treatment-plans\/\$\{encodeURIComponent\(treatmentPlanId\)\}\/progress-report-pdf/);
  assert.match(docs, /PDF del plan de tratamiento/);
  assert.match(docs, /Reporte de avance \(PDF\)/);
  assert.match(docs, /disabled=\{motivoSinReporteDeAvance !== null\}/);
  assert.match(docs, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
});
