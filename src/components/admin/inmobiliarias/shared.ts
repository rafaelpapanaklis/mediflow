/**
 * CLIENT-SAFE por contrato: sin prisma, sin "server-only". Lo importan por
 * igual los `"use client"` de /admin/inmobiliarias y las route handlers.
 * Los tipos entran con `import type` para que desaparezcan al compilar.
 *
 * 🔴 CERO PRECIOS. Todo importe llega ya calculado desde
 * `realty_plan_configs` (como string decimal, para no sumar floats aquí).
 */
import type { RealtyMode } from "@/lib/realty/types";
import { REALTY_PLAN_IDS, type RealtyPlanId } from "@/lib/realty/plan-shared";

export type AdminTone = "success" | "warning" | "danger" | "info" | "neutral";

// ── Formateo ────────────────────────────────────────────────────────────

/** Recibe PESOS (number o el string decimal de Prisma). Nunca centavos. */
export function formatMoney(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-MX").format(n);
}

const BYTES_PER_MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < BYTES_PER_MB) return `${Math.round(b / 1024)} KB`;
  const mb = b / BYTES_PER_MB;
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

export function formatQuota(mb: number): string {
  if (mb < 0) return "Sin límite";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

/** "6" o "Ilimitado" a partir del contrato -1 del vertical. */
export function formatLimit(n: number): string {
  return n < 0 ? "Ilimitado" : formatInt(n);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} días`;
  if (days < 365) return `Hace ${Math.floor(days / 30)} meses`;
  return shortDate(iso);
}

/** % de consumo, acotado a 100 para la barra (el número real puede pasarse). */
export function percentOf(used: number, quota: number): number {
  if (!Number.isFinite(quota) || quota <= 0) return 0;
  return Math.min(100, Math.round((used / quota) * 100));
}

// ── Caras (etiqueta + tono) ─────────────────────────────────────────────

export function subscriptionFace(status: string): { label: string; tone: AdminTone } {
  switch (status) {
    case "active":
    case "paid":
      return { label: "Activa", tone: "success" };
    case "trialing":
      return { label: "Cortesía", tone: "info" };
    case "past_due":
      return { label: "Pago vencido", tone: "warning" };
    case "unpaid":
      return { label: "Sin pagar", tone: "danger" };
    case "canceled":
    case "cancelled":
      return { label: "Cancelada", tone: "danger" };
    case "incomplete":
      return { label: "Pago sin terminar", tone: "warning" };
    case "incomplete_expired":
      return { label: "Pago no completado", tone: "danger" };
    case "paused":
      return { label: "En pausa", tone: "warning" };
    case "suspended":
      return { label: "Suspendida", tone: "danger" };
    case "pending_payment":
      return { label: "Sin contratar", tone: "neutral" };
    default:
      return { label: status || "—", tone: "neutral" };
  }
}

export const PLAN_TONES: Record<RealtyPlanId, AdminTone> = {
  PROPIETARIO: "neutral",
  ASESOR: "info",
  INMOBILIARIA: "success",
};

export const MODE_LABELS: Record<RealtyMode, string> = {
  AGENCY: "Inmobiliaria",
  AGENT: "Asesor",
  OWNER: "Propietario",
};

export const MANUAL_ACTION_LABELS: Record<string, string> = {
  SUSPEND: "Suspensión",
  REACTIVATE: "Reactivación",
  PLAN_CHANGE: "Cambio de plan",
  GRANT_DAYS: "Días de cortesía",
};

export const SUBSCRIPTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "active", label: "Con acceso" },
  { value: "inactive", label: "Sin acceso" },
  { value: "pending_payment", label: "Sin contratar" },
  { value: "past_due", label: "Pago vencido" },
  { value: "suspended", label: "Suspendidas" },
];

export const MODE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos los modos" },
  { value: "AGENCY", label: "Inmobiliarias" },
  { value: "AGENT", label: "Asesores" },
  { value: "OWNER", label: "Propietarios" },
];

/**
 * Opciones del filtro por plan.
 *
 * 🔴 Los NOMBRES salen de `realty_plan_configs` (llegan en `metrics.byPlan`),
 * nunca escritos aquí: si se renombra un plan en la tabla, el filtro y la
 * columna "Plan" de la misma fila dirían cosas distintas. Mientras las
 * métricas no han cargado se cae al ID, que es feo pero nunca miente.
 */
export function planFilterOptions(
  plans: ReadonlyArray<{ planId: string; name: string }> | null | undefined,
): { value: string; label: string }[] {
  const rows =
    plans && plans.length > 0
      ? plans.map((p) => ({ value: p.planId, label: p.name }))
      : REALTY_PLAN_IDS.map((id) => ({ value: id, label: id }));
  return [{ value: "", label: "Todos los planes" }, ...rows];
}
