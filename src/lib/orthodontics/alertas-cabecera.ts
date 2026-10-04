// ─────────────────────────────────────────────────────────────────────────────
// Las alertas médicas de la cabecera del caso de ortodoncia (auditoría de uso, C-58).
//
// La cabecera de la ficha general pintaba Anticoagulantes, Embarazo, Alergia a
// penicilina, Diabetes e Hipertensión; la del caso de ortodoncia de la MISMA
// paciente solo «Alergia: Penicilina». Para ortodoncia (radiografías, TADs,
// extracciones) son justo las banderas que importan.
//
// Aquí no se inventa otra regla: se usa `construirAlertas`, la misma de la ficha
// (banderas del cuestionario + alergias, padecimientos y medicación, sin
// repetidos). Las de riesgo se enseñan TODAS; padecimientos y medicación, hasta
// cuatro (la cabecera de ortodoncia es más angosta) y el resto se cuenta.
//
// PURO: sin Prisma, sin React y sin red.
// ─────────────────────────────────────────────────────────────────────────────

import { construirAlertas, type ChipAlerta } from "@/components/dashboard/pacientes-rediseno/alertas";
import { alergiasReales } from "@/lib/alergias-reales";

export interface EntradaAlertasOrto {
  /** Banderas del último cuestionario de salud (`computeRiskFlags`). */
  riskFlags?: readonly string[] | null;
  allergies?: unknown;
  chronicConditions?: unknown;
  currentMedications?: unknown;
}

export interface AlertasDeCabeceraOrto {
  /** Banderas y alergias: todas, siempre. */
  riesgo: ChipAlerta[];
  /** Padecimientos y medicación visibles (hasta `MAX_OTRAS`). */
  otras: ChipAlerta[];
  /** Cuántos padecimientos/medicamentos no caben («+N»). */
  ocultas: number;
}

export const MAX_OTRAS = 4;

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

export function alertasDeCabeceraOrto(e: EntradaAlertasOrto): AlertasDeCabeceraOrto {
  const chips = construirAlertas({
    riskFlags: lista(e.riskFlags),
    // «N/A», «Ninguna», «Niega» no son alergias: la misma limpieza que la ficha.
    allergies: alergiasReales(e.allergies),
    chronicConditions: lista(e.chronicConditions),
    currentMedications: lista(e.currentMedications),
  });
  const riesgo = chips.filter((c) => c.esRiesgo);
  const resto = chips.filter((c) => !c.esRiesgo);
  return { riesgo, otras: resto.slice(0, MAX_OTRAS), ocultas: Math.max(0, resto.length - MAX_OTRAS) };
}
