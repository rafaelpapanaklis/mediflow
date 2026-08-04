"use client";

import { AlertTriangle } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import type { StripeLivePaymentMethod } from "@/lib/admin/stripe-payment-method";

/**
 * Método de pago de una clínica en /admin. Muestra DOS cosas que no significan
 * lo mismo y que el panel confundía:
 *
 *  (a) Cobro actual (Stripe) — el método que se va a cobrar en la próxima
 *      renovación. Se lee en vivo de Stripe en cada carga.
 *  (b) Capturado en el registro — los campos `paymentMethodCollected` /
 *      `paymentMethodType` / `paymentMethodLast4`, que SOLO escribe el alta y
 *      nadie vuelve a actualizar. Una clínica que se registró sin tarjeta y
 *      luego pagó por Stripe Checkout se queda en `false` para siempre, así que
 *      ese campo no puede usarse para afirmar que no hay método de pago.
 */
export interface ClinicPaymentMethodCardProps {
  /** Sin cliente en Stripe no hay cobro automático que consultar. */
  stripeCustomerId: string | null;
  /** null cuando no hay stripeCustomerId (no se consultó a Stripe). */
  live: StripeLivePaymentMethod | null;
  signup: {
    collected: boolean;
    type: string | null;
    last4: string | null;
  };
  cancelRequested: boolean;
  cancelRequestedAt: string | null;
}

const SUBHEAD_STYLE: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
  color: "var(--text-3)", marginBottom: 8,
};

/** Caja informativa sin alarma: "no sé" nunca debe verse como "no tiene". */
const NEUTRAL_BOX_STYLE: React.CSSProperties = {
  padding: 14, background: "var(--bg-elev)", border: "1px solid var(--border-soft)",
  borderRadius: 10, fontSize: 13, color: "var(--text-2)",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, padding: 14,
  background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 10,
};

const CARD_BRAND_LABEL: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

const PM_TYPE_LABEL: Record<string, string> = {
  card: "Tarjeta", sepa_debit: "Domiciliación SEPA", link: "Link",
  customer_balance: "Transferencia (SPEI)", oxxo: "OXXO", paypal: "PayPal",
};

type FoundPaymentMethod = Extract<StripeLivePaymentMethod, { state: "found" }>;

/** "Visa •••• 4242", o el tipo cuando el método no es tarjeta. */
function livePmTitle(pm: FoundPaymentMethod): string {
  if (pm.type === "card") {
    const brand = pm.brand ? CARD_BRAND_LABEL[pm.brand] ?? pm.brand : "Tarjeta";
    return `${brand} •••• ${pm.last4 ?? "••••"}`;
  }
  const label = PM_TYPE_LABEL[pm.type] ?? pm.type;
  return pm.last4 ? `${label} •••• ${pm.last4}` : label;
}

/** null si el método no vence (solo las tarjetas traen exp_month/exp_year). */
function cardExpiry(pm: FoundPaymentMethod): { label: string; expired: boolean } | null {
  if (!pm.expMonth || !pm.expYear) return null;
  const now = new Date();
  // La tarjeta sirve todo su mes de vencimiento: expira al terminarlo.
  const expired = pm.expYear < now.getFullYear()
    || (pm.expYear === now.getFullYear() && pm.expMonth < now.getMonth() + 1);
  return {
    label: `${String(pm.expMonth).padStart(2, "0")}/${String(pm.expYear).slice(-2)}`,
    expired,
  };
}

