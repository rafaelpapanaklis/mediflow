// Implants — pre-fill del campo S-Subjetivo en SOAP cuando el paciente
// tiene implantes registrados. Spec §8.2.
//
// El doctor encuentra ya en el campo "S - Subjetivo" un resumen de
// los implantes activos al iniciar consulta. Es un assist al inicio
// del campo: el doctor puede borrar/editar libremente.

import type { ImplantStatus } from "@prisma/client";

export interface ImplantSoapEntry {
  toothFdi: number;
  brand: string;
  modelName: string;
  currentStatus: ImplantStatus;
  isqLatest: number | null;
  pdMaxLastFollowUp: number | null;
  boneLossAccumulatedMm: number | null;
  meetsAlbrektsson: boolean | null;
}

export interface ImplantSoapPrefillInput {
  implants: ImplantSoapEntry[];
  /** Si el paciente reporta una molestia, se inyecta en S. */
  patientComplaint?: string;
}

const STATUS_LABEL: Record<ImplantStatus, string> = {
  PLANNED: "planeado",
  PLACED: "colocado",
  OSSEOINTEGRATING: "en osteointegración",
  UNCOVERED: "descubierto (post-2ª cirugía)",
  LOADED_PROVISIONAL: "con prótesis provisional",
  LOADED_DEFINITIVE: "con prótesis definitiva",
  FUNCTIONAL: "en función",
  COMPLICATION: "con complicación activa",
  FAILED: "con fracaso clínico",
  REMOVED: "removido",
};

function fmtBrand(brand: string): string {
  return brand
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Genera el bloque pre-fill del S-Subjetivo. Devuelve string vacío si
 * el paciente no tiene implantes activos (estado distinto de REMOVED).
 */
export function buildImplantSoapPrefill(
  input: ImplantSoapPrefillInput,
): string {
  const active = input.implants.filter((i) => i.currentStatus !== "REMOVED");
  if (active.length === 0) return "";

  const lines: string[] = [];

  if (input.patientComplaint && input.patientComplaint.trim()) {
    lines.push(`Paciente refiere: ${input.patientComplaint.trim()}`);
  } else {
    lines.push("Paciente refiere: [molestia / sangrado / aflojamiento / aspecto estético / asintomático]");
  }
  lines.push("");

  lines.push(`Implantes activos: ${active.length}`);
  for (const i of active) {
    const parts = [
      `Implante ${i.toothFdi}: ${fmtBrand(i.brand)} ${i.modelName}, ${STATUS_LABEL[i.currentStatus]}.`,
    ];
    if (i.isqLatest !== null) parts.push(`ISQ último ${i.isqLatest}.`);
    if (i.pdMaxLastFollowUp !== null) parts.push(`PD máx ${i.pdMaxLastFollowUp} mm.`);
    if (i.boneLossAccumulatedMm !== null) {
      const ok = i.meetsAlbrektsson === false ? "excedido" : i.meetsAlbrektsson === true ? "ok" : "—";
      parts.push(`Pérdida ósea acumulada ${i.boneLossAccumulatedMm} mm (Albrektsson: ${ok}).`);
    }
    lines.push(parts.join(" "));
  }

  return ["[Implantología]", ...lines, ""].join("\n");
}
