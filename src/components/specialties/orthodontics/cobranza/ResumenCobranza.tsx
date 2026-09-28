"use client";

// Ortodoncia — Ola 0 (ws1-t1): ranura del resumen de cobranza del caso. Se
// monta en dos sitios — la ficha del paciente (junto a SectionFinance, en
// OrthodonticsRedesignClient.tsx) y el panel de la cita (vía RanuraCita, solo
// en citas de control) — para que ambos enseñen EXACTAMENTE el mismo número,
// calculado una sola vez por `cobranzaDelCaso`
// (src/lib/orthodontics/cobranza-caso.ts + cobranza-db.ts).
//
// Devuelve `null` hasta que la parte que le toca la llene — ver «MAPA DE
// PARTES» en REPORTE-ws1-t1.md (Cobro la usa en la ficha, Recepción en el
// panel de la cita y en Caja/Hoy). Nadie más monta esta ranura en un sitio
// nuevo sin pasar por ese mapa.
export interface ResumenCobranzaProps {
  treatmentPlanId: string;
}

export function ResumenCobranza(_props: ResumenCobranzaProps) {
  return null;
}
