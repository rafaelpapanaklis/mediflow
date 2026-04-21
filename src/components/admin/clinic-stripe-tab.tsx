"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, AlertTriangle, CheckCircle2, Link as LinkIcon } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";

interface Props {
  clinicId: string;
  clinicName: string;
  plan: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  /** Si `false` NO se llama a la API, se muestra card con instrucciones. */
  stripeConfigured: boolean;
  instructions: string;
}

function statusTone(status: string | null): "success" | "warning" | "danger" | "neutral" {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s === "active" || s === "trialing") return "success";
  if (s === "past_due" || s === "unpaid") return "warning";
  if (s === "canceled" || s === "incomplete_expired") return "danger";
  return "neutral";
}

export function ClinicStripeTab({ clinicId, clinicName, plan, stripeCustomerId, stripeSubscriptionId, subscriptionStatus, stripeConfigured, instructions }: Props) {
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(plan);
  const [lastCheckoutUrl, setLastCheckoutUrl] = useState<string | null>(null);

  if (!stripeConfigured) {
    return (
      <div style={{
        padding: 20,
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.3)",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={18} style={{ color: "var(--warning)" }} />
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--warning)", margin: 0 }}>
            Configurar Stripe primero
          </h3>
        </div>
        <pre style={{
          whiteSpace: "pre-wrap",
          fontSize: 12,
          color: "var(--text-2)",
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          borderRadius: 10,
          padding: 14,
          lineHeight: 1.6,
          margin: 0,
        }}>{instructions}</pre>
        <a
          href="https://vercel.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
            color: "var(--warning)",
            textDecoration: "none",
          }}
        >
          Ir a Vercel Environment Variables →
        </a>
      </div>
    );
  }

  async function createCustomer() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stripe/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const data = await res.json();
      toast.success(data.reused ? "Customer ya existente" : "Customer creado");
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  async function createSubscription() {
    setLoading(true);
    setLastCheckoutUrl(null);
    try {
      const res = await fetch("/api/admin/stripe/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, plan: selectedPlan }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const data = await res.json();
      if (data.url) {
        setLastCheckoutUrl(data.url);
        navigator.clipboard.writeText(data.url).catch(() => {});
        toast.success("Link de checkout copiado al portapapeles");
      } else {
        toast.success("Suscripción creada");
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Connection status */}
      <CardNew>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "rgba(16,185,129,0.14)",
            display: "grid", placeItems: "center",
            color: "var(--success)",
          }}>
            <CheckCircle2 size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>Stripe conectado</h3>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0 0" }}>STRIPE_SECRET_KEY está configurada.</p>
          </div>
          {subscriptionStatus && (
            <BadgeNew tone={statusTone(subscriptionStatus)} dot>{subscriptionStatus}</BadgeNew>
          )}
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 10,
        }}>
          <div style={{
            padding: 12,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
          }}>
            <div style={{
              fontSize: 10,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginBottom: 4,
            }}>Customer ID</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-1)" }}>
              {stripeCustomerId ?? <span style={{ color: "var(--text-4)" }}>— ninguno</span>}
            </div>
          </div>
          <div style={{
            padding: 12,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
          }}>
            <div style={{
              fontSize: 10,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginBottom: 4,
            }}>Subscription ID</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-1)" }}>
              {stripeSubscriptionId ?? <span style={{ color: "var(--text-4)" }}>— ninguno</span>}
            </div>
          </div>
          <div style={{
            padding: 12,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
          }}>
            <div style={{
              fontSize: 10,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginBottom: 4,
            }}>Estado suscripción</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{subscriptionStatus ?? "—"}</div>
          </div>
        </div>
      </CardNew>

      {/* Actions */}
      <CardNew>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <CreditCard size={16} style={{ color: "var(--brand)" }} />
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>Acciones</h3>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!stripeCustomerId && (
            <ButtonNew
              variant="secondary"
              onClick={createCustomer}
              disabled={loading}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {loading ? "Creando…" : `Crear Customer Stripe para ${clinicName}`}
            </ButtonNew>
          )}

          <div>
            <div style={{
              fontSize: 10,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginBottom: 6,
            }}>Plan</div>
            <div className="segment-new" role="tablist">
              {(["BASIC", "PRO", "CLINIC"] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedPlan(p)}
                  className={selectedPlan === p ? "is-active" : ""}
                  role="tab"
                  aria-selected={selectedPlan === p}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <ButtonNew
            variant="primary"
            onClick={createSubscription}
            disabled={loading}
            icon={<LinkIcon size={14} />}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading ? "Generando…" : `Generar link de checkout (${selectedPlan})`}
          </ButtonNew>

          {lastCheckoutUrl && (
            <div style={{
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              padding: 12,
              fontSize: 12,
            }}>
              <div style={{ color: "var(--text-3)", marginBottom: 4 }}>Link generado (copiado al portapapeles):</div>
              <a
                href={lastCheckoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mono"
                style={{ color: "var(--brand)", wordBreak: "break-all", textDecoration: "underline" }}
              >
                {lastCheckoutUrl}
              </a>
            </div>
          )}

          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, lineHeight: 1.6 }}>
            El link abre el Checkout de Stripe. Al completarse, el webhook{" "}
            <code className="mono" style={{
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 11,
            }}>/api/webhooks/stripe</code>{" "}
            actualiza{" "}
            <code className="mono" style={{
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 11,
            }}>subscriptionStatus</code>{" "}
            automáticamente.
          </p>
        </div>
      </CardNew>
    </div>
  );
}
