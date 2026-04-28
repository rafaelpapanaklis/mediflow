"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Gift, ArrowUpRight, Clock3, BellOff } from "lucide-react";
import {
  useTrialDaysLeft,
  trialPillDismissKey,
  type TrialUrgency,
} from "@/lib/trial";
import type { ClinicPlan } from "@/components/dashboard/sidebar";

export interface TrialPillProps {
  trialEndsAt: Date | string | null;
  plan: ClinicPlan;
  onUpgradeClick: () => void;
}

interface UrgencyStyle {
  bg: string;
  border: string;
  text: string;
  icon: string;
  number: string;
}

function getUrgencyStyle(u: TrialUrgency): UrgencyStyle {
  switch (u) {
    case "calm":
      return {
        bg: "var(--brand-soft)",
        border: "var(--border-brand)",
        text: "var(--text-1)",
        icon: "var(--trial-accent-calm)",
        number: "var(--trial-accent-calm)",
      };
    case "warning":
      return {
        bg: "var(--warning-soft)",
        border: "rgba(217,119,6,0.30)",
        text: "var(--text-1)",
        icon: "var(--trial-accent-warning)",
        number: "var(--trial-accent-warning)",
      };
    case "urgent":
      return {
        bg: "var(--warning-soft-strong)",
        border: "var(--warning-border-strong)",
        text: "var(--text-1)",
        icon: "var(--trial-accent-warning)",
        number: "var(--trial-accent-warning)",
      };
    case "critical":
      return {
        bg: "var(--danger-soft)",
        border: "rgba(220,38,38,0.35)",
        text: "var(--text-1)",
        icon: "var(--trial-accent-danger)",
        number: "var(--trial-accent-danger)",
      };
    default:
      return {
        bg: "transparent",
        border: "transparent",
        text: "var(--text-2)",
        icon: "var(--text-3)",
        number: "var(--text-2)",
      };
  }
}

