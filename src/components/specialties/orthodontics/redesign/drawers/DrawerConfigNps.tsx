"use client";
// DrawerConfigNps — configurar windows NPS post-debond + custom message.
// Persiste vía updateNpsConfig.

import { useState } from "react";
import { Save, Shield, Star, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
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
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1} className={orto.cajon} role="dialog" aria-modal="true">
        <header className={orto.cajonCabeza}>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--pr-alerta)] font-medium inline-flex items-center gap-1"><Star className="w-3 h-3" aria-hidden />Encuesta NPS · G11</div>
            <h3 className={orto.cajonTitulo}>Configurar windows post-debond</h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}><X className="w-5 h-5" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="bg-[color:var(--pr-tarjeta-2)] border border-[color:var(--pr-borde)] rounded-[8px] p-3 text-xs text-[color:var(--pr-texto-2)]">
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
          <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
            <input type="checkbox" checked={google} onChange={(e) => setGoogle(e.target.checked)} />
            Disparar trigger Google review automático cuando NPS ≥ 9
          </label>
          {error ? <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] text-[color:var(--pr-peligro)] text-xs rounded-[8px] p-2">{error}</div> : null}
        </div>
        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1"><Shield className="w-3 h-3" aria-hidden />Cada cambio queda registrado</span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={!valid || submitting}>{submitting ? "Guardando..." : "Guardar configuración"}</Btn>
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
