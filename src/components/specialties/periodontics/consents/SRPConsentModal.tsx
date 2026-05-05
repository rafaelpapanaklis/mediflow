"use client";
// Periodontics — modal full-screen para firmar el consentimiento de SRP.
// Reusa SignaturePad de pediatría. SPEC §1.5, §10.3.

import { useState } from "react";
import { SignaturePad } from "@/components/patient-detail/pediatrics/modals/SignaturePad";
import { SRP_CONSENT_TEXT } from "@/lib/periodontics/consent-texts";

export interface SRPConsentModalProps {
  patientName: string;
  patientAddress?: string;
  doctorName?: string;
  doctorLicense?: string;
  scope?: string;
  classification?: string;
  onSign: (signatureUrl: string) => Promise<void> | void;
  onClose: () => void;
}

export function SRPConsentModal(props: SRPConsentModalProps) {
  const [signature, setSignature] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const text = SRP_CONSENT_TEXT
    .replace("{patientName}", props.patientName)
    .replace("{patientAddress}", props.patientAddress ?? "—")
    .replace(/\{doctorName\}/g, props.doctorName ?? "—")
    .replace(/\{doctorLicense\}/g, props.doctorLicense ?? "—")
    .replace("{scope}", props.scope ?? "boca completa")
    .replace("{classification}", props.classification ?? "—");

  const submit = async () => {
    if (!signature) return;
    setPending(true);
    try {
      await props.onSign(signature);
    } finally {
      setPending(false);
    }
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
          background: "var(--bg-elev, #11151c)",
          borderBottom: "1px solid var(--border, #1f2937)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ fontSize: 18, color: "var(--text-1)", margin: 0 }}>
          Consentimiento de raspado y alisado radicular
        </h2>
        <button
          type="button"
          onClick={props.onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-2)",
            fontSize: 18,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </header>

      <div
        style={{
          flex: 1,
          padding: 20,
          overflowY: "auto",
          background: "var(--bg, #0b0d11)",
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
          {text}
        </pre>
      </div>

      <footer
        style={{
          padding: "16px 20px",
          background: "var(--bg-elev, #11151c)",
          borderTop: "1px solid var(--border, #1f2937)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>Firma del paciente:</span>
        <div
          style={{
            background: "var(--bg, #0b0d11)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 4,
          }}
        >
          <SignaturePad
            width={600}
            height={150}
            onChange={setSignature}
            ariaLabel="Firma del paciente"
          />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!signature || pending}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 4,
              border: "1px solid var(--brand)",
              background: signature ? "var(--brand)" : "var(--bg)",
              color: signature ? "white" : "var(--text-3)",
              cursor: signature && !pending ? "pointer" : "not-allowed",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "Guardando..." : "Firmar consentimiento"}
          </button>
        </div>
      </footer>
    </div>
  );
}
