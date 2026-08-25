// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — piezas CLIENT-SAFE de la sección /admin/barberias.
//
// Sin imports de servidor (ni prisma, ni "server-only"): lo consumen por
// igual los componentes "use client" y las route handlers. Los tipos de
// datos viven en src/lib/barber/admin.ts y se importan con `import type`,
// que desaparece en compilación y no arrastra el módulo server.
//
// Terminología del vertical: cliente / barbero / barbería / servicio.
// ═══════════════════════════════════════════════════════════════════════

import type { BarberTicketPriority, BarberTicketStatus } from "@/lib/barber/types";

export type AdminTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

// ── Estado de suscripción ───────────────────────────────────────────────

export interface SubscriptionFace {
  label: string;
  tone: AdminTone;
}

/**
 * `subscriptionStatus` (Stripe o manual) → la cara que ve Rafael.
 * "suspended" es el valor que escribe la suspensión manual del panel; se
 * distingue a propósito de `past_due` para no confundir un impago con una
 * decisión nuestra.
 */
export function subscriptionFace(status: string | null | undefined): SubscriptionFace {
  switch (status) {
    case "active":
    case "paid":
      return { label: "Activa", tone: "success" };
    case "trialing":
      return { label: "En prueba", tone: "info" };
    case "pending_payment":
      return { label: "Sin pagar", tone: "warning" };
    case "incomplete":
      return { label: "Pago incompleto", tone: "warning" };
    case "past_due":
      return { label: "Pago vencido", tone: "danger" };
    case "unpaid":
      return { label: "Sin pago", tone: "danger" };
    case "suspended":
      return { label: "Suspendida por DaleControl", tone: "danger" };
    case "paused":
      return { label: "En pausa", tone: "neutral" };
    case "canceled":
    case "cancelled":
      return { label: "Cancelada", tone: "neutral" };
    case "incomplete_expired":
      return { label: "Alta abandonada", tone: "neutral" };
    default:
      return { label: status || "Sin estado", tone: "neutral" };
  }
}

/** Filtros de estado de la lista (el valor viaja tal cual al API). */
export const SUBSCRIPTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "active", label: "Con suscripción activa" },
  { value: "inactive", label: "Sin suscripción activa" },
  { value: "trialing", label: "En prueba" },
  { value: "pending_payment", label: "Sin pagar" },
  { value: "past_due", label: "Pago vencido" },
  { value: "suspended", label: "Suspendidas" },
  { value: "canceled", label: "Canceladas" },
];

export const SCOPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Todas las sedes" },
  { value: "parents", label: "Solo matrices" },
  { value: "branches", label: "Solo sucursales" },
];

export const PLAN_TONES: Record<string, AdminTone> = {
  BASICO: "neutral",
  AVANZADO: "info",
  PROFESIONAL: "brand",
};

// ── Tickets ─────────────────────────────────────────────────────────────

export const TICKET_STATUS_FACE: Record<BarberTicketStatus, SubscriptionFace> = {
  OPEN: { label: "Abierto", tone: "brand" },
  IN_PROGRESS: { label: "En curso", tone: "info" },
  WAITING_REPLY: { label: "Esperando a la barbería", tone: "warning" },
  CLOSED: { label: "Cerrado", tone: "neutral" },
};

export const TICKET_PRIORITY_FACE: Record<BarberTicketPriority, SubscriptionFace> = {
  LOW: { label: "Baja", tone: "neutral" },
  NORMAL: { label: "Normal", tone: "info" },
  HIGH: { label: "Alta", tone: "danger" },
};

/** "OPEN" es pseudo-valor del API: todos los que no están cerrados. */
export const TICKET_STATUS_SEGMENTS: { value: string; label: string }[] = [
  { value: "OPEN", label: "Abiertos" },
  { value: "", label: "Todos" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "WAITING_REPLY", label: "Esperando barbería" },
  { value: "CLOSED", label: "Cerrados" },
];

// ── Adjuntos de la respuesta de soporte ─────────────────────────────────
// Mismos topes que el soporte del dental. Se validan también server-side.

export const BARBER_SUPPORT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export const BARBER_SUPPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const BARBER_SUPPORT_MAX_FILES = 5;
export const BARBER_SUPPORT_ACCEPT = BARBER_SUPPORT_ALLOWED_MIME.join(",");

// ── Acciones manuales ───────────────────────────────────────────────────

export const MANUAL_ACTION_LABELS: Record<string, string> = {
  SUSPEND: "Suspensión",
  REACTIVATE: "Reactivación",
  PLAN_CHANGE: "Cambio de plan",
};

// ── Formato ─────────────────────────────────────────────────────────────

/**
 * Dinero para PINTAR. El cálculo vive en Decimal del lado del server y
 * llega aquí como string decimal ("1497.00"); esta función sólo le pone
 * formato es-MX y es el único punto donde el importe pasa por `Number`.
 */
export function formatMoney(decimalString: string | number, currency = "MXN"): string {
  const n = typeof decimalString === "number" ? decimalString : Number(decimalString);
  if (!Number.isFinite(n)) return "—";
  const hasCents = Math.abs(n % 1) > 0.001;
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    }).format(n);
  } catch {
    return `$${n} ${currency}`;
  }
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}

/** "08 jun" (con año si no es el actual). */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "2-digit";
  return d.toLocaleDateString("es-MX", opts);
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });
}

/** "hace 3 días" / "hoy" a partir de un ISO. */
export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "Sin actividad";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sin actividad";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  return `Hace ${years} ${years === 1 ? "año" : "años"}`;
}

/** Cuota del plan: -1 = ilimitado (el valor vive en barber_plan_configs). */
export function formatQuota(quota: number): string {
  return quota < 0 ? "Ilimitados" : formatInt(quota);
}

export function formatBytes(n: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
