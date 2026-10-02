// H23 (QA ws1-t9) — pura, sin React ni "use server": separada de
// RanuraCita.tsx para poder probarla sin arrastrar prisma/server-only (la
// action que resuelve de verdad vive detrás de "use server").
//
// Con la Agenda cayéndose a 502 a medio vuelo, `getTreatmentPlanIdForAppointment`
// a veces resolvía `undefined` en vez de rechazar — `isFailure(res)` sobre eso
// truena (`res.ok` de un `undefined`) y se llevaba toda la ranura de la cita.
import { isFailure, type ActionResult } from "@/app/actions/orthodontics/result";

export interface RanuraCitaState {
  treatmentPlanId: string | null;
  canOpenClinicalCard: boolean;
  /** Cómo se cobra ESTE caso (decisión 2 del gerente: se elige al abrirlo). `null` = sin caso o no se sabe. */
  billingMode: "PRECIO_TOTAL" | "PAGO_POR_CONTROL" | null;
  /** Revisión final de ws1-t9 (fallo nuevo 4): el control de ESTA cita ya está firmado → «Ver control». */
  hojaFirmada: boolean;
}

export const ESTADO_VACIO_RANURA_CITA: RanuraCitaState = {
  treatmentPlanId: null,
  canOpenClinicalCard: false,
  billingMode: null,
  hojaFirmada: false,
};

export type RanuraCitaResult = ActionResult<{
  treatmentPlanId: string | null;
  canOpenClinicalCard: boolean;
  billingMode?: "PRECIO_TOTAL" | "PAGO_POR_CONTROL" | null;
  hojaFirmada?: boolean;
}>;

/** Cualquier `res` vacío o mal formado cae al estado vacío, nunca revienta. */
export function resolverEstadoRanuraCita(
  res: RanuraCitaResult | null | undefined,
): RanuraCitaState {
  if (!res || isFailure(res)) return ESTADO_VACIO_RANURA_CITA;
  return {
    treatmentPlanId: res.data.treatmentPlanId,
    canOpenClinicalCard: res.data.canOpenClinicalCard,
    billingMode: res.data.billingMode ?? null,
    hojaFirmada: res.data.hojaFirmada === true,
  };
}

/**
 * X8 — ¿la respuesta es de una llamada CAÍDA (red/502: la action resolvió
 * `undefined` o basura) y no una respuesta real del servidor? Una caída debe
 * mostrar «Reintentar»; un `fail(...)` legítimo (sin permiso, módulo apagado)
 * o `treatmentPlanId: null` (sin caso) sí se callan.
 */
export function esRespuestaCaida(res: unknown): boolean {
  if (!res || typeof res !== "object") return true;
  const ok = (res as { ok?: unknown }).ok;
  if (ok === false) return false;
  if (ok !== true) return true;
  const data = (res as { data?: unknown }).data;
  return !data || typeof data !== "object";
}
