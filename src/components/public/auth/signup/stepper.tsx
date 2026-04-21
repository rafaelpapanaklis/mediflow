"use client";

import { Fragment } from "react";

interface StepperProps {
  step: 1 | 2 | 3;
}

const STEPS: Array<{ n: 1 | 2 | 3; label: string }> = [
  { n: 1, label: "Tu cuenta" },
  { n: 2, label: "Tu clínica" },
  { n: 3, label: "Plan y pago" },
];

export function Stepper({ step }: StepperProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        width: "100%",
      }}
    >
      {STEPS.map((s, i) => {
        const state = s.n < step ? "done" : s.n === step ? "active" : "pending";
        const isActive = state === "active";
        const isDone = state === "done";

        const circleBg = isActive
          ? "linear-gradient(180deg, #8b5cf6, #7c3aed)"
          : isDone
            ? "rgba(52,211,153,0.15)"
            : "rgba(255,255,255,0.04)";

        const circleBorder = isActive
          ? "1px solid rgba(124,58,237,0.6)"
          : isDone
            ? "1px solid rgba(52,211,153,0.35)"
            : "1px solid var(--ld-border)";

        const circleColor = isActive
          ? "#fff"
          : isDone
            ? "#34d399"
            : "var(--ld-fg-muted)";

        return (
          <Fragment key={s.n}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                flex: "0 0 auto",
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 30,
                  display: "grid",
                  placeItems: "center",
                  fontFamily:
                    "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  fontSize: 12,
                  fontWeight: 600,
                  background: circleBg,
                  color: circleColor,
                  border: circleBorder,
                  boxShadow: isActive
                    ? "0 0 0 4px rgba(124,58,237,0.15)"
                    : "none",
                  transition: "all 0.25s",
                }}
              >
                {isDone ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6 L5 9 L10 3"
                      stroke="#34d399"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  s.n
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: isActive ? "var(--ld-fg)" : "var(--ld-fg-muted)",
                  fontWeight: isActive ? 500 : 400,
                  letterSpacing: "-0.005em",
                  whiteSpace: "nowrap",
                }}
              >
                {s.label}
              </div>
            </div>

            {i < STEPS.length - 1 && (
              <div
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 2,
                  margin: "0 8px",
                  marginBottom: 22,
                  borderRadius: 2,
                  position: "relative",
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      s.n < step
                        ? "linear-gradient(90deg, #34d399, #a78bfa)"
                        : "transparent",
                    transition: "all 0.3s",
                  }}
                />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
