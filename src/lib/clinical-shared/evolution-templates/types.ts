// Clinical-shared — tipos para ClinicalEvolutionTemplate.

import type { ClinicalModule } from "@prisma/client";

export type { ClinicalModule };

export interface SoapTemplateBody {
  S: string;
  O: string;
  A: string;
  P: string;
}

export interface EvolutionTemplateDTO {
  id: string;
  name: string;
  module: ClinicalModule;
  soapTemplate: SoapTemplateBody;
  proceduresPrefilled: string[];
  materialsPrefilled: string[];
  isDefault: boolean;
}

/** Type guard: el campo soapTemplate viene como Json — valida shape. */
export function isSoapTemplateBody(input: unknown): input is SoapTemplateBody {
  if (!input || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.S === "string" &&
    typeof o.O === "string" &&
    typeof o.A === "string" &&
    typeof o.P === "string"
  );
}