export function ClinicPaymentMethodCard({
  stripeCustomerId,
  live,
  signup,
  cancelRequested,
  cancelRequestedAt,
}: ClinicPaymentMethodCardProps) {
  // Se saca aquí para que TypeScript estreche la unión: `reason` solo existe en
  // el caso "unavailable".
  const unavailableReason = live?.state === "unavailable" ? live.reason : null;
  const found = live?.state === "found" ? live : null;
  const expiry = found ? cardExpiry(found) : null;

  return (
    <CardNew>
      <div className="form-section__title">
        Método de pago <span className="form-section__rule" />
      </div>

      {/* (a) Cobro actual — la verdad sobre la próxima renovación */}
      <div style={SUBHEAD_STYLE}>Cobro actual (Stripe)</div>
      {!stripeCustomerId ? (
        <div style={NEUTRAL_BOX_STYLE}>
          Esta clínica no tiene cliente en Stripe: no hay cobro automático configurado.
        </div>
      ) : found ? (
        <div style={ROW_STYLE}>
          <div style={{
            width: 48, height: 32, borderRadius: 4,
            background: "linear-gradient(135deg, #1a1f3a, #0d1026)",
            display: "grid", placeItems: "center",
            fontSize: 10, fontWeight: 700, color: "#a78bfa",
            flexShrink: 0,
          }}>
            {found.type === "card" ? "CARD" : "PAY"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
              {livePmTitle(found)}
              {expiry && ` · vence ${expiry.label}`}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              {found.source === "subscription"
                ? "Método por defecto de la suscripción"
                : "Método por defecto del cliente en Stripe"}
            </div>
          </div>
          {expiry?.expired
            ? <BadgeNew tone="danger" dot>Vencida</BadgeNew>
            : <BadgeNew tone="success" dot>Vigente</BadgeNew>}
        </div>
      ) : live?.state === "none" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, background: "var(--warning-soft)", border: "1px solid color-mix(in oklab, var(--warning) 25%, transparent)", borderRadius: 10 }}>
          <AlertTriangle size={16} strokeWidth={1.75} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--warning)" }}>
              Sin método de pago en Stripe
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              La próxima renovación va a fallar. Pídele al cliente que capture una tarjeta
              en el portal de facturación.
            </div>
          </div>
        </div>
      ) : (
        <div style={NEUTRAL_BOX_STYLE}>
          No se pudo consultar Stripe{unavailableReason ? ` — ${unavailableReason}.` : "."}{" "}
          Esto no significa que la clínica no tenga método de pago.
        </div>
      )}

      {/* (b) Lo que guardó el formulario de alta. No dice nada del cobro. */}
      <div style={{ ...SUBHEAD_STYLE, marginTop: 18 }}>Capturado en el registro</div>
      {signup.collected ? (
        <div style={ROW_STYLE}>
          <div style={{
            width: 48, height: 32, borderRadius: 4,
            background: signup.type === "paypal" ? "#003087"
              : signup.type === "card" ? "linear-gradient(135deg, #1a1f3a, #0d1026)"
                : "rgba(251,191,36,0.2)",
            display: "grid", placeItems: "center",
            fontSize: 10, fontWeight: 700,
            color: signup.type === "card" ? "#a78bfa"
              : signup.type === "paypal" ? "#fff"
                : "#fbbf24",
            flexShrink: 0,
          }}>
            {signup.type === "card" ? "CARD" : signup.type === "paypal" ? "PayPal" : "SPEI"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
              {signup.type === "card"
                ? `Tarjeta •••• ${signup.last4 ?? "••••"}`
                : signup.type === "paypal"
                  ? "PayPal (pendiente de vinculación)"
                  : "Transferencia bancaria"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              Lo que eligió el formulario de alta · paymentMethodCollected = true
            </div>
          </div>
          <BadgeNew tone="neutral" dot>Del alta</BadgeNew>
        </div>
      ) : (
        <div style={NEUTRAL_BOX_STYLE}>
          El formulario de alta no capturó un método de pago.
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-3)" }}>
        Este dato se escribe una sola vez, al registrarse, y no se vuelve a actualizar:
        no implica nada sobre el cobro vigente. Para eso está la fila de arriba.
      </div>

      {cancelRequested && (
        <div style={{
          marginTop: 12,
          padding: 12,
          background: "var(--danger-soft)",
          border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <AlertTriangle size={16} strokeWidth={1.75} style={{ color: "var(--danger)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)" }}>
              Cancelación solicitada
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              El cliente solicitó cancelar el {cancelRequestedAt
                ? new Date(cancelRequestedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
                : "—"}. No cobrar al terminar el trial.
            </div>
          </div>
        </div>
      )}
    </CardNew>
  );
}
