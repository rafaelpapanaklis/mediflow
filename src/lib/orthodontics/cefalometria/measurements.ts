// Ortodoncia — Parte 7 (ws1-t8, sep-2026). H1: cálculo de SNA/SNB/ANB/FMA/IMPA
// a partir de los puntos marcados a mano. Puro — sin Prisma, sin React.

import { angleAtVertex, angleBetweenLines, round1 } from "../geometria-plana";
import type { CephPoints } from "./landmarks";

export interface CephMeasurements {
  /** Ángulo Silla-Nasion-A: posición anteroposterior del maxilar respecto a la base de cráneo. */
  SNA: number | null;
  /** Ángulo Silla-Nasion-B: posición anteroposterior de la mandíbula respecto a la base de cráneo. */
  SNB: number | null;
  /** SNA - SNB: relación anteroposterior entre maxilar y mandíbula (Clase I ≈ 2°). */
  ANB: number | null;
  /** Plano de Frankfort (Or-Po) vs plano mandibular (Go-Me): patrón de crecimiento facial. */
  FMA: number | null;
  /** Eje del incisivo inferior vs plano mandibular (Go-Me): inclinación dentoalveolar inferior. */
  IMPA: number | null;
}

/**
 * Cualquier punto faltante deja esa medida (y las que dependen de ella) en
 * `null` — nunca se rellena con un valor inventado. El doctor completa el
 * trazado punto por punto y ve en vivo cuáles ya se pueden calcular.
 *
 * OJO al orden de los puntos en `angleBetweenLines`: como es el ángulo entre
 * dos VECTORES dirigidos, Po→Or y Go→Me deben apuntar en el mismo sentido
 * anteroposterior (ambos hacia anterior) o el ángulo sale suplementario
 * (180 - FMA real) en vez del ángulo agudo esperado. Mismo cuidado con
 * Apex→Tip vs Go→Me en IMPA. Ver el test con puntos sintéticos para el caso
 * que expone justo esta trampa.
 */
export function computeCephMeasurements(points: CephPoints): CephMeasurements {
  const { S, N, A, B, ME, GO, OR, PO, L1_TIP, L1_APEX } = points;

  const sna = S && N && A ? angleAtVertex(N, S, A) : null;
  const snb = S && N && B ? angleAtVertex(N, S, B) : null;
  const anb = sna !== null && snb !== null ? round1(sna - snb) : null;
  const fma = OR && PO && GO && ME ? round1(angleBetweenLines(PO, OR, GO, ME)) : null;
  const impa = L1_APEX && L1_TIP && GO && ME ? round1(angleBetweenLines(L1_APEX, L1_TIP, GO, ME)) : null;

  return {
    SNA: sna !== null ? round1(sna) : null,
    SNB: snb !== null ? round1(snb) : null,
    ANB: anb,
    FMA: fma,
    IMPA: impa,
  };
}
