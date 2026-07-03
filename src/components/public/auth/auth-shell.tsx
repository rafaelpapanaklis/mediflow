"use client";

import type { ReactNode } from "react";
import { Glow } from "../landing/primitives/glow";
import { GridBg } from "../landing/primitives/grid-bg";

interface AuthShellProps {
  /** Visual panel (left). Incluye glow, logo, testimonial, mockup. */
  visual: ReactNode;
  /** Form panel (right). */
  form: ReactNode;
  /** Proporción del split — "50/50" (login), "60/40" o "45/55" (signup) */
  split?: "50/50" | "60/40" | "45/55";
}

/**
 * Layout split-screen reutilizable para /login y /signup.
 * Aplica .landing-theme al wrapper para usar los tokens --ld-*.
 * Siempre en claro: el modo oscuro solo existe dentro del panel.
 */
export function AuthShell({ visual, form, split = "50/50" }: AuthShellProps) {
  // Proporción de columnas por split. "45/55" da más ancho al form (signup con
  // 3 planes para elegir) sin tocar "50/50" (login) ni "60/40".
  const [leftRatio, rightRatio] =
    split === "60/40" ? ["1.5fr", "1fr"] :
    split === "45/55" ? ["45fr", "55fr"] :
    ["1fr", "1fr"];

  return (
    <div
      className="landing-theme auth-shell"
      data-mode="light"
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: `${leftRatio} ${rightRatio}`,
      }}
    >
      {/* LEFT — visual */}
      <div
        className="auth-shell__visual"
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "40px 48px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          borderRight: "1px solid var(--ld-border)",
          background: "linear-gradient(180deg, #1a0b2e 0%, var(--ld-bg) 70%)",
        }}
      >
        <Glow x="50%" y="10%" size={1100} opacity={0.45} />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at 85% 40%, rgba(52,211,153,0.1), transparent 50%)",
          }}
        />
        <GridBg opacity={0.035} />
        <div style={{ position: "relative", zIndex: 1, width: "100%" }}>{visual}</div>
      </div>

      {/* RIGHT — form */}
      <div
        className="auth-shell__form"
        style={{
          position: "relative",
          padding: "40px 48px",
          display: "flex",
          flexDirection: "column",
          background: "var(--ld-bg)",
        }}
      >
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: split === "45/55" ? 600 : split === "60/40" ? 460 : 420 }}>{form}</div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .auth-shell {
            grid-template-columns: 1fr !important;
          }
          .auth-shell__visual {
            padding: 40px 24px !important;
            min-height: auto !important;
            border-right: none !important;
            border-bottom: 1px solid var(--ld-border);
          }
          .auth-shell__form {
            padding: 40px 24px !important;
          }
        }
      `}</style>
    </div>
  );
}
