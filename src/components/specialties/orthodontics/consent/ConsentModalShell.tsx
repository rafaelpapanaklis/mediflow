"use client";
// Orthodontics — shell común de los 4 modales de consentimiento. SPEC §10.

import { useState } from "react";
import { X } from "lucide-react";
import { SignaturePad } from "@/components/patient-detail/pediatrics/modals/SignaturePad";

export interface ConsentModalShellProps {
  title: string;
  subtitle?: string;
  text: string;
  signerLabel: string;
  /** Si es menor con tutor, mostramos dos pads (tutor + asentimiento). */
  showSecondaryPad?: { label: string };
  onClose: () => void;
  onSign: (signatures: { primary: string; secondary?: string }) => Promise<void> | void;
  pending?: boolean;
}

export function ConsentModalShell(props: ConsentModalShellProps) {
  const [primary, setPrimary] = useState<string | null>(null);
  const [secondary, setSecondary] = useState<string | null>(null);

  const canSign = !!primary && (!props.showSecondaryPad || !!secondary);

  const submit = () => {
    if (!primary) return;
    void props.onSign({ primary, secondary: secondary ?? undefined });
  };

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "12px 20px",
          background: "var(--bg-elev)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>{props.title}</h2>
          {props.subtitle ? (
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>{props.subtitle}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Cerrar"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-2)",
            fontSize: 18,
            cursor: "pointer",
          }}
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <div
        style={{
          flex: 1,
          padding: 20,
          overflowY: "auto",
          background: "var(--bg)",
        }}
      >
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            fontSize: 12,
            color: "var(--text-1)",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {props.text}
        </pre>
      </div>

      <footer
        style={{
          padding: 16,
          background: "var(--bg-elev)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>{props.signerLabel}:</span>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: 4,
              marginTop: 4,
            }}
          >
            <SignaturePad
              width={600}
              height={130}
              onChange={setPrimary}
              ariaLabel={props.signerLabel}
            />
          </div>
        </div>

        {props.showSecondaryPad ? (
          <div>
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>
              {props.showSecondaryPad.label}:
            </span>
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: 4,
                marginTop: 4,
              }}
            >
              <SignaturePad
                width={600}
                height={130}
                onChange={setSecondary}
                ariaLabel={props.showSecondaryPad.label}
              />
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSign || props.pending}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--brand, #6366f1)",
              background: canSign ? "var(--brand, #6366f1)" : "var(--bg)",
              color: canSign ? "white" : "var(--text-3)",
              fontSize: 12,
              fontWeight: 600,
              cursor: canSign && !props.pending ? "pointer" : "not-allowed",
              opacity: props.pending ? 0.6 : 1,
            }}
          >
            {props.pending ? "Guardando..." : "Firmar"}
          </button>
        </div>
      </footer>
    </div>
  );
}
