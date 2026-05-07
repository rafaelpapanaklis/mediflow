"use client";
// DrawerConfigNps — configurar windows NPS post-debond + custom message.
// Persiste vía updateNpsConfig.

import { useState } from "react";
import { Save, Shield, Star, X } from "lucide-react";
import { Btn } from "../atoms/Btn";

export interface DrawerConfigNpsProps {
  current: {
    windowEarlyDays: number;
    windowMidDays: number;
    windowLateDays: number;
    customMessage: string | null;
    triggerGoogleReview: boolean;
  };
  onClose: () => void;
  onConfirm: (payload: {
    windowEarlyDays: number;
    windowMidDays: number;
    windowLateDays: number;
    customMessage: string | null;
    triggerGoogleReview: boolean;
  }) => Promise<void> | void;
}

export function DrawerConfigNps(props: DrawerConfigNpsProps) {
  const c = props.current;
  const [early, setEarly] = useState(c.windowEarlyDays);
  const [mid, setMid] = useState(c.windowMidDays);
  const [late, setLate] = useState(c.windowLateDays);
  const [msg, setMsg] = useState(c.customMessage ?? "");
  const [google, setGoogle] = useState(c.triggerGoogleReview);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = early >= 1 && early <= 14 && mid >= 60 && mid <= 240 && late >= 180 && late <= 540;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm({
        windowEarlyDays: early,
        windowMidDays: mid,
        windowLateDays: late,
        customMessage: msg.trim() || null,
        triggerGoogleReview: google,
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
        <header className="px-6 py-4 border-b border-slate-100 bg-amber-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-amber-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium dark:text-amber-300 inline-flex items-center gap-1"><Star className="w-3 h-3" aria-hidden />Encuesta NPS · G11</div>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">Configurar windows post-debond</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
            El cron lee orthoNpsSchedule pendientes y dispara WhatsApp template con Twilio · contratar para activar envío real.
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="+3 días (early)"><input type="number" min={1} max={14} value={early} onChange={(e) => setEarly(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="+6 meses (mid · días)"><input type="number" min={60} max={240} value={mid} onChange={(e) => setMid(Number(e.target.value))} className={inputCls} /></Field>
            <Field label="+12 meses (late · días)"><input type="number" min={180} max={540} value={late} onChange={(e) => setLate(Number(e.target.value))} className={inputCls} /></Field>
          </div>
          <Field label="Mensaje WhatsApp custom (opcional)">
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} className={`${inputCls} min-h-[100px]`} placeholder='"Hola {nombre} 🌟 ¿Cómo te sientes con tus brackets? Califica 0-10 (10 = excelente)..."' />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={google} onChange={(e) => setGoogle(e.target.checked)} />
            Disparar trigger Google review automático cuando NPS ≥ 9
          </label>
          {error ? <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded p-2 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">{error}</div> : null}
        </div>
        <footer className="px-6 py-4 border-t border-slate-100 flex justify-between items-center dark:border-slate-800">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 dark:text-slate-400"><Shield className="w-3 h-3" aria-hidden />Audit trail</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={!valid || submitting}>{submitting ? "Guardando..." : "Guardar configuración"}</Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">{label}</label>
      {children}
    </div>
  );
}
