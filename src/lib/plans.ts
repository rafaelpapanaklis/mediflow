export type PlanId = "BASIC" | "PRO" | "CLINIC";

export interface PlanLimits {
  /** Bytes de storage permitidos para archivos de pacientes */
  storageBytes: number;
  /** Tokens IA por mes (refleja el default de Clinic.aiTokensLimit) */
  aiTokensDefault: number;
  /** WhatsApps salientes por mes estimados para el plan */
  whatsappMonthly: number;
  /** Precio mensual en MXN */
  monthlyPrice: number;
  label: string;
}

const GB = 1024 ** 3;

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  BASIC:  { storageBytes: 1  * GB, aiTokensDefault:  50_000, whatsappMonthly: 200,  monthlyPrice:  49, label: "Básico" },
  PRO:    { storageBytes: 10 * GB, aiTokensDefault: 200_000, whatsappMonthly: 1000, monthlyPrice:  99, label: "Profesional" },
  CLINIC: { storageBytes: 100 * GB, aiTokensDefault: 1_000_000, whatsappMonthly: 5000, monthlyPrice: 249, label: "Clínica" },
};

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  if (plan && plan in PLAN_LIMITS) return PLAN_LIMITS[plan as PlanId];
  return PLAN_LIMITS.PRO;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
