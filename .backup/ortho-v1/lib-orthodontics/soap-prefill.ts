// Orthodontics — pre-fill SOAP para visitas ortodónticas. SPEC §8.3.

import type { OrthoPaymentStatus } from "@prisma/client";
import type { OrthoPhaseKey } from "@prisma/client";
import { PHASE_LABELS } from "./kanban-helpers";

export interface OrthoSoapPrefillInput {
  patientName: string;
  monthInTreatment: number;
  technique: string;
  phaseKey: OrthoPhaseKey | null;
  paymentStatus: OrthoPaymentStatus | null;
  hygieneScore?: number | null;
  bracketsLooseFdis?: number[];
  appliancesIntact?: boolean;
}

export interface OrthoSoapPrefillOutput {
  S: string;
  O: string;
  A: string;
  P: string;
}

/**
 * Genera S/O/A/P estandarizado para anotar tras un control mensual de orto.
 * El doctor edita libremente; el helper acelera la captura inicial.
 */
export function buildOrthoSoapPrefill(input: OrthoSoapPrefillInput): OrthoSoapPrefillOutput {
  const phaseLabel = input.phaseKey ? PHASE_LABELS[input.phaseKey] : "—";
  const techniqueHuman = input.technique.replaceAll("_", " ").toLowerCase();
  const broken = input.bracketsLooseFdis && input.bracketsLooseFdis.length > 0;
  const intact = input.appliancesIntact !== false;

  const S = `${input.patientName} en mes ${input.monthInTreatment} de tratamiento con ${techniqueHuman}. Refiere [completar — dolor, molestia, asintomático, problema con bracket, pérdida de elástico].`;

  const O =
    `Aparatología ${
      intact ? "íntegra" : "con incidencias"
    }${
      broken
        ? `, brackets sueltos en FDI ${input.bracketsLooseFdis!.join(", ")}`
        : ""
    }. Higiene: ${input.hygieneScore ?? "—"}/100. Fase actual: ${phaseLabel}.`;

  const paymentSuffix =
    input.paymentStatus === "ON_TIME"
      ? "al corriente"
      : input.paymentStatus === "LIGHT_DELAY"
        ? "con atraso leve"
        : input.paymentStatus === "SEVERE_DELAY"
          ? "con atraso severo"
          : input.paymentStatus === "PAID_IN_FULL"
            ? "pagado en su totalidad"
            : "—";
  const A = `Tratamiento progresando en fase ${phaseLabel}. Adeudo financiero: ${paymentSuffix}.`;

  const remindCollect =
    input.paymentStatus === "LIGHT_DELAY" || input.paymentStatus === "SEVERE_DELAY"
      ? " Recordar regularización del plan de pagos."
      : "";
  const P = `Próxima cita en 4 semanas. Ajustes: [completar].${remindCollect}`;

  return { S, O, A, P };
}
