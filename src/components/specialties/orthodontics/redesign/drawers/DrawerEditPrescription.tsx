"use client";
// DrawerEditPrescription — editor de aparatología/prescripción del plan
// ortodóntico. Cambia slot, bonding, technique, notas. Persiste vía
// updateOrthoAppliances.

import { useState } from "react";
import { Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";

const SLOTS = [
  { v: "MBT_018", l: "MBT 0.018" },
  { v: "MBT_022", l: "MBT 0.022" },
  { v: "ROTH_018", l: "Roth 0.018" },
  { v: "ROTH_022", l: "Roth 0.022" },
  { v: "DAMON_Q2", l: "Damon Q2" },
  { v: "DAMON_ULTIMA", l: "Damon Ultima" },
  { v: "SPARK", l: "Spark" },
  { v: "INVISALIGN", l: "Invisalign" },
] as const;

const TECHNIQUES = [
  { v: "METAL_BRACKETS", l: "Brackets metálicos" },
  { v: "CERAMIC_BRACKETS", l: "Brackets cerámicos" },
  { v: "SELF_LIGATING_METAL", l: "Self-ligating metal" },
  { v: "SELF_LIGATING_CERAMIC", l: "Self-ligating cerámico" },
  { v: "LINGUAL_BRACKETS", l: "Lingual" },
  { v: "CLEAR_ALIGNERS", l: "Alineadores transparentes" },
  { v: "HYBRID", l: "Híbrido" },
] as const;

export interface DrawerEditPrescriptionProps {
  current: {
    treatmentPlanId: string;
    prescriptionSlot: string | null;
    bondingType: "DIRECTO" | "INDIRECTO" | null;
    technique: string;
    prescriptionNotes: string | null;
  };
  onClose: () => void;
  onConfirm: (payload: {
    treatmentPlanId: string;
    prescriptionSlot: string;
    bondingType: "DIRECTO" | "INDIRECTO";
    technique: string;
    prescriptionNotes: string | null;
  }) => Promise<void> | void;
}

export function DrawerEditPrescription(props: DrawerEditPrescriptionProps) {
  const c = props.current;
  const [slot, setSlot] = useState(c.prescriptionSlot ?? "MBT_022");
  const [bonding, setBonding] = useState<"DIRECTO" | "INDIRECTO">(c.bondingType ?? "DIRECTO");
  const [tech, setTech] = useState(c.technique);
  const [notes, setNotes] = useState(c.prescriptionNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm({
        treatmentPlanId: c.treatmentPlanId,
        prescriptionSlot: slot,
        bondingType: bonding,
        technique: tech,
        prescriptionNotes: notes || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70" onClick={props.onClose} aria-hidden />
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800" role="dialog" aria-modal="true">
        <header className="px-6 py-4 border-b border-slate-100 bg-violet-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-violet-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">Aparatología · G4</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">Cambiar prescripción</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <Field label="Prescripción / slot">
            <select value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
              {SLOTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Field>
          <Field label="Bonding">
            <div className="flex gap-2">
              {(["DIRECTO", "INDIRECTO"] as const).map((b) => (
                <button key={b} type="button" onClick={() => setBonding(b)} className={`px-3 py-1.5 text-xs font-medium rounded-md border ${bonding === b ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"}`}>
                  {b.toLowerCase()}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Técnica">
            <select value={tech} onChange={(e) => setTech(e.target.value)} className={inputCls}>
              {TECHNIQUES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </Field>
          <Field label="Notas (opcional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} min-h-[80px]`} placeholder="Premolares cerámicos, molares con tubos..." />
          </Field>
          {error ? <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded p-2 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">{error}</div> : null}
        </div>
        <footer className="px-6 py-4 border-t border-slate-100 flex justify-between items-center dark:border-slate-800">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 dark:text-slate-400"><Shield className="w-3 h-3" aria-hidden />Audit trail</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={submitting}>{submitting ? "Guardando..." : "Guardar"}</Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">{label}</label>
      {children}
    </div>
  );
}
