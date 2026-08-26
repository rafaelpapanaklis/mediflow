/**
 * Etiquetas de /admin para el estado de plan — módulo PURO (sin JSX) para que
 * la prueba pueda afirmar que "/admin y el gate dicen lo mismo sobre la misma
 * clínica" sin montar React. La insignia (`PlanStatusBadge`) solo pinta esto.
 *
 * Cuatro lecturas de UNA regla (src/lib/plan-status.ts → getPlanStatus):
 *   • Al corriente  → suscripción viva (active / trialing / paid)
 *   • Cobro fallido → Stripe no pudo cobrar (past_due / unpaid) pero el
 *                     periodo con acceso no ha terminado; Stripe reintenta
 *   • Trial         → trial / cortesía vigente sin suscripción viva
 *                     (o cancelada a la que aún le queda periodo)
 *   • Vencida       → isPlanExpired: la clínica NO entra al panel
 */
import { daysUntil, type PlanStatus, type PlanStatusKind } from "@/lib/plan-status";

export type PlanBadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

export interface PlanStatusLabel {
  /** Texto corto de la insignia. */
  label: string;
  /** Explicación larga (title / ficha). */
  detail: string;
  tone: PlanBadgeTone;
}

const TONE: Record<PlanStatusKind, PlanBadgeTone> = {
  active: "success",
  past_due: "warning",
  trial: "info",
  expired: "danger",
};

function fmtDay(d: Date | null): string {
  return d ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "—";
}

function fmtLong(d: Date | null): string {
  return d ? d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "sin fecha";
}

function isCancelled(status: string | null): boolean {
  return status === "cancelled" || status === "canceled";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Etiqueta corta, detalle largo y tono a partir del estado de plan-status. */
export function planStatusLabel(status: PlanStatus, now: Date = new Date()): PlanStatusLabel {
  const days = status.daysLeft;
  const s = status.subscriptionStatus;

  if (status.kind === "active") {
    // Para quien paga, la fecha que importa es el próximo cobro (Stripe o
    // activación manual); trialEndsAt debería coincidir, pero las filas
    // anteriores al fix de la renovación pueden traerlo atrasado.
    const next = status.nextBillingDate ?? status.periodEnd;
    const nextDays = daysUntil(next, now);
    return {
      label: next && nextDays !== null && nextDays >= 0 ? `Al corriente · renueva ${fmtDay(next)}` : "Al corriente",
      detail: `Suscripción viva (${s}).${next ? ` Próximo cobro: ${fmtLong(next)}.` : ""}`,
      tone: TONE.active,
    };
  }

  if (status.kind === "past_due") {
    return {
      label: `Cobro fallido · acceso hasta ${fmtDay(status.periodEnd)}`,
      detail:
        `Stripe no pudo cobrar (${s}) y reintenta. Conserva acceso hasta el ${fmtLong(status.periodEnd)}` +
        `${days !== null ? ` (${plural(days, "día", "días")})` : ""}; si ningún reintento cobra, ese día queda vencida.`,
      tone: TONE.past_due,
    };
  }

  if (status.kind === "trial") {
    if (isCancelled(s)) {
      return {
        label: `Cancelada · ${days ?? 0}d de acceso`,
        detail: `Canceló su suscripción; conserva acceso hasta el ${fmtLong(status.periodEnd)}.`,
        tone: "neutral",
      };
    }
    return {
      label: `Trial · ${days ?? 0}d`,
      detail: `Trial o cortesía vigente hasta el ${fmtLong(status.periodEnd)}.`,
      tone: TONE.trial,
    };
  }

  // expired — el POR QUÉ sale del subscriptionStatus crudo.
  const why =
    s === "past_due" || s === "unpaid" ? "cobro fallido"
    : isCancelled(s) ? "cancelada"
    : s === null || s === "pending_payment" ? "nunca pagó"
    : s;
  const ago = days !== null ? -days : null;
  return {
    label: `Vencida · ${why}`,
    detail:
      `Sin acceso al panel desde el ${fmtLong(status.periodEnd)}` +
      `${ago !== null && ago > 0 ? ` (hace ${plural(ago, "día", "días")})` : ""}. subscriptionStatus: ${s ?? "null"}.`,
    tone: TONE.expired,
  };
}
