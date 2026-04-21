"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Glow } from "../landing/primitives/glow";
import { GridBg } from "../landing/primitives/grid-bg";

interface AuthShellProps {
  /** Visual panel (left). Incluye glow, logo, testimonial, mockup. */
  visual: ReactNode;
  /** Form panel (right). */
  form: ReactNode;
  /** Proporción del split — "50/50" (login) o "60/40" (signup) */
  split?: "50/50" | "60/40";
}

/**
 * Layout split-screen reutilizable para /login y /signup.
 * Aplica .landing-theme al wrapper para usar los tokens --ld-*.
 * Maneja su propio toggle dark/light persistido.
 */
export function AuthShell({ visual, form, split = "50/50" }: AuthShellProps) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("ld-theme") : null;
    if (saved === "light" || saved === "dark") setMode(saved);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.querySelector(".landing-theme")?.setAttribute("data-mode", mode);
    try { localStorage.setItem("ld-theme", mode); } catch {}
  }, [mode, mounted]);

  const leftRatio  = split === "60/40" ? "1.5fr" : "1fr";
  const rightRatio = split === "60/40" ? "1fr"   : "1fr";

  return (
    <div
      className="landing-theme auth-shell"
      data-mode={mode}
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
        {/* Theme toggle top-right */}
        <button
          type="button"
          onClick={() => setMode(m => (m === "dark" ? "light" : "dark"))}
          aria-label={mode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          style={{
            position: "absolute",
            top: 24,
            right: 28,
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--ld-border)",
            color: "var(--ld-fg)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            zIndex: 10,
          }}
        >
          {mode === "dark" ? "🌙" : "☀"}
        </button>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: split === "60/40" ? 460 : 420 }}>{form}</div>
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
