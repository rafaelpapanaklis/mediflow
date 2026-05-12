"use client";
// DrawerNewReferral — carta de referencia ortodóntica a especialista externo
// (periodoncista, endodoncista, cirujano, ATM). Persiste en `referrals`
// table con type=OUTGOING. PDF se genera bajo demanda.

import { useState } from "react";
import { Send, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";

const SPECIALTIES = [
  "Periodoncia",
  "Endodoncia",
  "Cirugía maxilofacial",
  "Implantes",
  "ATM / dolor orofacial",
  "Otorrinolaringología",
  "Ortognática",
  "Otra",
] as const;

export interface DrawerNewReferralProps {
  patientName: string;
  onClose: () => void;
  onConfirm: (payload: {
    toClinicName: string;
    toDoctorName: string | null;
    toSpecialty: string | null;
    reason: string;
    clinicalSummary: string;
  }) => Promise<void> | void;
}

export function DrawerNewReferral(props: DrawerNewReferralProps) {
  const [clinic, setClinic] = useState("");
  const [doctor, setDoctor] = useState("");
  const [specialty, setSpecialty] = useState<string>(SPECIALTIES[0]);
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = clinic.trim().length >= 2 && reason.trim().length >= 5 && summary.trim().length >= 10;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm({
        toClinicName: clinic.trim(),
        toDoctorName: doctor.trim() || null,
        toSpecialty: specialty,
        reason: reason.trim(),
        clinicalSummary: summary.trim(),
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
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[520px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800" role="dialog" aria-modal="true">
        <header className="px-6 py-4 border-b border-slate-100 bg-violet-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-violet-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">Nueva carta de referencia</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">Para: {props.patientName}</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <Field label="Especialidad">
            <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className={inputCls}>
              {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Clínica destino">
            <input type="text" value={clinic} onChange={(e) => setClinic(e.target.value)} className={inputCls} placeholder="Endo Specialists Polanco" required />
          </Field>
          <Field label="Doctor (opcional)">
            <input type="text" value={doctor} onChange={(e) => setDoctor(e.target.value)} className={inputCls} placeholder="Dr/a. Apellido Apellido" />
          </Field>
          <Field label="Motivo de referencia">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} min-h-[60px]`} placeholder="Re-tratamiento endodóntico de #46..." required />
          </Field>
          <Field label="Resumen clínico">
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={`${inputCls} min-h-[100px]`} placeholder="Paciente fem. 14 años · maloclusión clase II div 1 · molestia post-bracket #46 con sospecha pulpitis irreversible..." required />
          </Field>
          {error ? <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded p-2 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">{error}</div> : null}
        </div>
        <footer className="px-6 py-4 border-t border-slate-100 flex justify-between items-center dark:border-slate-800">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 dark:text-slate-400"><Shield className="w-3 h-3" aria-hidden />Audit trail</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Send className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={!valid || submitting}>{submitting ? "Enviando..." : "Enviar referencia"}</Btn>
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
