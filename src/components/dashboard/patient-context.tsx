"use client";

import { useState } from "react";
import { AlertTriangle, Pill, Clock, ChevronDown, ChevronUp } from "lucide-react";

interface PatientContextProps {
  patient: {
    firstName: string; lastName: string; patientNumber: string;
    bloodType?: string | null; dob?: string | null; gender?: string;
    allergies: string[]; chronicConditions: string[]; currentMedications: string[];
    lastVisit?: string | null; visitCount?: number;
  };
}

export function PatientContextPanel({ patient }: PatientContextProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasAlerts = patient.allergies.length > 0;

  function calcAge(dob: string) {
    const born = new Date(dob);
    const now  = new Date();
    return now.getFullYear() - born.getFullYear() - (
      now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate()) ? 1 : 0
    );
  }

  return (
    <div className={`bg-card border rounded-2xl shadow-card overflow-hidden mb-5 transition-all
      ${hasAlerts ? "border-amber-300 dark:border-amber-700" : "border-border"}`}>

      {/* Header */}
      <button onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/10 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {patient.firstName[0]}{patient.lastName[0]}
          </div>
          <div className="text-left">
            <div className="text-base font-bold">{patient.firstName} {patient.lastName}</div>
            <div className="text-sm text-muted-foreground">
              {patient.patientNumber}
              {patient.dob && ` · ${calcAge(patient.dob)} años`}
              {patient.bloodType && ` · ${patient.bloodType}`}
            </div>
          </div>
          {hasAlerts && (
            <span className="flex items-center gap-1 text-sm font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 rounded-full ml-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              {patient.allergies.length} {patient.allergies.length === 1 ? "alergia" : "alergias"}
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
          : <ChevronUp   className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="grid grid-cols-3 gap-0 border-t border-border divide-x divide-border">

          {/* Allergies */}
          <div className="px-4 py-3">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Alergias
            </div>
            {patient.allergies.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sin alergias registradas</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {patient.allergies.map(a => (
                  <span key={a} className="text-xs font-bold bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-800">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Medications */}
          <div className="px-4 py-3">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Pill className="w-3.5 h-3.5 text-blue-500" /> Medicamentos
            </div>
            {patient.currentMedications.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sin medicamentos registrados</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {patient.currentMedications.map(m => (
                  <span key={m} className="text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800">
                    {m}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="px-4 py-3">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-500" /> Historial
            </div>
            <div className="space-y-1.5">
              {patient.visitCount !== undefined && (
                <div className="text-sm"><span className="font-bold text-foreground">{patient.visitCount}</span> <span className="text-muted-foreground">visitas totales</span></div>
              )}
              {patient.lastVisit && (
                <div className="text-sm text-muted-foreground">
                  Última: {new Date(patient.lastVisit).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}
                </div>
              )}
              {patient.chronicConditions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {patient.chronicConditions.slice(0,2).map(c => (
                    <span key={c} className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">{c}</span>
                  ))}
                  {patient.chronicConditions.length > 2 && (
                    <span className="text-xs text-muted-foreground">+{patient.chronicConditions.length - 2} más</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
