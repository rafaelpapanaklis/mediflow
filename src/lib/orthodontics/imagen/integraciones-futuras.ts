// Ortodoncia — Parte 7/8 «Imagen y análisis» (ws1-t8, sep-2026).
//
// Puntos de integración PREPARADOS y NO contratados para H2, H6, H8, H11 y
// H13. Por instrucción de Rafael: no se contrata ningún servicio ni se
// meten llaves en esta ola. Este archivo define las interfaces que un
// futuro `getX()` implementaría al conectar un proveedor real, para que
// integrar no obligue a rediseñar los tipos que ya usan H1/H3/H5/H9/H10.
//
// - H2 · Trazado cefalométrico automático con IA (WebCeph / CephX).
// - H6 · Detección/recorte automático de fotos con IA.
// - H8 · Simulación del resultado (VTO / smile simulator).
// - H11 · Set-up digital y diseño de alineadores (lo hace el laboratorio /
//   Invisalign ClinCheck / 3Shape — no se recomienda construirlo aquí).
// - H13 · Mapa de desgastes (IPR) entre dientes: el dato YA se guarda hoy
//   por control vía `OrthoCardIprPoint` (ver ipr-map.test.ts); lo que falta
//   es solo la vista de mapa, que queda para una vuelta futura — no es una
//   integración externa, se documenta aquí junto a las demás por venir del
//   mismo bloque «DESPUÉS» del alcance.

import type { CephPoints } from "../cefalometria/landmarks";

// ─── H2 · Trazado automático (WebCeph / CephX) ───────────────────────────

export interface CephAutoTraceRequest {
  /** URL firmada de la radiografía lateral (bucket patient-files), no el binario. */
  imageUrl: string;
}

export interface CephAutoTraceResult {
  points: CephPoints;
  /** 0-1, si el proveedor lo entrega. WebCeph/CephX reportan ~80% de puntos <2mm de error. */
  confidence?: number;
  provider: "WEBCEPH" | "CEPHX";
}

export interface CephAutoTraceProvider {
  traceLateralXray(req: CephAutoTraceRequest): Promise<CephAutoTraceResult>;
}

/**
 * Sin cuenta ni llave configurada todavía → siempre null. Cuando Rafael
 * decida contratar WebCeph o CephX, esta función es el único punto que hay
 * que cambiar (leer `process.env.WEBCEPH_API_KEY` / `CEPHX_API_KEY` y
 * devolver un provider real); nada de la UI de H1 necesita tocarse, porque
 * ya funciona 100% manual y solo mostraría un botón extra "Trazar con IA"
 * cuando esto deje de ser null.
 */
export function getConfiguredCephAutoTraceProvider(): CephAutoTraceProvider | null {
  return null;
}

// ─── H6 · Detección/recorte automático de fotos con IA ───────────────────

export interface PhotoAutoDetectResult {
  /** Qué foto de la serie parece ser (frontal, perfil, oclusal...). */
  detectedSlot: string;
  /** Rectángulo de recorte sugerido, relativo 0..1 al tamaño natural. */
  suggestedCropRect?: { x: number; y: number; width: number; height: number };
  /** Puntos de H5 ya ubicados por el proveedor, si los da. */
  suggestedLandmarks?: Record<string, { x: number; y: number }>;
}

export interface PhotoAutoDetectProvider {
  detect(imageUrl: string): Promise<PhotoAutoDetectResult>;
}

export function getConfiguredPhotoAutoDetectProvider(): PhotoAutoDetectProvider | null {
  return null;
}

// ─── H8 · Simulación del resultado (VTO / smile simulator) ───────────────

export interface SmileSimulationProvider {
  simulate(input: { photoUrl: string; treatmentPlanId: string }): Promise<{ resultImageUrl: string }>;
}

export function getConfiguredSmileSimulationProvider(): SmileSimulationProvider | null {
  return null;
}

// ─── H11 · Set-up digital / diseño de alineadores ────────────────────────
//
// No se recomienda construir esto (lo hace el laboratorio o el sistema de
// alineadores). El punto de integración es simplemente ADJUNTAR el
// PDF/imágenes de ClinCheck (u otro) al caso: ya es posible hoy guardando
// esos archivos como `PatientFile` (categoría OTHER u ORTHO_PHOTO_*) y
// enlazándolos desde `OrthodonticAligner.notes` — no hace falta un modelo ni
// una integración nueva. Se deja sin código porque no hay nada que exponer
// todavía; el día que haya un proveedor concreto con API, este comentario es
// el lugar para el `interface` correspondiente.

// ─── H13 · Mapa de desgastes (IPR) entre dientes ─────────────────────────
//
// El dato por visita ya existe (`OrthoCardIprPoint`, dueño de «Control y
// agenda»). Falta solo AGREGARLO por caso y pintarlo como mapa (planeado
// del plan de tratamiento vs. hecho en las cards firmadas). No es una
// integración externa — es una vista pendiente, fuera de esta ola por
// instrucción explícita del reparto (H13 va con H2/H6/H8/H11 como "dejar
// preparado, no construir"). El día que se construya, la fuente de datos es
// un `groupBy` de `OrthoCardIprPoint` por `(toothA, toothB)` a través de
// `OrthoTreatmentCard.treatmentPlanId` — no requiere tabla nueva.
