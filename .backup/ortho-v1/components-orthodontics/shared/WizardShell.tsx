"use client";
// Orthodontics — shell común para los wizards (modal full-screen + stepper).

import { X } from "lucide-react";

export interface WizardShellProps {
  title: string;
  subtitle?: string;
  step: number;
  totalSteps: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSubmit?: () => void;
  pending?: boolean;
  canProceed?: boolean;
  width?: string;
  children: React.ReactNode;
}

export function WizardShell(props: WizardShellProps) {
  const isLast = props.step === props.totalSteps;
  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 1500,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: props.width ?? "80vw",
          maxWidth: 960,
          maxHeight: "100%",
          background: "var(--bg)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>{props.title}</h2>
            {props.subtitle ? (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>{props.subtitle}</span>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              Paso {props.step} de {props.totalSteps}
            </span>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Cerrar"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-2)",
                cursor: "pointer",
                padding: 4,
              }}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            padding: 18,
            overflowY: "auto",
            background: "var(--bg)",
          }}
        >
          {props.children}
        </div>

        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-elev)",
          }}
        >
          <button
            type="button"
            onClick={props.onPrev}
            disabled={props.step <= 1}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              fontSize: 12,
              cursor: props.step <= 1 ? "not-allowed" : "pointer",
              opacity: props.step <= 1 ? 0.5 : 1,
            }}
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={isLast ? props.onSubmit : props.onNext}
            disabled={props.pending || props.canProceed === false}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--brand, #6366f1)",
              background: "var(--brand, #6366f1)",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: props.pending ? "wait" : "pointer",
              opacity:
                props.pending || props.canProceed === false ? 0.6 : 1,
            }}
          >
            {props.pending ? "Guardando..." : isLast ? "Guardar" : "Siguiente"}
          </button>
        </footer>
      </div>
    </div>
  );
}
