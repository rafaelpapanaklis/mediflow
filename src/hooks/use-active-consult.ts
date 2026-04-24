"use client";
import { useContext } from "react";
import {
  ActiveConsultContext,
  type ActiveConsultContextValue,
} from "@/components/dashboard/active-consult-provider";

export interface ActiveConsult {
  id: string;
  patientId: string;
  patientName: string;
  patientAge?: number;
  patientGender?: "F" | "M" | "O";
  patientAlerts: {
    allergies?: string[];
    medications?: string[];
    conditions?: string[];
  };
  startedAt: Date;
}

/**
 * Hook que expone el estado de la consulta activa del usuario actual.
 * Debe usarse bajo <ActiveConsultProvider> (montado en dashboard layout).
 *
 * TODO(v2.1): multi-consulta. Por ahora v2 soporta 1 consulta activa.
 */
export function useActiveConsult(): ActiveConsultContextValue {
  const ctx = useContext(ActiveConsultContext);
  if (!ctx) {
    throw new Error(
      "useActiveConsult must be used within <ActiveConsultProvider>",
    );
  }
  return ctx;
}
