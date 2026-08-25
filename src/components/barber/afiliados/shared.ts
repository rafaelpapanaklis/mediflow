/**
 * DaleControl BARBER — Programa de socios: DTOs y helpers PUROS.
 *
 * Client-safe a propósito (sin prisma, sin "server-only"): lo importan el
 * server (src/lib/barber/affiliates.ts, que arma estos objetos) y el cliente
 * (afiliados-screen.tsx, que los pinta). Mismo patrón que
 * @/components/barber/billing/shared.
 *
 * DINERO: los montos viajan como number YA redondeado a 2 decimales — el
 * cálculo se hizo en Decimal en el servidor (regla dura del vertical). Aquí
 * NO se calcula un peso: solo se formatea.
 */

export type BarberReferralStatusDTO = "SIGNED_UP" | "PAYING" | "CHURNED";
export type BarberCommissionStatusDTO = "PENDING" | "AVAILABLE" | "PAID";

/** Por qué el panel no puede operar. null = todo bien. */
export type BarberAffiliateBlockerDTO =
  /** Falta correr sql/barber_afiliados.sql en Supabase. */
  | "SCHEMA_MISSING"
  /** Rafael apagó el programa (barber_affiliate_config.isEnabled = false). */
  | "PROGRAM_DISABLED";

/**
 * Reglas del programa TAL COMO ESTÁN EN LA TABLA (barber_affiliate_config).
 * La UI pinta estos valores; jamás escribe un monto propio.
 */
export interface BarberAffiliateTermsDTO {
  mode: "fixed" | "pct";
  /** Monto fijo por referida que paga (mode = "fixed"). */
  fixedAmount: number;
  /** Porcentaje del plan de la referida (mode = "pct"). */
  percent: number;
  currency: string;
  recurring: boolean;
  /** Tope de meses del recurrente. 0 = sin tope. */
  maxMonths: number;
  holdDays: number;
  minPayout: number;
  termsUrl: string | null;
  /** Días que dura la atribución (la cookie). Fuente única: el servidor. */
  attributionDays: number;
}

/** Una barbería que entró por la liga. Solo datos PÚBLICOS de la referida. */
export interface BarberReferralDTO {
  id: string;
  /** Nombre de la barbería referida — es público (aparece en /b/<slug>). */
  name: string;
  /** Ciudad, también pública. NUNCA correo, teléfono ni datos de su cobro. */
  city: string | null;
  status: BarberReferralStatusDTO;
  /** ISO. Cuándo se dio de alta por la liga. */
  signedUpAt: string;
  /** ISO o null si todavía no paga. */
  firstPaidAt: string | null;
  /** Suma de lo devengado por esta referida (todos los estados). */
  earned: number;
}

/** Una comisión con su estado y, si ya se pagó, su comprobante. */
export interface BarberCommissionDTO {
  id: string;
  /** Nombre de la barbería que la generó. */
  referredName: string;
  /** "signup" o "YYYY-MM". */
  periodKey: string;
  amount: number;
  currency: string;
  status: BarberCommissionStatusDTO;
  createdAt: string;
  /** ISO. Cuándo deja de estar retenida. */
  availableAt: string;
  paidAt: string | null;
  payoutRef: string | null;
  payoutProofUrl: string | null;
}

/** Embudo de la liga: quién entró, quién se registró, quién ya paga. */
export interface BarberAffiliateFunnelDTO {
  clicks: number;
  signups: number;
  paying: number;
}

/** Lo ganado, partido por estado. */
export interface BarberAffiliateEarningsDTO {
  pending: number;
  available: number;
  paid: number;
  total: number;
  currency: string;
  /** true = `available` ya llega al mínimo de la config para pedir el pago. */
  reachesMinPayout: boolean;
  /**
   * Cuánto falta para el mínimo (0 si ya se alcanzó). Se calcula en Decimal
   * en el servidor: restar dinero en el navegador es exactamente la clase de
   * aritmética flotante que la regla del vertical prohíbe.
   */
  missingForMinPayout: number;
}

/**
 * El OTRO lado del programa: quién recomendó a ESTA barbería. No es
 * simétrico con lo de arriba — aquí la barbería es la referida, no el socio.
 */
export interface BarberIncomingReferralDTO {
  /** Nombre de quien la recomendó. null = nadie (o todavía nadie). */
  referredByName: string | null;
  /** true = sin atribución y dentro de la ventana: puede escribir un código. */
  canClaim: boolean;
}

export interface BarberAffiliateSummaryDTO {
  /** null = el panel solo puede explicar por qué no hay nada que mostrar. */
  blocker: BarberAffiliateBlockerDTO | null;
  /** Código de la liga. null si aún no se ha activado la cuenta de socio. */
  referralCode: string | null;
  /** Ruta relativa de la liga corta (el origen lo pone el navegador). */
  referralPath: string | null;
  shopName: string;
  terms: BarberAffiliateTermsDTO;
  funnel: BarberAffiliateFunnelDTO;
  earnings: BarberAffiliateEarningsDTO;
  referrals: BarberReferralDTO[];
  commissions: BarberCommissionDTO[];
  payout: { method: string | null; details: string | null };
  incoming: BarberIncomingReferralDTO;
}

// ── Helpers PUROS de formato ────────────────────────────────────────────

/** Dinero en es-MX. Sin decimales cuando el monto es entero. */
export function formatBarberMoney(amount: number, currency = "MXN"): string {
  const hasCents = Math.abs(amount % 1) > 0.001;
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    }).format(amount);
  } catch {
    return `$${amount} ${currency}`;
  }
}

/** Fecha corta y legible. Cadena vacía si viene basura (nunca "Invalid Date"). */
export function formatBarberDate(iso: string | null, locale = "es"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Frase que explica la comisión con los números DE LA TABLA. Se arma aquí y
 * no en el JSX para que no exista ni un monto escrito en un componente.
 */
export function describeBarberCommission(
  terms: BarberAffiliateTermsDTO,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const amount =
    terms.mode === "pct"
      ? t("barber.afiliados.terms.pctAmount", { percent: terms.percent })
      : formatBarberMoney(terms.fixedAmount, terms.currency);
  if (!terms.recurring) return t("barber.afiliados.terms.onetime", { amount });
  if (terms.maxMonths > 0) {
    return t("barber.afiliados.terms.recurringCapped", { amount, months: terms.maxMonths });
  }
  return t("barber.afiliados.terms.recurring", { amount });
}

/** Texto listo para WhatsApp con la liga ya puesta. */
export function buildBarberShareText(
  t: (key: string, vars?: Record<string, string | number>) => string,
  shopName: string,
  url: string,
): string {
  return t("barber.afiliados.share.whatsappText", { shop: shopName, url });
}
