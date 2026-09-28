"use client";
// DrawerEditDiagnosis — editor del diagnóstico ortodóntico activo. Form
// con todos los campos clínicos del modelo OrthodonticDiagnosis.
// Usa updateDiagnosis server action existente.

import { useState } from "react";
import { Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import type { DiagnosisDTO, OrthoSkeletalPattern as SkeletalPattern } from "../types";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

const ANGLE_OPTIONS = ["CLASS_I", "CLASS_II_DIV_1", "CLASS_II_DIV_2", "CLASS_III"] as const;
// Solo el rótulo que se lee: el valor que se guarda es la clave de siempre.
const ANGLE_LABEL: Record<(typeof ANGLE_OPTIONS)[number], string> = {
  CLASS_I: "Clase I",
  CLASS_II_DIV_1: "Clase II div. 1",
  CLASS_II_DIV_2: "Clase II div. 2",
  CLASS_III: "Clase III",
};
const SKELETAL_OPTIONS: ReadonlyArray<SkeletalPattern> = [
  "MESOFACIAL",
  "DOLICOFACIAL",
  "BRAQUIFACIAL",
];

export interface DrawerEditDiagnosisProps {
  diagnosis: DiagnosisDTO;
  onClose: () => void;
  onConfirm: (payload: {
    diagnosisId: string;
    angleClassRight: string;
    angleClassLeft: string;
    overbiteMm: number;
    overjetMm: number;
    crowdingUpperMm: number | null;
    crowdingLowerMm: number | null;
    crossbite: boolean;
    crossbiteDetails: string | null;
    openBite: boolean;
    skeletalPattern: SkeletalPattern | null;
    tmjPainPresent: boolean;
    tmjClickingPresent: boolean;
    tmjNotes: string | null;
    clinicalSummary: string;
  }) => Promise<void> | void;
}

export function DrawerEditDiagnosis(props: DrawerEditDiagnosisProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const d = props.diagnosis;
  const [angleR, setAngleR] = useState(d.angleClassRight);
  const [angleL, setAngleL] = useState(d.angleClassLeft);
  const [overbite, setOverbite] = useState(d.overbiteMm);
  const [overjet, setOverjet] = useState(d.overjetMm);
  const [crowdU, setCrowdU] = useState(d.crowdingUpperMm ?? 0);
  const [crowdL, setCrowdL] = useState(d.crowdingLowerMm ?? 0);
  const [crossbite, setCrossbite] = useState(d.crossbite);
  const [crossbiteDetails, setCrossbiteDetails] = useState(d.crossbiteDetails ?? "");
  const [openBite, setOpenBite] = useState(d.openBite);
  const [skeletal, setSkeletal] = useState<SkeletalPattern | "">(
    d.skeletalPattern ?? "",
  );
  const [tmjPain, setTmjPain] = useState(d.tmjPainPresent);
  const [tmjClick, setTmjClick] = useState(d.tmjClickingPresent);
  const [tmjNotes, setTmjNotes] = useState(d.tmjNotes ?? "");
  const [summary, setSummary] = useState(d.clinicalSummary);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm({
        diagnosisId: d.id,
        angleClassRight: angleR,
        angleClassLeft: angleL,
        overbiteMm: overbite,
        overjetMm: overjet,
        crowdingUpperMm: crowdU || null,
        crowdingLowerMm: crowdL || null,
        crossbite,
        crossbiteDetails: crossbiteDetails || null,
        openBite,
        skeletalPattern: skeletal === "" ? null : skeletal,
        tmjPainPresent: tmjPain,
        tmjClickingPresent: tmjClick,
        tmjNotes: tmjNotes || null,
        clinicalSummary: summary,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1} className={`${orto.cajon} ${orto.cajonAncho}`} role="dialog" aria-modal="true" aria-labelledby="dx-title">
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Diagnóstico</div>
            <h3 id="dx-title" className={orto.cajonTitulo}>Editar diagnóstico</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Angle derecha">
              <select value={angleR} onChange={(e) => setAngleR(e.target.value)} className={inputCls}>
                {ANGLE_OPTIONS.map((o) => <option key={o} value={o}>{ANGLE_LABEL[o]}</option>)}
              </select>
            </Field>
            <Field label="Angle izquierda">
              <select value={angleL} onChange={(e) => setAngleL(e.target.value)} className={inputCls}>
                {ANGLE_OPTIONS.map((o) => <option key={o} value={o}>{ANGLE_LABEL[o]}</option>)}
              </select>
            </Field>
            <Field label="Overbite (mm)"><input type="number" step="0.5" value={overbite} onChange={(e) => setOverbite(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="Overjet (mm)"><input type="number" step="0.5" value={overjet} onChange={(e) => setOverjet(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="Apiñam. sup. (mm)"><input type="number" step="0.5" value={crowdU} onChange={(e) => setCrowdU(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="Apiñam. inf. (mm)"><input type="number" step="0.5" value={crowdL} onChange={(e) => setCrowdL(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="Patrón esquelético">
              <select value={skeletal} onChange={(e) => setSkeletal(e.target.value as SkeletalPattern | "")} className={inputCls}>
                <option value="">— sin asignar —</option>
                {SKELETAL_OPTIONS.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
              </select>
            </Field>
            <Field label="Mordida cruzada">
              <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]"><input type="checkbox" checked={crossbite} onChange={(e) => setCrossbite(e.target.checked)} /> Presente</label>
            </Field>
          </div>
          {crossbite ? (
            <Field label="Detalles mordida cruzada">
              <input type="text" value={crossbiteDetails} onChange={(e) => setCrossbiteDetails(e.target.value)} className={inputCls} placeholder="lateral derecha 15-45" />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mordida abierta">
              <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]"><input type="checkbox" checked={openBite} onChange={(e) => setOpenBite(e.target.checked)} /> Presente</label>
            </Field>
            <Field label="ATM">
              <div className="flex flex-col gap-1 text-[13px] text-[color:var(--pr-texto-2)]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={tmjPain} onChange={(e) => setTmjPain(e.target.checked)} /> Dolor</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={tmjClick} onChange={(e) => setTmjClick(e.target.checked)} /> Chasquido</label>
              </div>
            </Field>
          </div>
          <Field label="Notas ATM">
            <textarea value={tmjNotes} onChange={(e) => setTmjNotes(e.target.value)} className={`${inputCls} min-h-[60px]`} />
          </Field>
          <Field label="Resumen clínico">
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={`${inputCls} min-h-[120px]`} required />
          </Field>
          {error ? <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] text-[color:var(--pr-peligro)] text-xs rounded-[8px] p-2">{error}</div> : null}
        </div>
        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1"><Shield className="w-3 h-3" aria-hidden />Cada cambio queda registrado</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={submitting || !summary}>{submitting ? "Guardando..." : "Guardar"}</Btn>
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
