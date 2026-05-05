"use client";
// Implants — SurgeryWizard 3 pasos al cierre de cirugía. Spec §6.9.
// Step 1 SurgicalData / Step 2 Components / Step 3 IntraoperativePhoto.

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { createSurgicalRecord } from "@/app/actions/implants/createSurgicalRecord";
import { isFailure } from "@/app/actions/implants/result";
import { ASA_CLASSIFICATION, LEKHOLM_ZARB } from "@/lib/validation/implants";
import { LEKHOLM_ZARB_INFO } from "@/lib/implants/lekholm-zarb";

export interface SurgeryWizardProps {
  open: boolean;
  implantId: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

type State = {
  performedAt: string;
  asa: (typeof ASA_CLASSIFICATION)[number];
  prophy: boolean;
  prophyDrug: string;
  hba1c: string;
  torque: string;
  isqMD: string;
  isqVL: string;
  density: (typeof LEKHOLM_ZARB)[number];
  ridgeWidth: string;
  ridgeHeight: string;
  flap: string;
  drilling: string;
  healingLot: string;
  healingDiam: string;
  healingHeight: string;
  suture: string;
  sutureRemoval: string;
  photoFileId: string;
  postOp: string;
  duration: string;
};

const empty: State = {
  performedAt: new Date().toISOString().slice(0, 16),
  asa: "ASA_II",
  prophy: true,
  prophyDrug: "Amoxicilina 2g",
  hba1c: "",
  torque: "",
  isqMD: "",
  isqVL: "",
  density: "D2",
  ridgeWidth: "",
  ridgeHeight: "",
  flap: "Crestal con liberación distal",
  drilling: "Estándar",
  healingLot: "",
  healingDiam: "",
  healingHeight: "",
  suture: "Monofilamento nylon 4-0",
  sutureRemoval: "",
  photoFileId: "",
  postOp: "",
  duration: "60",
};

export function SurgeryWizard(props: SurgeryWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [s, setS] = useState<State>(empty);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!props.open || !props.implantId) return null;

  const close = () => { setStep(1); setS(empty); setError(null); props.onClose(); };

  const submit = () => {
    setError(null);
    if (!s.torque || !s.isqMD || !s.isqVL || !s.duration) {
      setError("Faltan datos quirúrgicos obligatorios");
      return;
    }
    startTransition(async () => {
      const r = await createSurgicalRecord({
        implantId: props.implantId!,
        performedAt: new Date(s.performedAt),
        asaClassification: s.asa,
        prophylaxisAntibiotic: s.prophy,
        prophylaxisDrug: s.prophy ? s.prophyDrug : undefined,
        hba1cIfDiabetic: s.hba1c ? Number(s.hba1c) : undefined,
        insertionTorqueNcm: Number(s.torque),
        isqMesiodistal: Number(s.isqMD),
        isqVestibulolingual: Number(s.isqVL),
        boneDensity: s.density,
        ridgeWidthMm: s.ridgeWidth ? Number(s.ridgeWidth) : undefined,
        ridgeHeightMm: s.ridgeHeight ? Number(s.ridgeHeight) : undefined,
        flapType: s.flap,
        drillingProtocol: s.drilling,
        healingAbutmentLot: s.healingLot || undefined,
        healingAbutmentDiameterMm: s.healingDiam ? Number(s.healingDiam) : undefined,
        healingAbutmentHeightMm: s.healingHeight ? Number(s.healingHeight) : undefined,
        sutureMaterial: s.suture || undefined,
        sutureRemovalScheduledAt: s.sutureRemoval ? new Date(s.sutureRemoval) : undefined,
        intraoperativePhotoFileId: s.photoFileId || undefined,
        postOpInstructions: s.postOp || undefined,
        durationMinutes: Number(s.duration),
      });
      if (isFailure(r)) { setError(r.error); return; }
      toast.success("Cirugía guardada — fase de osteointegración iniciada");
      props.onSaved?.();
      close();
    });
  };

