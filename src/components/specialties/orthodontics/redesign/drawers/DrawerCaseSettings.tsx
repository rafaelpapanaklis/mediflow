"use client";
// DrawerCaseSettings — Ola 1 (ws1-t6), «Alta del caso»: cambiar, después de
// abierto el caso, lo que A5/A6/A7/A11 dicen que hoy no se puede cambiar en
// ninguna pantalla — doctor tratante, responsable del pago, fecha de
// colocación y estado del caso (pausar / retención / terminar / abandono).
// Todo vía updateTreatmentPlan (server action existente, con bitácora).

import { useEffect, useState } from "react";
import { Loader2, Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { getCaseIntakeOptions } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";

const STATUS_OPTIONS = [
  { v: "PLANNED", l: "Planeado (sin colocar)" },
  { v: "IN_PROGRESS", l: "En tratamiento" },
  { v: "ON_HOLD", l: "Pausado" },
  { v: "RETENTION", l: "En retención" },
  { v: "COMPLETED", l: "Terminado" },
  { v: "DROPPED_OUT", l: "Abandonó" },
] as const;

const GUARDIAN_RELATION_OPTIONS = [
  { v: "madre", l: "Madre" },
  { v: "padre", l: "Padre" },
  { v: "tutor_legal", l: "Tutor legal" },
  { v: "abuelo", l: "Abuelo" },
  { v: "abuela", l: "Abuela" },
  { v: "tio", l: "Tío" },
  { v: "tia", l: "Tía" },
  { v: "hermano", l: "Hermano" },
  { v: "hermana", l: "Hermana" },
  { v: "otro", l: "Otro" },
] as const;

export interface DrawerCaseSettingsPayload {
  status: string | null;
  onHoldReason: string | null;
  droppedOutReason: string | null;
  installedAt: string | null;
  treatingDoctorId: string | null;
  responsibleGuardianId: string | null;
  newResponsibleGuardian: { fullName: string; phone: string; parentesco: string } | null;
}

export interface DrawerCaseSettingsProps {
  patientId: string;
  treatmentPlanId: string;
  onClose: () => void;
  onConfirm: (payload: DrawerCaseSettingsPayload) => Promise<void> | void;
}

export function DrawerCaseSettings(props: DrawerCaseSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState<Array<{ id: string; fullName: string }>>([]);
  const [guardians, setGuardians] = useState<
    Array<{ id: string; fullName: string; parentesco: string; phone: string }>
  >([]);

  const [status, setStatus] = useState("PLANNED");
  const [initialStatus, setInitialStatus] = useState("PLANNED");
  const [onHoldReason, setOnHoldReason] = useState("");
  const [droppedOutReason, setDroppedOutReason] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [treatingDoctorId, setTreatingDoctorId] = useState("");
  const [guardianMode, setGuardianMode] = useState<"keep" | "existing" | "new">("keep");
  const [responsibleGuardianId, setResponsibleGuardianId] = useState("");
  const [newGuardianName, setNewGuardianName] = useState("");
  const [newGuardianPhone, setNewGuardianPhone] = useState("");
  const [newGuardianRelation, setNewGuardianRelation] = useState("madre");

  useEffect(() => {
    let cancelled = false;
    getCaseIntakeOptions({ patientId: props.patientId, treatmentPlanId: props.treatmentPlanId }).then((res) => {
      if (cancelled || isFailure(res)) return;
      setDoctors(res.data.doctors);
      setGuardians(res.data.guardians);
      if (res.data.currentPlan) {
        setStatus(res.data.currentPlan.status);
        setInitialStatus(res.data.currentPlan.status);
        setOnHoldReason(res.data.currentPlan.onHoldReason ?? "");
        setDroppedOutReason(res.data.currentPlan.droppedOutReason ?? "");
        setInstalledAt(res.data.currentPlan.installedAt ? res.data.currentPlan.installedAt.slice(0, 10) : "");
        setTreatingDoctorId(res.data.currentPlan.treatingDoctorId ?? "");
        setResponsibleGuardianId(res.data.currentPlan.responsibleGuardianId ?? "");
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.patientId, props.treatmentPlanId]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusChanged = status !== initialStatus;
  const dropValid = status !== "DROPPED_OUT" || droppedOutReason.trim().length >= 20;
  const guardianValid =
    guardianMode !== "new" || (newGuardianName.trim().length >= 2 && newGuardianPhone.trim().length >= 7);
  const canSubmit = dropValid && guardianValid;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm({
        status: statusChanged ? status : null,
        onHoldReason: status === "ON_HOLD" ? onHoldReason.trim() || null : null,
        droppedOutReason: status === "DROPPED_OUT" ? droppedOutReason.trim() : null,
        installedAt: installedAt ? new Date(installedAt).toISOString() : null,
        treatingDoctorId: treatingDoctorId || null,
        responsibleGuardianId: guardianMode === "existing" ? responsibleGuardianId || null : null,
        newResponsibleGuardian:
          guardianMode === "new"
            ? { fullName: newGuardianName.trim(), phone: newGuardianPhone.trim(), parentesco: newGuardianRelation }
            : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70" onClick={props.onClose} aria-hidden />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[560px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-settings-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-violet-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-violet-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
              Configuración del caso
            </div>
            <h3 id="case-settings-title" className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100">
              Doctor · responsable · fecha · estado
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando…
            </div>
          ) : null}
          <Field label="Doctor tratante (A5)">
            <select value={treatingDoctorId} onChange={(e) => setTreatingDoctorId(e.target.value)} className={inputCls}>
              <option value="">— sin asignar —</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.fullName}</option>
              ))}
            </select>
          </Field>

          <Field label="Fecha de colocación (A6)">
            <input type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} className={inputCls} />
            <p className="text-[11px] text-slate-500 mt-1 dark:text-slate-400">
              Si el caso seguía &ldquo;planeado&rdquo; y pones fecha aquí, pasa a &ldquo;en tratamiento&rdquo;.
            </p>
          </Field>

          <div className="pt-1 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
              Responsable del pago (A11)
            </div>
            <div className="flex gap-2">
              <ModeBtn active={guardianMode === "keep"} onClick={() => setGuardianMode("keep")}>Dejar como está</ModeBtn>
              <ModeBtn active={guardianMode === "existing"} onClick={() => setGuardianMode("existing")} disabled={guardians.length === 0}>Tutor registrado</ModeBtn>
              <ModeBtn active={guardianMode === "new"} onClick={() => setGuardianMode("new")}>Nuevo</ModeBtn>
            </div>
            {guardianMode === "existing" ? (
              <select value={responsibleGuardianId} onChange={(e) => setResponsibleGuardianId(e.target.value)} className={inputCls}>
                <option value="">— elegir —</option>
                {guardians.map((g) => (
                  <option key={g.id} value={g.id}>{g.fullName} · {g.parentesco} · {g.phone}</option>
                ))}
              </select>
            ) : null}
            {guardianMode === "new" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nombre completo">
                  <input value={newGuardianName} onChange={(e) => setNewGuardianName(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Teléfono">
                  <input value={newGuardianPhone} onChange={(e) => setNewGuardianPhone(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Parentesco">
                  <select value={newGuardianRelation} onChange={(e) => setNewGuardianRelation(e.target.value)} className={inputCls}>
                    {GUARDIAN_RELATION_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </Field>
              </div>
            ) : null}
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
              Estado del caso (A7)
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            {status === "ON_HOLD" ? (
              <Field label="Motivo de la pausa">
                <textarea value={onHoldReason} onChange={(e) => setOnHoldReason(e.target.value)} className={`${inputCls} min-h-[60px]`} />
              </Field>
            ) : null}
            {status === "DROPPED_OUT" ? (
              <Field label="Motivo del abandono (mín. 20 caracteres)">
                <textarea value={droppedOutReason} onChange={(e) => setDroppedOutReason(e.target.value)} className={`${inputCls} min-h-[60px]`} />
                <div className={`text-[11px] mt-1 ${dropValid ? "text-emerald-600" : "text-amber-600"}`}>
                  {droppedOutReason.trim().length} / 20 mínimo
                </div>
              </Field>
            ) : null}
          </div>

          {error ? (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded p-2 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="px-6 py-4 border-t border-slate-100 flex justify-between items-center dark:border-slate-800">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 dark:text-slate-400">
            <Shield className="w-3 h-3" aria-hidden /> Audit trail con before/after
          </span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={submit} disabled={!canSubmit || submitting}>
              {submitting ? "Guardando…" : "Guardar"}
            </Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">{label}</label>
      {children}
    </div>
  );
}

function ModeBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-violet-600 border-violet-600 text-white"
          : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

const inputCls =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200";
