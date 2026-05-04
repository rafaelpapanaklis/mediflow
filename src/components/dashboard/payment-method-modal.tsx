"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  CreditCard,
  Building2,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { PlanId } from "@/lib/billing/plans";

const BANK_INFO = {
  nombre: "Efthymios Rafail Papanaklis",
  clabe: "012910015008025244",
  banco: "BBVA",
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Plan actual de la clínica — se usa para checkout si no hay customer Stripe. */
  currentPlan: PlanId;
  /** True si la clínica ya tiene `stripeCustomerId`. Decide entre Customer Portal y Checkout. */
  hasStripeCustomer: boolean;
  /** Link público de PayPal Business para el plan actual (env NEXT_PUBLIC_PAYPAL_LINK_*). null = no configurado. */
  paypalUrl: string | null;
}

export function PaymentMethodModal({
  open,
  onClose,
  currentPlan,
  hasStripeCustomer,
  paypalUrl,
}: Props) {
  const [pending, setPending] = useState<"stripe" | null>(null);
  const [showSpei, setShowSpei] = useState(false);

  // Cierre con Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset interno al cerrar.
  useEffect(() => {
    if (!open) {
      setShowSpei(false);
      setPending(null);
    }
  }, [open]);

  if (!open) return null;

  async function handleStripe() {
    if (pending) return;
    setPending("stripe");
    try {
      // Si la clínica ya tiene customer en Stripe, abrimos el Customer
      // Portal (gestiona método, ve facturas, puede cancelar). Si no
      // tiene, primero hay que pasar por checkout para crear el customer
      // y la suscripción.
      const endpoint = hasStripeCustomer ? "/api/billing/portal" : "/api/billing/checkout";
      const body = hasStripeCustomer ? undefined : JSON.stringify({ plan: currentPlan });
      const res = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.message ?? data.error ?? "No se pudo abrir Stripe");
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error con Stripe");
      setPending(null);
    }
  }

  function handlePaypal() {
    if (!paypalUrl) return;
    window.open(paypalUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-method-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl shadow-2xl"
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          color: "var(--text-1)",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-soft, hsl(var(--border)))",
          }}
        >
          <h2 id="payment-method-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Cambiar método de pago
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              background: "transparent",
              border: 0,
              borderRadius: 8,
              cursor: "pointer",
              color: "var(--text-3)",
            }}
          >
            <X size={16} />
          </button>
        </header>

        {/* Cards verticales con las 3 opciones */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 20 }}>
          {/* Tarjeta */}
          <OptionCard
            icon={<CreditCard size={20} aria-hidden />}
            iconBg="rgba(124,58,237,0.15)"
            iconColor="var(--brand)"
            title="Tarjeta crédito/débito"
            subtitle="Pago automático mensual con tarjeta"
            actionLabel={pending === "stripe" ? "Abriendo…" : hasStripeCustomer ? "Gestionar" : "Configurar"}
            actionIcon={pending === "stripe" ? <Loader2 size={14} className="animate-spin" /> : null}
            onAction={handleStripe}
            disabled={pending !== null}
          />

          {/* PayPal */}
          <OptionCard
            icon={
              <span
                aria-hidden
                style={{
                  fontWeight: 800,
                  fontSize: 16,
                  color: "#003087",
                }}
              >
                PP
              </span>
            }
            iconBg="#FFC439"
            iconColor="#003087"
            title="PayPal"
            subtitle={paypalUrl ? "Pago automático mensual con PayPal" : "Próximamente — contacta a soporte"}
            actionLabel={paypalUrl ? "Activar" : "No disponible"}
            onAction={handlePaypal}
            disabled={!paypalUrl}
          />

          {/* SPEI */}
          <div
            className="bg-card border border-border rounded-xl"
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "rgba(245, 158, 11, 0.15)",
                  display: "grid",
                  placeItems: "center",
                  color: "rgb(245, 158, 11)",
                  flexShrink: 0,
                }}
              >
                <Building2 size={20} aria-hidden />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Transferencia bancaria / SPEI</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>Pago manual con confirmación 24h</div>
              </div>
              <button
                type="button"
                onClick={() => setShowSpei((v) => !v)}
                aria-expanded={showSpei}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid var(--border-soft, hsl(var(--border)))",
                  color: "var(--text-1)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {showSpei ? "Ocultar" : "Ver datos bancarios"}
                {showSpei ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
            {showSpei && (
              <div
                style={{
                  background: "rgba(245, 158, 11, 0.06)",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                  borderRadius: 10,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <Field label="Beneficiario" value={BANK_INFO.nombre} />
                <Field label="CLABE" value={BANK_INFO.clabe} mono />
                <Field label="Banco" value={BANK_INFO.banco} />
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                  En el concepto de tu transferencia escribe el nombre de tu
                  clínica. Tras confirmar el pago tu acceso se reactiva en
                  máximo 24 horas hábiles.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface OptionCardProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  actionIcon?: React.ReactNode;
  onAction: () => void;
  disabled?: boolean;
}

function OptionCard({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  actionLabel,
  actionIcon,
  onAction,
  disabled,
}: OptionCardProps) {
  return (
    <div
      className="bg-card border border-border rounded-xl"
      style={{
        padding: 16,
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: iconBg,
          display: "grid",
          placeItems: "center",
          color: iconColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{subtitle}</div>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 8,
          background: disabled ? "hsl(var(--muted))" : "var(--brand)",
          border: 0,
          color: disabled ? "hsl(var(--muted-foreground))" : "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {actionIcon}
        {actionLabel}
      </button>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-1)",
          fontFamily: mono ? "var(--font-jetbrains-mono, monospace)" : undefined,
          letterSpacing: mono ? 1 : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