  const densityInfo = LEKHOLM_ZARB_INFO[s.density];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold">Cerrar cirugía — Paso {step} / 3</h2>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`h-1 w-12 rounded ${step >= n ? "bg-blue-500" : "bg-gray-200 dark:bg-gray-700"}`} />
              ))}
            </div>
          </div>
          <button onClick={close} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 text-sm">
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha cirugía"><input type="datetime-local" value={s.performedAt} onChange={(e) => setS({ ...s, performedAt: e.target.value })} className={cls} /></Field>
              <Field label="ASA">
                <select value={s.asa} onChange={(e) => setS({ ...s, asa: e.target.value as State["asa"] })} className={cls}>
                  {ASA_CLASSIFICATION.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={s.prophy} onChange={(e) => setS({ ...s, prophy: e.target.checked })} />
                Profilaxis antibiótica pre-cirugía
              </label>
              {s.prophy && (
                <Field label="Antibiótico"><input value={s.prophyDrug} onChange={(e) => setS({ ...s, prophyDrug: e.target.value })} className={cls} /></Field>
              )}
              <Field label="HbA1c (si diabético)"><input type="number" step="0.1" value={s.hba1c} onChange={(e) => setS({ ...s, hba1c: e.target.value })} className={cls} /></Field>
              <Field label="Torque inserción (Ncm)"><input type="number" value={s.torque} onChange={(e) => setS({ ...s, torque: e.target.value })} className={cls} /></Field>
              <Field label="Densidad (Lekholm-Zarb)">
                <select value={s.density} onChange={(e) => setS({ ...s, density: e.target.value as State["density"] })} className={cls}>
                  {LEKHOLM_ZARB.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="ISQ Mesiodistal"><input type="number" value={s.isqMD} onChange={(e) => setS({ ...s, isqMD: e.target.value })} className={cls} /></Field>
              <Field label="ISQ Vestibulolingual"><input type="number" value={s.isqVL} onChange={(e) => setS({ ...s, isqVL: e.target.value })} className={cls} /></Field>
              <Field label="Cresta — ancho (mm)"><input type="number" step="0.1" value={s.ridgeWidth} onChange={(e) => setS({ ...s, ridgeWidth: e.target.value })} className={cls} /></Field>
              <Field label="Cresta — alto (mm)"><input type="number" step="0.1" value={s.ridgeHeight} onChange={(e) => setS({ ...s, ridgeHeight: e.target.value })} className={cls} /></Field>
              <Field label="Tipo de colgajo"><input value={s.flap} onChange={(e) => setS({ ...s, flap: e.target.value })} className={cls} /></Field>
              <Field label="Protocolo de fresado"><input value={s.drilling} onChange={(e) => setS({ ...s, drilling: e.target.value })} className={cls} /></Field>
              <div className="col-span-2 text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 p-2 rounded">
                {s.density}: {densityInfo.description} · Torque esperado {densityInfo.expectedTorqueRangeNcm.min}–{densityInfo.expectedTorqueRangeNcm.max} Ncm · cicatrización {densityInfo.expectedHealingWeeks.typical} semanas
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-xs text-gray-600 dark:text-gray-400">
                Datos del pilar de cicatrización (si protocolo 1-stage). Lote OBLIGATORIO COFEPRIS.
              </div>
              <Field label="Lote pilar cicatrización (COFEPRIS)"><input value={s.healingLot} onChange={(e) => setS({ ...s, healingLot: e.target.value })} className={cls + " font-mono"} /></Field>
              <Field label="Diámetro pilar (mm)"><input type="number" step="0.1" value={s.healingDiam} onChange={(e) => setS({ ...s, healingDiam: e.target.value })} className={cls} /></Field>
              <Field label="Altura pilar (mm)"><input type="number" step="0.1" value={s.healingHeight} onChange={(e) => setS({ ...s, healingHeight: e.target.value })} className={cls} /></Field>
              <Field label="Material de sutura"><input value={s.suture} onChange={(e) => setS({ ...s, suture: e.target.value })} className={cls} /></Field>
              <Field label="Retiro suturas programado"><input type="date" value={s.sutureRemoval} onChange={(e) => setS({ ...s, sutureRemoval: e.target.value })} className={cls} /></Field>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="ID foto intraoperatoria (PatientFile)"><input value={s.photoFileId} onChange={(e) => setS({ ...s, photoFileId: e.target.value })} className={cls} placeholder="opcional" /></Field>
              <Field label="Duración total (min)"><input type="number" value={s.duration} onChange={(e) => setS({ ...s, duration: e.target.value })} className={cls} /></Field>
              <div className="col-span-2">
                <Field label="Instrucciones post-op">
                  <textarea rows={3} value={s.postOp} onChange={(e) => setS({ ...s, postOp: e.target.value })} className={cls} />
                </Field>
              </div>
            </div>
          )}

          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        </div>

        <div className="flex justify-between gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button disabled={step === 1} onClick={() => setStep((step - 1) as typeof step)} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 disabled:opacity-50 inline-flex items-center gap-1">
            <ChevronLeft className="h-4 w-4" /> Atrás
          </button>
          {step < 3 ? (
            <button onClick={() => setStep((step + 1) as typeof step)} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1">
              Siguiente <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button disabled={pending} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending ? "Guardando…" : "Cerrar cirugía"}
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
