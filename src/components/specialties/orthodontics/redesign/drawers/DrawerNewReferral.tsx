"use client";
// DrawerNewReferral — carta de referencia ortodóntica a especialista externo
// (periodoncista, endodoncista, cirujano, ATM). Persiste en `referrals`
// table con type=OUTGOING. PDF se genera bajo demanda.

import { useState } from "react";
import { Send, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
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
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1} className={orto.cajon} role="dialog" aria-modal="true">
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Carta de referencia</div>
            <h3 className={orto.cajonTitulo}>Nueva carta · {props.patientName}</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
          {error ? <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] text-[color:var(--pr-peligro)] text-xs rounded-[8px] p-2">{error}</div> : null}
        </div>
        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1"><Shield className="w-3 h-3" aria-hidden />Cada cambio queda registrado</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Send className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={!valid || submitting}>{submitting ? "Enviando..." : "Enviar referencia"}</Btn>
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
