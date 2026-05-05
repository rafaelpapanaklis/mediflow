"use client";
// Periodontics — modal full-screen para firmar el consentimiento de cirugía
// periodontal. Reusa SignaturePad de pediatría. SPEC §1.5, §10.4.

import { useState } from "react";
import { SignaturePad } from "@/components/patient-detail/pediatrics/modals/SignaturePad";
import { SURGERY_CONSENT_TEXT, labelSurgeryType } from "@/lib/periodontics/consent-texts";
import type { PeriodontalSurgeryType } from "@prisma/client";

export interface SurgeryConsentModalProps {
  surgeryType: string;
  patientName: string;
  onSign: (signatureUrl: string) => Promise<void> | void;
  onClose: () => void;
}

export function SurgeryConsentModal(props: SurgeryConsentModalProps) {
  const [signature, setSignature] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const safeType: PeriodontalSurgeryType = (
    [
      "COLGAJO_ACCESO",
      "GINGIVECTOMIA",
      "RESECTIVA_OSEA",
      "RTG",
      "INJERTO_GINGIVAL_LIBRE",
      "INJERTO_TEJIDO_CONECTIVO",
      "TUNELIZACION",
      "CORONALLY_ADVANCED_FLAP",
      "OTRO",
    ] as const
  ).includes(props.surgeryType as PeriodontalSurgeryType)
    ? (props.surgeryType as PeriodontalSurgeryType)
    : "OTRO";

  const text = SURGERY_CONSENT_TEXT(safeType)
    .replace("{patientName}", props.patientName)
    .replace(/\{doctorName\}/g, "—")
    .replace(/\{doctorLicense\}/g, "—")
    .replace("{treatedSites}", "(ver historia clínica)");

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
        <div>
          <h2 style={{ fontSize: 18, color: "var(--text-1)", margin: 0 }}>
            Consentimiento de cirugía periodontal
          </h2>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {labelSurgeryType(safeType)}
          </span>
        </div>
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
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          Firma del paciente:
        </span>
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