export function TrialPill({
  trialEndsAt,
  plan,
  onUpgradeClick,
}: TrialPillProps) {
  const trial = useTrialDaysLeft(trialEndsAt);

  const [dismissed, setDismissed] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const key = trialPillDismissKey();
      if (window.sessionStorage.getItem(key) === "1") {
        setDismissed(true);
      }
    } catch {}
  }, []);

  const handleDismissToday = useCallback(() => {
    setIsDismissing(true);
    window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(trialPillDismissKey(), "1");
      } catch {}
      setDismissed(true);
      setIsDismissing(false);
    }, 180);
  }, []);

  if (trial.absent || trial.expired || dismissed) return null;

  const s = getUrgencyStyle(trial.urgency);
  const isCritical = trial.urgency === "critical";

  const triggerAriaLabel = `Prueba gratis. ${
    isCritical ? "Vence hoy o pronto" : `Quedan ${trial.days} días.`
  } Click para ver detalles.`;

  return (
    <div
      className="mf-trial-pill"
      data-urgency={trial.urgency}
      data-dismissing={isDismissing ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 28,
        paddingLeft: 10,
        paddingRight: 0,
        borderRadius: 14,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.text,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "background 0.15s, border-color 0.15s",
        overflow: "hidden",
      }}
    >
      {/* ─── LEFT: trigger del popover (label + días) ─── */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={triggerAriaLabel}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: "100%",
              padding: "0 8px 0 0",
              background: "transparent",
              border: "none",
              color: "inherit",
              fontSize: "inherit",
              fontFamily: "inherit",
              fontWeight: "inherit",
              cursor: "pointer",
            }}
          >
            <Gift size={12} style={{ color: s.icon, flexShrink: 0 }} aria-hidden />

            <span className="mf-trial-pill__label-full">
              {isCritical && trial.hours <= 24 ? (
                <>Hoy vence</>
              ) : (
                <>
                  Prueba:{" "}
                  <strong
                    style={{
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
                      fontWeight: 600,
                      color: s.number,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {trial.days}
                  </strong>{" "}
                  día{trial.days === 1 ? "" : "s"}
                </>
              )}
            </span>

            <span
              className="mf-trial-pill__label-compact"
              style={{ display: "none" }}
            >
              <strong
                style={{
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontWeight: 600,
                  color: s.number,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {trial.days}
              </strong>{" "}
              día{trial.days === 1 ? "" : "s"}
            </span>

            <span
              className="mf-trial-pill__label-min"
              style={{
                display: "none",
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                fontWeight: 600,
                color: s.number,
                fontVariantNumeric: "tabular-nums",
              }}
              aria-hidden
            >
              {trial.days}d
            </span>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            collisionPadding={12}
            style={{
              zIndex: 50,
              minWidth: 280,
              maxWidth: 320,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-strong)",
              borderRadius: 12,
              padding: 14,
              boxShadow:
                "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Gift size={16} style={{ color: s.icon }} aria-hidden />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-1)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Prueba gratis · Plan{" "}
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains-mono, monospace)",
                      fontSize: 11,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border-soft)",
                      color: "var(--text-2)",
                      fontWeight: 500,
                      marginLeft: 2,
                    }}
                  >
                    {plan}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-2)",
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Clock3 size={11} style={{ color: s.icon }} aria-hidden />
                  <span>
                    {isCritical && trial.hours <= 24
                      ? `Vence en menos de ${trial.hours} h`
                      : `Quedan ${trial.days} día${trial.days === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>
            </div>

            <p
              style={{
                fontSize: 12,
                color: "var(--text-2)",
                lineHeight: 1.55,
                margin: 0,
                marginBottom: 12,
                paddingBlock: 10,
                borderTop: "1px solid var(--border-soft)",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              {isCritical
                ? "Activa tu plan antes de que termine la prueba para no perder acceso a tus datos."
                : trial.urgency === "urgent"
                  ? "Quedan pocos días. Activa tu plan para seguir usando MediFlow sin interrupciones."
                  : "Activa tu plan cuando quieras. Al terminar la prueba se pausa el acceso."}
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <button
                type="button"
                onClick={onUpgradeClick}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: 34,
                  padding: "0 12px",
                  background: "var(--brand)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow:
                    "0 0 0 1px rgba(124,58,237,0.5), 0 4px 16px -4px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#8b5cf6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--brand)")}
              >
                <ArrowUpRight size={14} />
                Activar plan ahora
              </button>

              <Popover.Close asChild>
                <button
                  type="button"
                  onClick={handleDismissToday}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    height: 32,
                    padding: "0 12px",
                    background: "transparent",
                    color: "var(--text-2)",
                    fontSize: 12,
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-2)";
                  }}
                >
                  <BellOff size={13} />
                  Recordarme mañana
                </button>
              </Popover.Close>
            </div>

            <Popover.Arrow width={10} height={5} style={{ fill: "var(--bg-elev)" }} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Badge URGENTE — entre label y divider (solo urgent) */}
      {trial.urgency === "urgent" && (
        <span
          className="mf-trial-pill__badge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 16,
            padding: "0 5px",
            borderRadius: 4,
            background: "var(--trial-accent-warning)",
            color: "#14101F",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            marginRight: 4,
            flexShrink: 0,
          }}
          aria-hidden
        >
          Urgente
        </span>
      )}

      {/* ─── DIVIDER ─── */}
      <span
        aria-hidden
        className="mf-trial-pill__divider"
        style={{
          width: 1,
          height: 16,
          background: s.border,
          flexShrink: 0,
        }}
      />

      {/* ─── RIGHT: CTA "Activar plan" ─── */}
      <button
        type="button"
        onClick={onUpgradeClick}
        aria-label="Activar plan ahora"
        className="mf-trial-pill__cta"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          height: "100%",
          padding: "0 10px 0 8px",
          background: "transparent",
          border: "none",
          color: s.number,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <span className="mf-trial-pill__cta-label">Activar plan</span>
        <ArrowUpRight size={12} aria-hidden style={{ flexShrink: 0 }} />
      </button>
    </div>
  );
}
