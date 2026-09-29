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
import { elegirSetParaFoto } from "@/lib/orthodontics/redesign/set-de-foto-por-visita";

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

// ── ws1-t12 · «Juegos de fotos por etapa»: miniatura y «Ver juego completo» ──

test("juegos por etapa: la miniatura es la foto firmada de su vista, no un cuadro de color", () => {
  const fuente = leer("sections/SectionPhotos.tsx");
  const tarjeta = fuente.slice(fuente.indexOf("function HistoricalSetCard"), fuente.indexOf("function MiniaturaDeFoto"));
  // Recorre las 10 vistas por su id y saca la URL de `slots`…
  assert.match(tarjeta, /PHOTO_SLOTS\.map/);
  assert.match(tarjeta, /set\.slots\?\.\[slot\.id\]\?\.url/);
  assert.match(tarjeta, /<MiniaturaDeFoto/);
  // …y ya no pinta «las primeras N» de gris por posición (el bug: nunca había <img>).
  assert.doesNotMatch(tarjeta, /i < set\.photoCount/);
  const miniatura = fuente.slice(fuente.indexOf("function MiniaturaDeFoto"), fuente.indexOf("function JuegoCompleto"));
  assert.match(miniatura, /<img/);
  assert.match(miniatura, /onError/, "si la URL caducó queda el recuadro, sin icono de imagen rota");
});

test("«Ver juego completo» abre el juego con las 10 vistas aunque el padre no pase onViewSet", () => {
  const fuente = leer("sections/SectionPhotos.tsx");
  // El padre (OrthodonticsRedesignClient) nunca pasó onViewSet: el botón no hacía nada.
  assert.doesNotMatch(leer("OrthodonticsRedesignClient.tsx"), /onViewSet/);
  assert.match(fuente, /if \(props\.onViewSet\) props\.onViewSet\(p\.stage\);\s*else setJuegoAbierto\(claveDeJuego\(p\)\)/);
  assert.match(fuente, /<JuegoCompleto/);
  const juego = fuente.slice(fuente.indexOf("function JuegoCompleto"));
  // Las 10 vistas salen de PHOTO_SLOTS (3 extraorales + 7 intraorales), subidas o huecos.
  assert.match(juego, /PHOTO_SLOTS\.filter\(\(s\) => s\.group === "extraoral"\)/);
  assert.match(juego, /PHOTO_SLOTS\.filter\(\(s\) => s\.group === "intraoral"\)/);
  assert.match(juego, /<HuecoParaSubir/);
  assert.match(juego, /role="dialog"/);
  assert.match(juego, /useCajon/, "Escape cierra y el foco vuelve al botón");
});

test("juegos por etapa: la clave es el id del juego (en CONTROL hay varios con la misma etapa)", () => {
  const fuente = leer("sections/SectionPhotos.tsx");
  assert.match(fuente, /key=\{claveDeJuego\(p\)\}/);
  assert.doesNotMatch(fuente, /key=\{p\.stage\}/);
});

test("subir desde el juego completo solo si la foto caería en ESE juego", () => {
  const fuente = leer("sections/SectionPhotos.tsx");
  assert.match(fuente, /elegirSetParaFoto\(props\.historicalSets, juego\.stage\) === juego\.setId/);
  const hoy = new Date();
  const viejo = new Date(hoy.getTime() - 40 * 86_400_000).toISOString();
  const deHoy = hoy.toISOString();
  const sets = [
    { setId: "t0", stage: "T0", date: viejo },
    { setId: "c-viejo", stage: "CONTROL", date: viejo },
    { setId: "c-hoy", stage: "CONTROL", date: deHoy },
  ];
  assert.equal(elegirSetParaFoto(sets, "T0"), "t0");
  assert.equal(elegirSetParaFoto(sets, "CONTROL"), "c-hoy");
  assert.notEqual(elegirSetParaFoto(sets, "CONTROL"), "c-viejo", "un control viejo no recibe fotos de hoy");
});
