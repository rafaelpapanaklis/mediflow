// Ortodoncia en el EXPEDIENTE PDF del paciente (ws1-t10, punto 12 / decisión 3 y 4).
// El caso (diagnóstico, plan, doctor, estado) y sus HOJAS DE CONTROL firmadas
// salen dentro de la sección «Planes de tratamiento» del expediente, tenga o no
// la clínica el módulo activo (NOM-004: el expediente no se oculta). Puro: sin
// Prisma ni React; el mapeo y las etiquetas se prueban en node.

export interface ExpedienteHojaControl {
  numero: number;
  /** ISO */
  fecha: string;
  fase: string;
  mes: number | null;
  /** El Plan (P) de la hoja; el SOAP completo va, para las firmadas desde el 28-sep, como nota de evolución. */
  plan: string | null;
  indicaciones: string | null;
  /** ISO — cuándo se firmó. */
  firmadaEl: string | null;
}

export interface ExpedienteOrtodoncia {
  tecnica: string;
  estado: string;
  doctor: string | null;
  /** ISO */
  inicio: string | null;
  /** ISO */
  colocacion: string | null;
  duracionMeses: number | null;
  /** ISO */
  diagnosticadoEl: string | null;
  claseAngleDerecha: string | null;
  claseAngleIzquierda: string | null;
  overbiteMm: number | null;
  overjetMm: number | null;
  resumenClinico: string | null;
  motivoDeAbandono: string | null;
  hojas: ExpedienteHojaControl[];
}

export const ESTADO_DEL_CASO: Record<string, string> = {
  PLANNED: "Planeado (sin colocar)",
  IN_PROGRESS: "En tratamiento",
  ON_HOLD: "Pausado",
  RETENTION: "En retención",
  COMPLETED: "Terminado",
  DROPPED_OUT: "Abandonó",
};

export const TECNICA: Record<string, string> = {
  METAL_BRACKETS: "Brackets metálicos",
  CERAMIC_BRACKETS: "Brackets cerámicos (estéticos)",
  SELF_LIGATING_METAL: "Brackets autoligado metálicos",
  SELF_LIGATING_CERAMIC: "Brackets autoligado cerámicos",
  LINGUAL_BRACKETS: "Brackets linguales",
  CLEAR_ALIGNERS: "Alineadores transparentes",
  HYBRID: "Técnica híbrida (brackets + alineadores)",
};

export const CLASE_ANGLE: Record<string, string> = {
  CLASS_I: "Clase I",
  CLASS_II_DIV_1: "Clase II div. 1",
  CLASS_II_DIV_2: "Clase II div. 2",
  CLASS_III: "Clase III",
  ASYMMETRIC: "Asimétrica",
};

export const FASE: Record<string, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSURE: "Cierre de espacios",
  DETAILS: "Detalles",
  FINISHING: "Finalización",
  RETENTION: "Retención",
};

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
};
const texto = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

export interface PlanCrudo {
  technique: string;
  status: string;
  startDate: Date | string | null;
  installedAt: Date | string | null;
  estimatedDurationMonths: number | null;
  droppedOutReason?: string | null;
  treatingDoctor: { firstName: string; lastName: string } | null;
  diagnosis: {
    diagnosedAt: Date | string | null;
    angleClassRight: string | null;
    angleClassLeft: string | null;
    overbiteMm: unknown;
    overjetMm: unknown;
    clinicalSummary: string | null;
  } | null;
}

export interface HojaCruda {
  cardNumber: number;
  visitDate: Date | string;
  phaseKey: string;
  monthAt: unknown;
  soapP: string | null;
  indications?: string | null;
  signedAt: Date | string | null;
}

/** Un caso del expediente a partir de lo que trae Prisma. Las hojas salen de la más vieja a la más nueva. */
export function armarCasoDeOrtodoncia(plan: PlanCrudo, hojas: readonly HojaCruda[]): ExpedienteOrtodoncia {
  return {
    tecnica: TECNICA[plan.technique] ?? plan.technique,
    estado: ESTADO_DEL_CASO[plan.status] ?? plan.status,
    doctor: plan.treatingDoctor ? `Dr/a. ${plan.treatingDoctor.firstName} ${plan.treatingDoctor.lastName}`.trim() : null,
    inicio: iso(plan.startDate),
    colocacion: iso(plan.installedAt),
    duracionMeses: plan.estimatedDurationMonths ?? null,
    diagnosticadoEl: iso(plan.diagnosis?.diagnosedAt),
    claseAngleDerecha: plan.diagnosis?.angleClassRight ? CLASE_ANGLE[plan.diagnosis.angleClassRight] ?? plan.diagnosis.angleClassRight : null,
    claseAngleIzquierda: plan.diagnosis?.angleClassLeft ? CLASE_ANGLE[plan.diagnosis.angleClassLeft] ?? plan.diagnosis.angleClassLeft : null,
    overbiteMm: num(plan.diagnosis?.overbiteMm),
    overjetMm: num(plan.diagnosis?.overjetMm),
    resumenClinico: texto(plan.diagnosis?.clinicalSummary),
    motivoDeAbandono: plan.status === "DROPPED_OUT" ? texto(plan.droppedOutReason) : null,
    hojas: [...hojas]
      .sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime() || a.cardNumber - b.cardNumber)
      .map((h) => ({
        numero: h.cardNumber,
        fecha: new Date(h.visitDate).toISOString(),
        fase: FASE[h.phaseKey] ?? h.phaseKey,
        mes: num(h.monthAt),
        plan: texto(h.soapP),
        indicaciones: texto(h.indications),
        firmadaEl: iso(h.signedAt),
      })),
  };
}
