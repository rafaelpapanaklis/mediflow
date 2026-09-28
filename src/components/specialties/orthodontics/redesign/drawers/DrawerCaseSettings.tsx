"use client";
// DrawerCaseSettings — Ola 1 (ws1-t6), «Alta del caso»: cambiar, después de
// abierto el caso, lo que A5/A6/A7/A11 dicen que hoy no se puede cambiar en
// ninguna pantalla — doctor tratante, responsable del pago, fecha de
// colocación y estado del caso (pausar / retención / terminar / abandono).
// Todo vía updateTreatmentPlan (server action existente, con bitácora).

import { useEffect, useState } from "react";
import { FileText, Loader2, Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { getCaseIntakeOptions } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
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
  // A5/A11 — si el SQL de esta parte (sql/ortodoncia-alta-caso.sql) o el de
  // la Ola 0 (treatingDoctorId) aún no está pegado, se sabe ANTES de elegir
  // (comprobado contra information_schema, no inferido de un valor en null).
  const [columnsExist, setColumnsExist] = useState({ treatingDoctorId: true, responsibleGuardianId: true });
  // A13 — solo si el caso ya tiene quién lo refirió se ofrece la carta de avance.
  const [referredByDoctor, setReferredByDoctor] = useState<{ fullName: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCaseIntakeOptions({ patientId: props.patientId, treatmentPlanId: props.treatmentPlanId }).then((res) => {
      if (cancelled || isFailure(res)) return;
      setDoctors(res.data.doctors);
      setGuardians(res.data.guardians);
      setColumnsExist(res.data.columnsExist);
      setReferredByDoctor(res.data.referredByDoctor);
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
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-settings-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>
              Caso de ortodoncia
            </div>
            <h3 id="case-settings-title" className={orto.cajonTitulo}>
              Datos del caso
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[color:var(--pr-texto-3)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando…
            </div>
          ) : null}
          <Field label="Doctor tratante">
            <select
              value={treatingDoctorId}
              onChange={(e) => setTreatingDoctorId(e.target.value)}
              className={inputCls}
              disabled={!columnsExist.treatingDoctorId}
            >
              <option value="">— sin asignar —</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.fullName}</option>
              ))}
            </select>
            {!columnsExist.treatingDoctorId ? (
              <p className="text-[11px] text-[color:var(--pr-alerta)] mt-1">
                Falta pegar el SQL de la Ola 0 (sql/ortodoncia-nucleo.sql) — no se puede guardar todavía.
              </p>
            ) : null}
          </Field>

          <Field label="Fecha de colocación">
            <input type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} className={inputCls} />
            <p className="text-[11px] text-[color:var(--pr-texto-3)] mt-1">
              Si el caso seguía &ldquo;planeado&rdquo; y pones fecha aquí, pasa a &ldquo;en tratamiento&rdquo;.
            </p>
          </Field>

          <div className="pt-1 space-y-2">
            <div className={orto.ceja}>
              Responsable del pago
            </div>
            {!columnsExist.responsibleGuardianId ? (
              <p className="text-[11px] text-[color:var(--pr-alerta)]">
                Falta pegar el SQL de esta parte (sql/ortodoncia-alta-caso.sql) — no se puede elegir
                responsable todavía.
              </p>
            ) : null}
            <div className="flex gap-2">
              <ModeBtn active={guardianMode === "keep"} onClick={() => setGuardianMode("keep")}>Dejar como está</ModeBtn>
              <ModeBtn active={guardianMode === "existing"} onClick={() => setGuardianMode("existing")} disabled={!columnsExist.responsibleGuardianId || guardians.length === 0}>Ya registrado</ModeBtn>
              <ModeBtn active={guardianMode === "new"} onClick={() => setGuardianMode("new")} disabled={!columnsExist.responsibleGuardianId}>Nuevo</ModeBtn>
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

          <div className="pt-2 border-t border-[color:var(--pr-borde-suave)] space-y-2">
            <div className={orto.ceja}>
              Estado del caso
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
                <div className={`text-[11px] mt-1 ${dropValid ? "text-[color:var(--pr-exito)]" : "text-[color:var(--pr-alerta)]"}`}>
                  {droppedOutReason.trim().length} / 20 mínimo
                </div>
              </Field>
            ) : null}
          </div>

          {referredByDoctor ? (
            <div className="pt-2 border-t border-[color:var(--pr-borde-suave)] space-y-2">
              <div className={orto.ceja}>
                Carta de avance · referido por {referredByDoctor.fullName}
              </div>
              <p className="text-[11px] text-[color:var(--pr-texto-3)]">
                Se abre en una pestaña nueva — descárgala o compártela tú mismo; no se envía sola.
              </p>
              <div className="flex gap-2">
                <Btn
                  variant="secondary"
                  size="sm"
                  icon={<FileText className="w-3.5 h-3.5" aria-hidden />}
                  onClick={() =>
                    window.open(
                      `/api/orthodontics/treatment-plans/${props.treatmentPlanId}/referral-progress-pdf?stage=inicio`,
                      "_blank",
                    )
                  }
                >
                  PDF de inicio
                </Btn>
                <Btn
                  variant="secondary"
                  size="sm"
                  icon={<FileText className="w-3.5 h-3.5" aria-hidden />}
                  onClick={() =>
                    window.open(
                      `/api/orthodontics/treatment-plans/${props.treatmentPlanId}/referral-progress-pdf?stage=termino`,
                      "_blank",
                    )
                  }
                >
                  PDF de término
                </Btn>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] text-[color:var(--pr-peligro)] text-xs rounded-[8px] p-2">
              {error}
            </div>
          ) : null}
        </div>

        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1">
            <Shield className="w-3 h-3" aria-hidden /> Cada cambio queda registrado
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
      <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">{label}</label>
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
      className={`px-3 py-1.5 text-xs font-medium rounded-[8px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-[color:var(--pr-activo)] border-[color:var(--pr-activo)] text-[color:var(--pr-activo-texto)]"
          : "border-[color:var(--pr-borde)] text-[color:var(--pr-texto-2)] hover:bg-[color:var(--pr-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

const inputCls =
  orto.entrada;
