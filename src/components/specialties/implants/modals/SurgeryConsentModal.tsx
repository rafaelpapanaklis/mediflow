"use client";
// Implants — modal full-screen para consentimiento informado quirúrgico.
// Reusa SignaturePad del módulo Pediatría. Texto exacto en
// SURGERY_CONSENT_TEXT (src/lib/implants/consent-texts.ts). Spec §10.4.

import { useEffect, useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, FileSignature } from "lucide-react";
import { SignaturePad } from "@/components/patient-detail/pediatrics/modals/SignaturePad";
import { SURGERY_CONSENT_TEXT } from "@/lib/implants/consent-texts";
import { createImplantConsent } from "@/app/actions/implants/createImplantConsent";
import { isFailure } from "@/app/actions/implants/result";

export interface SurgeryConsentModalProps {
  open: boolean;
  implantId: string | null;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  doctorCedula: string | null;
  onClose: () => void;
  onSigned?: () => void;
}

export function SurgeryConsentModal(props: SurgeryConsentModalProps) {
  const [signature, setSignature] = useState<string | null>(null);
  const [acceptedRisks, setAcceptedRisks] = useState({
    surgical: false,
    biological: false,
    mechanical: false,
    mronj: false,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      setSignature(null);
      setAcceptedRisks({ surgical: false, biological: false, mechanical: false, mronj: false });
      setError(null);
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

  if (!props.open || !props.implantId) return null;

  const allAccepted = Object.values(acceptedRisks).every(Boolean);

  const renderedText = SURGERY_CONSENT_TEXT
    .replace("{nombre}", props.patientName)
    .replace("{doctor}", props.doctorName)
    .replace("{cedula}", props.doctorCedula ?? "—");

  const submit = () => {
    setError(null);
    if (!allAccepted) {
      setError("Marca todas las casillas de aceptación de riesgos");
      return;
    }
    if (!signature) {
      setError("Falta la firma del paciente");
      return;
    }
    startTransition(async () => {
      const r = await createImplantConsent({
        implantId: props.implantId!,
        patientId: props.patientId,
        doctorId: props.doctorId,
        consentType: "SURGERY",
        text: renderedText,
        acceptedRisks,
        signedAt: new Date(),
        patientSignatureImage: signature,
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success("Consentimiento firmado y registrado");
      props.onSigned?.();
      props.onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 p-2" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl m-auto max-w-3xl w-full max-h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-blue-600" /> Consentimiento informado quirúrgico
          </h2>
          <button onClick={props.onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/40 p-4 rounded border border-gray-200 dark:border-gray-700">
            {renderedText}
          </pre>

          <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2 text-xs">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              He leído y acepto los siguientes riesgos:
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={acceptedRisks.surgical} onChange={(e) => setAcceptedRisks({ ...acceptedRisks, surgical: e.target.checked })} />
              Riesgos quirúrgicos (parestesia, perforación seno, hemorragia)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={acceptedRisks.biological} onChange={(e) => setAcceptedRisks({ ...acceptedRisks, biological: e.target.checked })} />
              Riesgos biológicos a largo plazo (mucositis, peri-implantitis)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={acceptedRisks.mechanical} onChange={(e) => setAcceptedRisks({ ...acceptedRisks, mechanical: e.target.checked })} />
              Riesgos mecánicos (aflojamiento, fractura tornillo o prótesis)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={acceptedRisks.mronj} onChange={(e) => setAcceptedRisks({ ...acceptedRisks, mronj: e.target.checked })} />
              Factores personales declarados (tabaquismo, diabetes, bifosfonatos)
            </label>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
              Firma del paciente ({props.patientName})
            </p>
            <SignaturePad
              width={600}
              height={180}
              onChange={(dataUrl) => setSignature(dataUrl)}
              ariaLabel="Firma del paciente para consentimiento implantológico"
            />
            {!signature && (
              <p className="text-[10px] text-gray-500 mt-1">
                Firma con el dedo o stylus en el área de arriba.
              </p>
            )}
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={props.onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700">Cancelar</button>
          <button
            disabled={pending || !allAccepted || !signature}
            onClick={submit}
            className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Guardando…" : "Firmar y archivar"}
          </button>
        </div>
      </div>
    </div>
  );
}
