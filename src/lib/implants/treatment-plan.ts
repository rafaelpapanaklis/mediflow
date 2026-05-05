// Implants — sub-ítems para el plan de tratamiento general. Spec §8.3.
//
// Convierte un Implant en una secuencia ordenada de pasos clínicos
// con dependencias temporales para que el sistema de TreatmentPlan
// pueda renderizarlos como fases con countdown.

import type { ImplantProtocol } from "@prisma/client";

export interface TreatmentPlanItem {
  /** Orden cronológico empezando en 1. */
  sequence: number;
  /** Etiqueta visible en el plan. */
  label: string;
  /** Tag de área — el sistema de Plan filtra por esto. */
  area: "implantology";
  /** Días esperados desde el inicio del plan (cumulativo). */
  daysOffset: number;
  /** Duración estimada del paso (días). null = puntual. */
  expectedDurationDays: number | null;
  /** Si depende del paso anterior (la mayoría sí). */
  blockedByPrevious: boolean;
  /** Notas / instrucciones inline. */
  notes?: string;
}

/**
 * Plan estándar para 1 implante (single-tooth). Spec §8.3.
 *
 * Cronograma típico: Planeación (día 0) → Cirugía (día 7-14) →
 * Osteointegración (8-12 sem según densidad — 10 default) → Prótesis
 * (3-4 sem) → Mantenimiento de por vida cada 6m.
 *
 * Para `protocol = TWO_STAGE` se inserta el paso "Descubrimiento 2ª
 * cirugía" entre osteointegración y prótesis.
 *
 * `osseointegrationWeeks` puede precisarse usando
 * `osseointegrationWeeksFor(boneDensity)` del helper lekholm-zarb
 * cuando el SurgicalRecord ya existe.
 */
export function buildSingleImplantPlan(args: {
  protocol: ImplantProtocol;
  osseointegrationWeeks?: number;
}): TreatmentPlanItem[] {
  const isTwoStage = args.protocol === "TWO_STAGE";
  const isImmediateLoading =
    args.protocol === "IMMEDIATE_PLACEMENT_IMMEDIATE_LOADING" ||
    args.protocol === "DELAYED_PLACEMENT_IMMEDIATE_LOADING";
  const osseoWeeks = args.osseointegrationWeeks ?? (isTwoStage ? 12 : 8);
  const osseoDays = osseoWeeks * 7;

  const items: TreatmentPlanItem[] = [];
  let cumDays = 0;

  items.push({
    sequence: 1,
    label: "Consulta de planeación implantológica + estudios",
    area: "implantology",
    daysOffset: cumDays,
    expectedDurationDays: null,
    blockedByPrevious: false,
    notes: "Incluye CBCT cuando aplica. Aviso de privacidad LFPDPPP firmado.",
  });

  cumDays += 14; // ~2 sem desde planeación a cirugía
  items.push({
    sequence: 2,
    label: "Cirugía de colocación + instrucciones post-operatorias",
    area: "implantology",
    daysOffset: cumDays,
    expectedDurationDays: null,
    blockedByPrevious: true,
    notes: "Profilaxis antibiótica + receta post-quirúrgica + retiro de suturas a 7 días.",
  });

  if (!isImmediateLoading) {
    items.push({
      sequence: items.length + 1,
      label: "Periodo de osteointegración",
      area: "implantology",
      daysOffset: cumDays,
      expectedDurationDays: osseoDays,
      blockedByPrevious: true,
      notes: `${osseoWeeks} semanas según densidad ósea Lekholm-Zarb.`,
    });
    cumDays += osseoDays;
  }

  if (isTwoStage) {
    items.push({
      sequence: items.length + 1,
      label: "Descubrimiento 2ª fase quirúrgica",
      area: "implantology",
      daysOffset: cumDays,
      expectedDurationDays: null,
      blockedByPrevious: true,
      notes: "Cambio a pilar de cicatrización — lote COFEPRIS obligatorio.",
    });
    cumDays += 14; // 2 sem cicatrización tejido blando
  }

  items.push({
    sequence: items.length + 1,
    label: "Toma de impresión y diseño de prótesis",
    area: "implantology",
    daysOffset: cumDays,
    expectedDurationDays: null,
    blockedByPrevious: true,
  });

  cumDays += 14;
  items.push({
    sequence: items.length + 1,
    label: "Prueba de prótesis y ajustes",
    area: "implantology",
    daysOffset: cumDays,
    expectedDurationDays: null,
    blockedByPrevious: true,
  });

  cumDays += 7;
  items.push({
    sequence: items.length + 1,
    label: "Colocación final + entrega del carnet del implante",
    area: "implantology",
    daysOffset: cumDays,
    expectedDurationDays: null,
    blockedByPrevious: true,
    notes: "Carnet PDF horizontal landscape generado automáticamente.",
  });

  cumDays += 180;
  items.push({
    sequence: items.length + 1,
    label: "Control de mantenimiento periimplantario (6 m)",
    area: "implantology",
    daysOffset: cumDays,
    expectedDurationDays: null,
    blockedByPrevious: true,
    notes: "Recall cada 6 meses de por vida + radiográfico 6/12/24 m.",
  });

  return items;
}

/**
 * Plan All-on-4: agrupa los 4 implantes en un solo workflow. Spec
 * §7.2. La cirugía única reemplaza los 4 pasos individuales de
 * cirugía. Carga inmediata 24h. Definitiva a 4 meses.
 */
export function buildAllOnFourPlan(): TreatmentPlanItem[] {
  let cum = 0;
  const items: TreatmentPlanItem[] = [];

  items.push({
    sequence: 1,
    label: "Consulta de planeación All-on-4 + CBCT + diseño protésico",
    area: "implantology",
    daysOffset: cum,
    expectedDurationDays: null,
    blockedByPrevious: false,
  });

  cum += 21;
  items.push({
    sequence: 2,
    label: "Cirugía única — 4 implantes (axiales + inclinados)",
    area: "implantology",
    daysOffset: cum,
    expectedDurationDays: null,
    blockedByPrevious: true,
    notes: "240 min. Carga inmediata con prótesis acrílica provisional <24h.",
  });

  cum += 1;
  items.push({
    sequence: 3,
    label: "Entrega de prótesis provisional acrílica",
    area: "implantology",
    daysOffset: cum,
    expectedDurationDays: null,
    blockedByPrevious: true,
  });

  cum += 120;
  items.push({
    sequence: 4,
    label: "Toma de impresión para prótesis definitiva",
    area: "implantology",
    daysOffset: cum,
    expectedDurationDays: null,
    blockedByPrevious: true,
    notes: "A los 4 meses de la cirugía.",
  });

  cum += 21;
  items.push({
    sequence: 5,
    label: "Entrega de prótesis definitiva titanio-acrílico",
    area: "implantology",
    daysOffset: cum,
    expectedDurationDays: null,
    blockedByPrevious: true,
    notes: "Carnets de los 4 implantes generados agrupados.",
  });

  cum += 180;
  items.push({
    sequence: 6,
    label: "Control de mantenimiento All-on-4 (cada 6 m)",
    area: "implantology",
    daysOffset: cum,
    expectedDurationDays: null,
    blockedByPrevious: true,
    notes: "Higiene + revisión de tornillos + radiográfico anual.",
  });

  return items;
}
