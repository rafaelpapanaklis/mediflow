"use client";
import { useState, useEffect } from "react";
import { CheckCircle, Circle, ChevronDown, ChevronUp, X } from "lucide-react";
import Link from "next/link";

const STEPS = [
  { id:"doctor",    label:"Agrega un doctor",       desc:"Ve a Configuración → Equipo",   href:"/dashboard/settings#team",       emoji:"👨‍⚕️" },
  { id:"schedule",  label:"Configura tu horario",   desc:"Configuración → Horarios",       href:"/dashboard/settings#schedule",   emoji:"🕐" },
  { id:"patient",   label:"Registra un paciente",   desc:"Ve a Pacientes → Nuevo paciente",href:"/dashboard/patients",            emoji:"👤" },
  { id:"appointment",label:"Agenda una cita",       desc:"Ve a Agenda → Nueva cita",       href:"/dashboard/appointments",        emoji:"📅" },
  { id:"record",    label:"Registra una consulta",  desc:"Abre un expediente → Nueva consulta", href:"/dashboard/patients",       emoji:"📋" },
  { id:"invoice",   label:"Crea una factura",       desc:"Ve a Facturación",               href:"/dashboard/billing",             emoji:"💳" },
  { id:"whatsapp",  label:"Conecta WhatsApp",       desc:"Configuración → WhatsApp",       href:"/dashboard/settings#whatsapp",   emoji:"💬" },
];

interface Props {
  completed: string[]; // IDs of completed steps from server
  clinicId:  string;
}

export function OnboardingChecklist({ completed: initial, clinicId }: Props) {
  const [completed, setCompleted] = useState<Set<string>>(new Set(initial));
  const [collapsed, setCollapsed]  = useState(false);
  const [dismissed, setDismissed]  = useState(false);

  useEffect(() => {
    // Check localStorage to see if user dismissed it
    const d = localStorage.getItem(`onboarding-dismissed-${clinicId}`);
    if (d) setDismissed(true);
  }, [clinicId]);

  function dismiss() {
    localStorage.setItem(`onboarding-dismissed-${clinicId}`, "1");
    setDismissed(true);
  }

  const pct  = Math.round((completed.size / STEPS.length) * 100);
  const done = completed.size >= STEPS.length;

  if (dismissed || done) return null;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-base">🚀</span>
          <div>
            <div className="text-xs font-bold">Primeros pasos</div>
            <div className="text-xs text-muted-foreground">{completed.size}/{STEPS.length} completados</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCollapsed(!collapsed)} className="p-1 hover:bg-muted rounded-lg">
            {collapsed ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
          </button>
          <button onClick={dismiss} className="p-1 hover:bg-muted rounded-lg text-muted-foreground">
            <X size={14}/>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-2">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-brand-600 rounded-full transition-all duration-500" style={{width:`${pct}%`}} />
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="p-3 space-y-1">
          {STEPS.map(step => {
            const isDone = completed.has(step.id);
            return (
              <Link key={step.id} href={step.href}
                className={`flex items-center gap-3 p-2 rounded-xl transition-colors ${isDone ? "opacity-50" : "hover:bg-muted/50"}`}>
                {isDone
                  ? <CheckCircle size={16} className="text-emerald-500 shrink-0" />
                  : <Circle size={16} className="text-muted-foreground shrink-0" />
                }
                <span className="text-sm shrink-0">{step.emoji}</span>
                <div className="min-w-0">
                  <div className={`text-xs font-semibold truncate ${isDone ? "line-through text-muted-foreground" : ""}`}>{step.label}</div>
                  {!isDone && <div className="text-xs text-muted-foreground truncate">{step.desc}</div>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
