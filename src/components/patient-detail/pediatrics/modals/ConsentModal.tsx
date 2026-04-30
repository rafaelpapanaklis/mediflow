"use client";
// Pediatrics — Modal full-screen para firmar consentimientos. Spec: §1.15, §4.A.8

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import { signConsentByGuardian, signConsentByMinor, isFailure } from "@/app/actions/pediatrics";
import { SignaturePad } from "./SignaturePad";

export interface ConsentModalProps {
  open: boolean;
  onClose: () => void;
  consentId: string;
  procedureLabel: string;
  patientName: string;
  guardianName: string;
  minorAssentRequired: boolean;
}

type Tab = "guardian" | "minor";

export function ConsentModal(props: ConsentModalProps) {
  const { open, onClose, consentId, procedureLabel, patientName, guardianName, minorAssentRequired } = props;
  const [tab, setTab] = useState<Tab>("guardian");
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      setTab("guardian"); setSignature(null); setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  async function submit() {
    if (!signature) {
      toast.error("Captura la firma primero");
      return;
    }
    setSaving(true);
    const result = tab === "guardian"
      ? await signConsentByGuardian({ consentId, signatureUrl: signature })
      : await signConsentByMinor({ consentId, signatureUrl: signature });
    setSaving(false);
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Consentimiento firmado");
    onClose();
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ped-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="ped-modal modal--full">
        <header className="ped-modal__header">
          <div>
            <p className="ped-modal__breadcrumb">Consentimiento informado</p>
            <h2 id={titleId} className="ped-modal__title">{procedureLabel}</h2>
            <p className="ped-modal__sub">Paciente: <strong>{patientName}</strong> · Tutor: <strong>{guardianName}</strong></p>
          </div>
          <button type="button" className="ped-modal__close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </header>

        <div className="ped-modal__body">
          <div className="ped-consent-modal__legal">
            <p>
              Yo, <strong>{guardianName}</strong>, en mi calidad de tutor del paciente menor
              de edad <strong>{patientName}</strong>, autorizo la realización del procedimiento
              <strong> {procedureLabel.toLowerCase()}</strong> en los términos explicados por el
              odontopediatra tratante.
            </p>
            <p>
              Reconozco haber sido informado de los beneficios esperados, posibles riesgos
              y alternativas del procedimiento. Esta autorización tiene una vigencia
              de hasta 12 meses y puede ser revocada por escrito en cualquier momento.
            </p>
            {minorAssentRequired ? (
              <p className="ped-consent-modal__assent">
                Por la edad del paciente, también es necesario el asentimiento del menor
                en la pestaña correspondiente.
              </p>
            ) : null}
          </div>

          {minorAssentRequired ? (
            <div className="ped-consent-modal__tabs" role="tablist" aria-label="Firmas requeridas">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "guardian"}
                className={`pedi-pill ${tab === "guardian" ? "is-active" : ""}`}
                onClick={() => { setTab("guardian"); setSignature(null); }}
              >
                Tutor
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "minor"}
                className={`pedi-pill ${tab === "minor" ? "is-active" : ""}`}
                onClick={() => { setTab("minor"); setSignature(null); }}
              >
                Asentimiento del menor
              </button>
            </div>
          ) : null}

          <SignaturePad onChange={setSignature} ariaLabel={tab === "guardian" ? "Firma del tutor" : "Firma del menor"} />
        </div>

        <footer className="ped-modal__footer">
          <button type="button" className="pedi-btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={submit}
            disabled={!signature || saving}
          >
            {saving ? "Firmando…" : "Firmar consentimiento"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
