"use client";
// Implants — ProstheticWizard 3 pasos. Spec §6.10.
// Al finalizar exitosamente, la action createProstheticPhase también
// AUTO-GENERA el carnet (Spec §1.15).

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, ChevronLeft, ChevronRight, CreditCard } from "lucide-react";
import { createProstheticPhase } from "@/app/actions/implants/createProstheticPhase";
import { isFailure } from "@/app/actions/implants/result";
import { ABUTMENT_TYPE, PROSTHESIS_TYPE, PROSTHESIS_MATERIAL } from "@/lib/validation/implants";

export interface ProstheticWizardProps {
  open: boolean;
  implantId: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

type State = {
  abutmentType: (typeof ABUTMENT_TYPE)[number];
  abutmentBrand: string;
  abutmentLot: string;
  abutmentDiam: string;
  abutmentHeight: string;
  abutmentAng: string;
  abutmentTorque: string;
  prosthesisType: (typeof PROSTHESIS_TYPE)[number];
  prosthesisMaterial: (typeof PROSTHESIS_MATERIAL)[number];
  labName: string;
  labLot: string;
  occlusion: string;
  screwLot: string;
  screwTorque: string;
  immediate: boolean;
  provisionalDelivered: string;
  definitiveDelivered: string;
  prosthesisDelivered: string;
};

const empty: State = {
  abutmentType: "PREFABRICATED_TI",
  abutmentBrand: "",
  abutmentLot: "",
  abutmentDiam: "",
  abutmentHeight: "",
  abutmentAng: "",
  abutmentTorque: "35",
  prosthesisType: "SCREW_RETAINED_SINGLE",
  prosthesisMaterial: "ZIRCONIA_MONOLITHIC",
  labName: "",
  labLot: "",
  occlusion: "función de grupo",
  screwLot: "",
  screwTorque: "",
  immediate: false,
  provisionalDelivered: "",
  definitiveDelivered: "",
  prosthesisDelivered: new Date().toISOString().slice(0, 10),
};

export function ProstheticWizard(props: ProstheticWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [s, setS] = useState<State>(empty);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!props.open || !props.implantId) return null;

  const close = () => { setStep(1); setS(empty); setError(null); props.onClose(); };

