// PatientHeaderG16 · cabecera completa con flow + stats · design/atoms.jsx atom 1.

"use client";

import { Pencil, MoreHorizontal, NotebookPen, Globe, CalendarPlus, Check } from "lucide-react";
import { Avatar } from "./Avatar";

interface PatientHeaderG16Props {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    patientNumber: string;
    dob?: Date | string | null;
    sex?: string | null;
    phone?: string | null;
  };
  caseCode: string;
  doctorName: string;
  status: "ACTIVE" | "PAUSED" | "DEBONDING" | "RETENTION" | "COMPLETED" | "DRAFT" | "EVAL" | "ACCEPTED";
  onCmd?: (cmd: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Borrador", cls: "bg-muted text-muted-foreground" },
  EVAL: { label: "En evaluación", cls: "bg-cyan-100 text-cyan-700" },
  ACCEPTED: { label: "Plan aceptado", cls: "bg-violet-100 text-violet-700" },
  ACTIVE: { label: "Activo", cls: "bg-emerald-100 text-emerald-700" },
  PAUSED: { label: "Pausado", cls: "bg-amber-100 text-amber-700" },
  DEBONDING: { label: "Debonding", cls: "bg-blue-100 text-blue-700" },
  RETENTION: { label: "Retención", cls: "bg-amber-100 text-amber-700" },
  COMPLETED: { label: "Completado", cls: "bg-emerald-100 text-emerald-700" },
};

function ageFrom(dob?: Date | string | null): number | null {
  if (!dob) return null;
  const d = typeof dob === "string" ? new Date(dob) : dob;
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

export function PatientHeaderG16({
  patient,
  caseCode,
  doctorName,
  status,
  onCmd,
}: PatientHeaderG16Props) {
  const name = `${patient.firstName} ${patient.lastName}`.trim();
  const age = ageFrom(patient.dob);
  const st = STATUS_LABELS[status] ?? STATUS_LABELS.DRAFT;

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <Avatar name={name} size={64} color="#9b5cf6" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight leading-tight">{name}</h1>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}
          >
            <Check className="h-2.5 w-2.5" />
            {st.label}
          </span>
          <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
            Caso ortodóntico
          </span>
        </div>
        <div className="flex items-center gap-3.5 text-xs text-muted-foreground">
          <span className="font-mono">{caseCode}</span>
          <span>·</span>
          <span>
            {patient.patientNumber}
            {age != null ? ` · ${age} años` : ""}
            {patient.sex ? ` · ${patient.sex}` : ""}
          </span>
          {patient.phone && (
            <>
              <span>·</span>
              <span>{patient.phone}</span>
            </>
          )}
          <span>·</span>
          <span>{doctorName}</span>
        </div>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={() => onCmd?.("edit-patient")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <Pencil className="h-3 w-3" /> Editar
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card hover:bg-muted"
          aria-label="Más opciones"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onCmd?.("new-note")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <NotebookPen className="h-3 w-3" /> Nota
        </button>
        <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted">
          <Globe className="h-3 w-3" /> Portal
        </button>
        <button
          onClick={() => onCmd?.("schedule")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white shadow-sm hover:bg-blue-600"
        >
          <CalendarPlus className="h-3 w-3" /> Agendar cita
        </button>
      </div>
    </div>
  );
}
