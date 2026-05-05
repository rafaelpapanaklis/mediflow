"use client";
// Endodontics — modal full-screen para firmar consentimiento informado.
// Reusa SignaturePad de pediatría. Spec §6.12, §12.3, §12.4

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import { SignaturePad } from "@/components/patient-detail/pediatrics/modals/SignaturePad";
import {
  getEndoConsentText,
  getApicalSurgeryConsentText,
} from "@/lib/legal/endoConsent";

export interface ConsentModalProps {
  open: boolean;
  onClose: () => void;
  variant: "endodontic" | "apical";
  toothFdi: number;
  treatmentType: string;
  patientFullName: string;
  guardianFullName?: string | null;
  doctorFullName: string;
  doctorMedicalLicense: string;
  clinicName: string;
  clinicCity: string;
  /** Llamada cuando el doctor presiona "Firmar" con un dataURL del SignaturePad. */
  onSign: (signatureDataUrl: string) => Promise<void> | void;
}

export function ConsentModal(props: ConsentModalProps) {
  const titleId = useId();
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const text = useMemo(() => {
    const inputs = {
      toothFdi: props.toothFdi,
      treatmentType: props.treatmentType,
      patientFullName: props.patientFullName,
      guardianFullName: props.guardianFullName ?? null,
      doctorFullName: props.doctorFullName,
      doctorMedicalLicense: props.doctorMedicalLicense,
      clinicName: props.clinicName,
      clinicCity: props.clinicCity,
    };
    return props.variant === "apical"
      ? getApicalSurgeryConsentText(inputs)
      : getEndoConsentText(inputs);
  }, [props]);

  useEffect(() => {
    if (!props.open) {
      setSignature(null);
      setSaving(false);
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [props.open, props]);

  async function submit() {
    if (!signature) {
      toast.error("Captura la firma del paciente / tutor antes de continuar");
      return;
    }
    setSaving(true);
    try {
      await props.onSign(signature);
      toast.success("Consentimiento firmado");
      props.onClose();
    } catch (e) {
      toast.error("No se pudo guardar el consentimiento");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  if (!props.open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ped-modal-overlay" role="presentation"
         onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
           className="ped-modal modal--full">
        <header className="ped-modal__header">
          <div>
            <p className="ped-modal__breadcrumb">Endodoncia · diente {props.toothFdi}</p>
            <h2 id={titleId} className="ped-modal__title">
              {props.variant === "apical"
                ? "Consentimiento de cirugía apical"
                : "Consentimiento informado endodóntico"}
            </h2>
            <p className="ped-modal__sub">
              Paciente: <strong>{props.patientFullName}</strong>
              {props.guardianFullName ? ` · Tutor: ${props.guardianFullName}` : ""}
            </p>
          </div>
          <button type="button" className="ped-modal__close" aria-label="Cerrar" onClick={props.onClose}>
            <X size={20} aria-hidden />
          </button>
        </header>
        <div className="ped-modal__body">
          <pre className="endo-consent__legal">{text}</pre>
          <SignaturePad
            onChange={setSignature}
            ariaLabel="Firma del paciente o tutor"
          />
        </div>
        <footer className="ped-modal__footer">
          <button type="button" className="pedi-btn" onClick={props.onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={submit}
            disabled={saving || !signature}
          >
            {saving ? "Firmando…" : "Firmar consentimiento"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