  const submit = () => {
    setError(null);
    if (!s.abutmentLot || !s.labName || !s.labLot || !s.abutmentTorque) {
      setError("Faltan datos del pilar/prótesis (incluye lotes COFEPRIS)");
      return;
    }
    startTransition(async () => {
      const r = await createProstheticPhase({
        implantId: props.implantId!,
        abutmentType: s.abutmentType,
        abutmentBrand: s.abutmentBrand || undefined,
        abutmentLot: s.abutmentLot,
        abutmentDiameterMm: s.abutmentDiam ? Number(s.abutmentDiam) : undefined,
        abutmentHeightMm: s.abutmentHeight ? Number(s.abutmentHeight) : undefined,
        abutmentAngulationDeg: s.abutmentAng ? Number(s.abutmentAng) : undefined,
        abutmentTorqueNcm: Number(s.abutmentTorque),
        prosthesisType: s.prosthesisType,
        prosthesisMaterial: s.prosthesisMaterial,
        prosthesisLabName: s.labName,
        prosthesisLabLot: s.labLot,
        screwLot: s.screwLot || undefined,
        screwTorqueNcm: s.screwTorque ? Number(s.screwTorque) : undefined,
        immediateLoading: s.immediate,
        provisionalDeliveredAt: s.provisionalDelivered ? new Date(s.provisionalDelivered) : undefined,
        definitiveDeliveredAt: s.definitiveDelivered ? new Date(s.definitiveDelivered) : undefined,
        prosthesisDeliveredAt: new Date(s.prosthesisDelivered),
        occlusionScheme: s.occlusion || undefined,
      });
      if (isFailure(r)) { setError(r.error); return; }
      toast.success("Fase protésica completa — carnet PDF generado automáticamente", {
        icon: "🎉",
      });
      props.onSaved?.();
      close();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-emerald-600" /> Fase protésica — Paso {step} / 3
            </h2>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`h-1 w-12 rounded ${step >= n ? "bg-emerald-500" : "bg-gray-200 dark:bg-gray-700"}`} />
              ))}
            </div>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-1">
              Al finalizar se genera el carnet del implante automáticamente.
            </p>
          </div>
          <button onClick={close} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 text-sm">
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo de pilar">
                <select value={s.abutmentType} onChange={(e) => setS({ ...s, abutmentType: e.target.value as State["abutmentType"] })} className={cls}>
                  {ABUTMENT_TYPE.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Marca pilar"><input value={s.abutmentBrand} onChange={(e) => setS({ ...s, abutmentBrand: e.target.value })} className={cls} /></Field>
              <Field label="Lote pilar (COFEPRIS)"><input value={s.abutmentLot} onChange={(e) => setS({ ...s, abutmentLot: e.target.value })} className={cls + " font-mono"} /></Field>
              <Field label="Diámetro (mm)"><input type="number" step="0.1" value={s.abutmentDiam} onChange={(e) => setS({ ...s, abutmentDiam: e.target.value })} className={cls} /></Field>
              <Field label="Altura (mm)"><input type="number" step="0.1" value={s.abutmentHeight} onChange={(e) => setS({ ...s, abutmentHeight: e.target.value })} className={cls} /></Field>
              <Field label="Angulación (°)"><input type="number" value={s.abutmentAng} onChange={(e) => setS({ ...s, abutmentAng: e.target.value })} className={cls} /></Field>
              <Field label="Torque pilar (Ncm)"><input type="number" value={s.abutmentTorque} onChange={(e) => setS({ ...s, abutmentTorque: e.target.value })} className={cls} /></Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo prótesis">
                <select value={s.prosthesisType} onChange={(e) => setS({ ...s, prosthesisType: e.target.value as State["prosthesisType"] })} className={cls}>
                  {PROSTHESIS_TYPE.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Material">
                <select value={s.prosthesisMaterial} onChange={(e) => setS({ ...s, prosthesisMaterial: e.target.value as State["prosthesisMaterial"] })} className={cls}>
                  {PROSTHESIS_MATERIAL.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Laboratorio"><input value={s.labName} onChange={(e) => setS({ ...s, labName: e.target.value })} className={cls} /></Field>
              <Field label="Lote lab (COFEPRIS)"><input value={s.labLot} onChange={(e) => setS({ ...s, labLot: e.target.value })} className={cls + " font-mono"} /></Field>
              <Field label="Esquema oclusión"><input value={s.occlusion} onChange={(e) => setS({ ...s, occlusion: e.target.value })} className={cls} /></Field>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lote tornillo"><input value={s.screwLot} onChange={(e) => setS({ ...s, screwLot: e.target.value })} className={cls + " font-mono"} /></Field>
              <Field label="Torque tornillo (Ncm)"><input type="number" value={s.screwTorque} onChange={(e) => setS({ ...s, screwTorque: e.target.value })} className={cls} /></Field>
              <Field label="Fecha entrega prótesis"><input type="date" value={s.prosthesisDelivered} onChange={(e) => setS({ ...s, prosthesisDelivered: e.target.value })} className={cls} /></Field>
              <label className="flex items-center gap-2 text-xs col-span-2">
                <input type="checkbox" checked={s.immediate} onChange={(e) => setS({ ...s, immediate: e.target.checked })} />
                Carga inmediata
              </label>
              <Field label="Provisional entregada"><input type="date" value={s.provisionalDelivered} onChange={(e) => setS({ ...s, provisionalDelivered: e.target.value })} className={cls} /></Field>
              <Field label="Definitiva entregada"><input type="date" value={s.definitiveDelivered} onChange={(e) => setS({ ...s, definitiveDelivered: e.target.value })} className={cls} /></Field>
            </div>
          )}

          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        </div>

        <div className="flex justify-between gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button disabled={step === 1} onClick={() => setStep((step - 1) as typeof step)} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 disabled:opacity-50 inline-flex items-center gap-1">
            <ChevronLeft className="h-4 w-4" /> Atrás
          </button>
          {step < 3 ? (
            <button onClick={() => setStep((step + 1) as typeof step)} className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1">
              Siguiente <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button disabled={pending} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? "Generando carnet…" : "Finalizar y generar carnet"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const cls = "w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</span>
      {children}
    </label>
  );
}
