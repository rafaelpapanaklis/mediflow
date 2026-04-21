"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";

interface ClinicData {
  id: string;
  plan: string;
  trialEndsAt?: string | Date | null;
  subscriptionStatus?: string | null;
  paymentMethodCollected?: boolean;
  paymentMethodType?: string | null;
  paymentMethodLast4?: string | null;
  cancelRequested?: boolean;
  cancelRequestedAt?: string | Date | null;
}

interface Props {
  clinic: ClinicData;
}

const PLAN_PRICES: Record<string, number> = { BASIC: 49, PRO: 99, CLINIC: 249 };

function formatFecha(d: Date) {
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function SubscriptionTab({ clinic }: Props) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [localCancelRequested, setLocalCancelRequested] = useState(
    !!clinic.cancelRequested,
  );

  const trialEndsAt = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const now = new Date();

  const subscriptionActive =
    clinic.subscriptionStatus === "active" || clinic.subscriptionStatus === "paid";
  const isInTrial = !!trialEndsAt && trialEndsAt > now && !subscriptionActive;
  const trialExpired = !!trialEndsAt && trialEndsAt < now && !subscriptionActive;

  const { daysLeft, daysTotal, pct } = useMemo(() => {
    if (!trialEndsAt) return { daysLeft: 0, daysTotal: 14, pct: 0 };
    const total = 14;
    const msLeft = trialEndsAt.getTime() - now.getTime();
    const left = Math.max(0, Math.ceil(msLeft / 86_400_000));
    const used = Math.min(total, total - left);
    const percentage = Math.min(100, Math.round((used / total) * 100));
    return { daysLeft: left, daysTotal: total, pct: percentage };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trialEndsAt?.getTime()]);

  const planPrice = PLAN_PRICES[clinic.plan] ?? 0;

  async function handleRequestCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/clinic/subscription/cancel-request`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      setLocalCancelRequested(true);
      setCancelOpen(false);
      toast.success("Solicitud de cancelación registrada");
    } catch {
      toast.error("Error al registrar cancelación");
    } finally {
      setCancelling(false);
    }
  }

  const statusLabel = subscriptionActive
    ? "Suscripción activa"
    : isInTrial
      ? "Prueba gratis"
      : trialExpired
        ? "Prueba expirada"
        : "Sin suscripción";

  const statusTone = subscriptionActive
    ? { bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.3)", fg: "#34d399" }
    : isInTrial
      ? { bg: "rgba(124,58,237,0.12)", border: "rgba(124,58,237,0.3)", fg: "#a78bfa" }
      : { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", fg: "#f87171" };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Estado actual */}
      <div
        className="bg-card border border-border rounded-2xl p-6"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 6 }}>
              Estado actual
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  padding: "4px 12px",
                  borderRadius: 100,
                  background: statusTone.bg,
                  border: `1px solid ${statusTone.border}`,
                  color: statusTone.fg,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {statusLabel}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
                Plan {clinic.plan} — ${planPrice} USD/mes
              </div>
            </div>
          </div>
        </div>

        {/* Progress bar del trial */}
        {isInTrial && trialEndsAt && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
              <span style={{ color: "var(--text-2)" }}>
                {daysLeft === 0
                  ? "Termina hoy"
                  : daysLeft === 1
                    ? "1 día restante"
                    : `${daysLeft} días restantes de ${daysTotal}`}
              </span>
              <span className="font-mono" style={{ color: "var(--text-3)" }}>
                Termina el {formatFecha(trialEndsAt)}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: daysLeft <= 3
                    ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                    : "linear-gradient(90deg, #a78bfa, #7c3aed)",
                  transition: "width .4s",
                }}
              />
            </div>
          </div>
        )}

        {trialExpired && (
          <div style={{
            padding: "12px 14px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 10,
            fontSize: 13,
            color: "#fca5a5",
          }}>
            Tu prueba gratis expiró el {trialEndsAt && formatFecha(trialEndsAt)}. Activa tu suscripción para recuperar acceso.
          </div>
        )}
      </div>

      {/* Método de pago */}
      <div className="bg-card border border-border rounded-2xl p-6" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
          Método de pago
        </h2>

        {clinic.paymentMethodCollected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
            {clinic.paymentMethodType === "card" ? (
              <>
                <div style={{ width: 40, height: 26, borderRadius: 4, background: "linear-gradient(135deg, #1a1f3a, #0d1026)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#a78bfa" }}>
                  CARD
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                    Tarjeta terminada en •••• {clinic.paymentMethodLast4 ?? "••••"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    Se cobrará al terminar tu prueba
                  </div>
                </div>
              </>
            ) : clinic.paymentMethodType === "paypal" ? (
              <>
                <div style={{ width: 40, height: 26, borderRadius: 4, background: "#003087", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800, color: "#fff", letterSpacing: "0.02em" }}>
                  PayPal
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                    PayPal
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    Te contactaremos antes del fin de tu prueba para confirmar
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ width: 40, height: 26, borderRadius: 4, background: "rgba(251,191,36,0.2)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>
                  SPEI
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                    Transferencia bancaria
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    Recibirás instrucciones por correo
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ padding: 14, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, fontSize: 13, color: "#fcd34d" }}>
            No tienes un método de pago guardado. Agrega uno antes de que termine tu prueba.
          </div>
        )}

        <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.55 }}>
          Al terminar tu prueba, tu método de pago será cargado automáticamente por <strong>${planPrice} USD/mes</strong>. Si quieres cancelar o cambiar, contáctanos antes del{" "}
          {trialEndsAt && <strong style={{ color: "var(--text-2)" }}>{formatFecha(trialEndsAt)}</strong>}.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href="/signup?step=3"
            className="btn-new btn-new--secondary btn-new--sm"
            style={{ textDecoration: "none" }}
          >
            Cambiar método de pago
          </a>
          {!localCancelRequested ? (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="btn-new btn-new--ghost btn-new--sm"
              style={{ color: "var(--danger, #ef4444)" }}
            >
              Cancelar suscripción
            </button>
          ) : (
            <div style={{
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)",
              fontSize: 12,
              color: "#fca5a5",
              fontWeight: 500,
            }}>
              ⚠ Cancelación solicitada — sin cargos al terminar tu prueba
            </div>
          )}
        </div>
      </div>

      {/* Modal de confirmación de cancelación */}
      {cancelOpen && (
        <div
          onClick={() => setCancelOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "grid", placeItems: "center", padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 480, width: "100%",
              background: "var(--bg-elev, #121020)",
              border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 14,
              padding: 28,
              boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 40px rgba(239,68,68,0.15)",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-1)", marginBottom: 10 }}>
              ¿Cancelar tu suscripción?
            </h3>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55, marginBottom: 18 }}>
              No se cobrará tu método de pago al terminar tu prueba. Seguirás teniendo acceso hasta el{" "}
              <strong>{trialEndsAt && formatFecha(trialEndsAt)}</strong>. Puedes reactivar en cualquier momento.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="btn-new btn-new--ghost"
              >
                No, mantener
              </button>
              <button
                type="button"
                onClick={handleRequestCancel}
                disabled={cancelling}
                className="btn-new btn-new--danger"
              >
                {cancelling ? "Procesando…" : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
