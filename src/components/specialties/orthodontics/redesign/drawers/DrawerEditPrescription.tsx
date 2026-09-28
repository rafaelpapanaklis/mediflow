"use client";
// DrawerEditPrescription — editor de aparatología/prescripción del plan
// ortodóntico. Cambia slot, bonding, technique, notas. Persiste vía
// updateOrthoAppliances.

import { useState } from "react";
import { Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
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
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1} className={orto.cajon} role="dialog" aria-modal="true">
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Plan de tratamiento</div>
            <h3 className={orto.cajonTitulo}>Cambiar prescripción</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <Field label="Prescripción / slot">
            <select value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls}>
              {SLOTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Field>
          <Field label="Cementado">
            <div className="flex gap-2">
              {(["DIRECTO", "INDIRECTO"] as const).map((b) => (
                <button key={b} type="button" onClick={() => setBonding(b)} className={`px-3 py-1.5 text-xs font-medium rounded-[8px] border ${bonding === b ? "bg-[color:var(--pr-activo)] text-[color:var(--pr-activo-texto)] border-[color:var(--pr-activo)]" : "bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto-2)] border-[color:var(--pr-borde)]"}`}>
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
          {error ? <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] text-[color:var(--pr-peligro)] text-xs rounded-[8px] p-2">{error}</div> : null}
        </div>
        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1"><Shield className="w-3 h-3" aria-hidden />Cada cambio queda registrado</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={submitting}>{submitting ? "Guardando..." : "Guardar"}</Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

const inputCls = orto.entrada;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">{label}</label>
      {children}
    </div>
  );
}
