// Orthodontics — Ola 1 (ws1-t4, Control y agenda, sep-2026), C8 del documento de alcance.
//
// "Gráfica de higiene y cooperación en el caso, y un aviso (en el panel, no WhatsApp) si empeora en
// los últimos controles". El dato ya se captura por visita en `OrthoTreatmentCard` (placa, gingivitis,
// manchas blancas — hoja de control, C2/C3 de esta misma parte); esto es solo verlo en conjunto.
// Funciones puras, sin I/O — las consume `HygieneTrendCard.tsx`.

import type {
  OrthoGingivitisLevel,
  TreatmentCardDTO,
} from "@/components/specialties/orthodontics/redesign/types";

export interface HygieneTrendPoint {
  cardId: string;
  cardNumber: number;
  visitDate: string;
  plaquePct: number | null;
  gingivitis: OrthoGingivitisLevel | null;
  whiteSpots: boolean;
  /** ¿Se registraron elásticos en esta visita? Proxy de cooperación disponible hoy por-visita. */
  hadElastics: boolean;
}

/** Orden de severidad de gingivitis, de mejor a peor — para comparar entre visitas. */
const GINGIVITIS_SEVERITY: Record<OrthoGingivitisLevel, number> = {
  AUSENTE: 0,
  LEVE: 1,
  MODERADA: 2,
  SEVERA: 3,
};

/** Solo hojas FIRMADAS (un borrador no es un dato clínico confirmado), ordenadas por fecha de visita. */
export function buildHygieneTrend(treatmentCards: readonly TreatmentCardDTO[]): HygieneTrendPoint[] {
  return treatmentCards
    .filter((c) => c.status === "SIGNED")
    .slice()
    .sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime())
    .map((c) => ({
      cardId: c.id,
      cardNumber: c.cardNumber,
      visitDate: c.visitDate,
      plaquePct: c.hygiene.plaquePct,
      gingivitis: c.hygiene.gingivitis,
      whiteSpots: c.hygiene.whiteSpots,
      hadElastics: c.elastics.length > 0,
    }));
}

export interface HygieneAlert {
  worsening: boolean;
  /** Motivos concretos, para que el aviso diga QUÉ empeoró — nunca solo "algo cambió". */
  reasons: string[];
}

/**
 * Compara el primer y el último control de la ventana (`lookback`, por defecto los últimos 3
 * firmados) para decidir si la higiene está empeorando. Necesita al menos 2 puntos en la ventana:
 * con uno solo no hay "antes/después" que comparar.
 */
export function detectHygieneWorsening(
  trend: readonly HygieneTrendPoint[],
  lookback = 3,
): HygieneAlert {
  const recent = trend.slice(-lookback);
  if (recent.length < 2) return { worsening: false, reasons: [] };

  const first = recent[0];
  const last = recent[recent.length - 1];
  const reasons: string[] = [];

  if (first.plaquePct != null && last.plaquePct != null && last.plaquePct - first.plaquePct >= 15) {
    reasons.push(`placa subió de ${first.plaquePct}% a ${last.plaquePct}%`);
  }

  const firstSeverity = first.gingivitis ? GINGIVITIS_SEVERITY[first.gingivitis] : 0;
  const lastSeverity = last.gingivitis ? GINGIVITIS_SEVERITY[last.gingivitis] : 0;
  if (lastSeverity > firstSeverity) {
    reasons.push(
      `gingivitis pasó de ${gingivitisLabel(first.gingivitis)} a ${gingivitisLabel(last.gingivitis)}`,
    );
  }

  if (!first.whiteSpots && last.whiteSpots) {
    reasons.push("aparecieron manchas blancas nuevas");
  }

  if (first.hadElastics && !last.hadElastics) {
    reasons.push("dejó de reportar uso de elásticos");
  }

  return { worsening: reasons.length > 0, reasons };
}

function gingivitisLabel(g: OrthoGingivitisLevel | null): string {
  return g ? g.toLowerCase() : "ausente";
}
