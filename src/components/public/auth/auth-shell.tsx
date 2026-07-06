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
        background: "var(--ld-bg)",
      }}
    >
      {/* LEFT — panel de marca violeta profundo. Aquí el texto blanco SÍ es
          correcto: los tokens se re-declaran abajo scoped a .auth-shell__visual. */}
      <div
        className="auth-shell__visual"
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "40px 48px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(90% 70% at 85% -10%, rgba(167,139,250,0.35), transparent 55%), " +
            "radial-gradient(70% 60% at -10% 110%, rgba(76,29,149,0.5), transparent 60%), " +
            "linear-gradient(168deg, #221052 0%, #371a7e 55%, #5b21b6 100%)",
        }}
      >
        <Glow x="50%" y="8%" size={1000} opacity={0.4} color="139,92,246" />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at 85% 40%, rgba(52,211,153,0.08), transparent 50%)",
          }}
        />
        <GridBg opacity={0.04} />
        <div style={{ position: "relative", zIndex: 1, width: "100%" }}>{visual}</div>
      </div>

      {/* RIGHT — form sobre fondo claro suave, en tarjeta blanca */}
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
          <div
            className="auth-shell__card"
            style={{
              width: "100%",
              maxWidth: split === "45/55" ? 660 : split === "60/40" ? 520 : 464,
              background: "#ffffff",
              border: "1px solid var(--ld-border)",
              borderRadius: 20,
              padding: "36px 36px 28px",
              boxShadow: "0 10px 40px -18px rgba(15,23,42,0.18), 0 2px 8px -4px rgba(15,23,42,0.06)",
            }}
          >
            {form}
          </div>
        </div>
      </div>

      <style>{`
        /* Dentro del panel violeta los tokens vuelven a "texto claro":
           login-visual/signup-visual heredan blanco sin tocar sus archivos. */
        .auth-shell__visual {
          --ld-fg: #ffffff;
          --ld-fg-muted: rgba(255,255,255,0.75);
          --ld-border: rgba(255,255,255,0.16);
          --ld-brand-light: #c4b5fd;
        }
        @media (max-width: 1024px) {
          .auth-shell {
            grid-template-columns: 1fr !important;
          }
          /* Móvil: directo a la acción — el panel de marca se oculta y el
             form (que ya trae logo) ocupa la pantalla. */
          .auth-shell__visual {
            display: none !important;
          }
          .auth-shell__form {
            padding: 28px 16px !important;
          }
          .auth-shell__card {
            padding: 28px 20px 24px !important;
          }
        }
      `}</style>
    </div>
  );
}
