"use client";
// DrawerNewCase — Ola 1 (ws1-t6), «Alta del caso»: el asistente de alta
// DENTRO de la ficha nueva (reemplaza el puente a la vista antigua S1).
//
// Dos escenarios, según si el paciente ya tiene diagnóstico:
//   - Sin diagnóstico: captura diagnóstico + (plan de tratamiento O paciente
//     en observación, A12) — un caso en observación no lleva plan todavía.
//   - Con diagnóstico (sin plan): solo captura el plan de tratamiento, con
//     doctor tratante (A5) y responsable del pago (A11).
//
// Las opciones de doctores/tutores/referentes se piden en caliente a
// getCaseIntakeOptions (server action de solo lectura) — mismo patrón que
// DiagnosisWizard/TreatmentPlanWizard llamando acciones directo desde un
// componente cliente.

import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { getCaseIntakeOptions } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import orto from "../orto.module.css";

const ANGLE_OPTIONS = [
  { v: "CLASS_I", l: "Clase I" },
  { v: "CLASS_II_DIV_1", l: "Clase II div. 1" },
  { v: "CLASS_II_DIV_2", l: "Clase II div. 2" },
  { v: "CLASS_III", l: "Clase III" },
  { v: "ASYMMETRIC", l: "Asimétrica" },
] as const;

const DENTAL_PHASE_OPTIONS = [
  { v: "DECIDUOUS", l: "Dentición temporal" },
  { v: "MIXED_EARLY", l: "Mixta temprana" },
  { v: "MIXED_LATE", l: "Mixta tardía" },
  { v: "PERMANENT", l: "Permanente" },
] as const;

const TECHNIQUE_OPTIONS = [
  { v: "METAL_BRACKETS", l: "Brackets metálicos" },
  { v: "CERAMIC_BRACKETS", l: "Brackets estéticos (cerámicos)" },
  { v: "SELF_LIGATING_METAL", l: "Autoligado metálico" },
  { v: "SELF_LIGATING_CERAMIC", l: "Autoligado estético" },
  { v: "LINGUAL_BRACKETS", l: "Brackets linguales" },
  { v: "CLEAR_ALIGNERS", l: "Alineadores transparentes" },
  { v: "HYBRID", l: "Mixto" },
] as const;

const ANCHORAGE_OPTIONS = [
  { v: "MAXIMUM", l: "Máximo" },
  { v: "MODERATE", l: "Moderado" },
  { v: "MINIMUM", l: "Mínimo" },
  { v: "COMPOUND", l: "Compuesto" },
] as const;

const OBJECTIVE_OPTIONS = [
  { v: "AESTHETIC_ONLY", l: "Solo estético" },
  { v: "FUNCTIONAL_ONLY", l: "Solo funcional" },
  { v: "AESTHETIC_AND_FUNCTIONAL", l: "Estético y funcional" },
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

const DEFAULT_RETENTION =
  "Retenedor fijo lingual 3-3 inferior + retenedor removible Hawley superior. " +
  "24 horas por 6 meses, luego nocturno permanente.";

export interface DrawerNewCaseDiagnosisPayload {
  angleClassRight: string;
  angleClassLeft: string;
  overbiteMm: number;
  overbitePercentage: number;
  overjetMm: number;
  crowdingUpperMm: number | null;
  crowdingLowerMm: number | null;
  crossbite: boolean;
  crossbiteDetails: string | null;
  openBite: boolean;
  openBiteDetails: string | null;
  dentalPhase: string;
  tmjPainPresent: boolean;
  tmjClickingPresent: boolean;
  clinicalSummary: string;
  referredByDoctorId: string | null;
  inObservation: boolean;
  nextObservationDate: string | null;
}

export interface DrawerNewCasePlanPayload {
  technique: string;
  estimatedDurationMonths: number;
  installedAt: string | null;
  /**
   * Precio de referencia al abrir el caso — todavía no hay factura (el caso
   * se crea aquí, la factura la abre Cobro DESPUÉS, "Abrir plan de pago").
   * Revisión cruzada (ver REPORTE-ws1-t1.md): cuando exista
   * `orthodonticTreatmentPlan.invoiceId`, el número que cuenta es
   * `invoice.total`, no este campo — no hay forma de sincronizarlos aquí
   * porque en este drawer la factura todavía no existe.
   */
  totalCostMxn: number;
  anchorageType: string;
  extractionsRequired: boolean;
  iprRequired: boolean;
  tadsRequired: boolean;
  treatmentObjectives: string;
  retentionPlanText: string;
  treatingDoctorId: string | null;
  responsibleGuardianId: string | null;
  newResponsibleGuardian: { fullName: string; phone: string; parentesco: string } | null;
}

export interface DrawerNewCaseProps {
  patientId: string;
  patientFullName: string;
  /** Si ya hay diagnóstico, este drawer solo pide el plan de tratamiento. */
  existingDiagnosisId: string | null;
  onClose: () => void;
  onConfirm: (payload: {
    diagnosis: DrawerNewCaseDiagnosisPayload | null;
    plan: DrawerNewCasePlanPayload | null;
  }) => Promise<void> | void;
}

export function DrawerNewCase(props: DrawerNewCaseProps) {
  const needsDiagnosis = !props.existingDiagnosisId;

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [doctors, setDoctors] = useState<Array<{ id: string; fullName: string }>>([]);
  const [guardians, setGuardians] = useState<
    Array<{ id: string; fullName: string; parentesco: string; phone: string }>
  >([]);
  const [referringDoctors, setReferringDoctors] = useState<
    Array<{ id: string; fullName: string; clinicName: string | null }>
  >([]);
  // A5/A11 — igual que en DrawerCaseSettings: si el SQL aún no está pegado,
  // se sabe ANTES de elegir doctor/responsable, no después de guardar.
  const [columnsExist, setColumnsExist] = useState({ treatingDoctorId: true, responsibleGuardianId: true });

  useEffect(() => {
    let cancelled = false;
    getCaseIntakeOptions({ patientId: props.patientId }).then((res) => {
      if (cancelled || isFailure(res)) return;
      setDoctors(res.data.doctors);
      setGuardians(res.data.guardians);
      setReferringDoctors(res.data.referringDoctors);
      setColumnsExist(res.data.columnsExist);
    }).finally(() => {
      if (!cancelled) setLoadingOptions(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.patientId]);

  // ── Diagnóstico ──────────────────────────────────────────────────────
  const [angleR, setAngleR] = useState("CLASS_I");
  const [angleL, setAngleL] = useState("CLASS_I");
  const [overbiteMm, setOverbiteMm] = useState(2);
  const [overbitePct, setOverbitePct] = useState(20);
  const [overjetMm, setOverjetMm] = useState(2);
  const [crowdU, setCrowdU] = useState(0);
  const [crowdL, setCrowdL] = useState(0);
  const [crossbite, setCrossbite] = useState(false);
  const [crossbiteDetails, setCrossbiteDetails] = useState("");
  const [openBite, setOpenBite] = useState(false);
  const [openBiteDetails, setOpenBiteDetails] = useState("");
  const [dentalPhase, setDentalPhase] = useState("PERMANENT");
  const [tmjPain, setTmjPain] = useState(false);
  const [tmjClick, setTmjClick] = useState(false);
  const [summary, setSummary] = useState("");
  const [referredByDoctorId, setReferredByDoctorId] = useState("");
  const [inObservation, setInObservation] = useState(false);
  const [nextObservationDate, setNextObservationDate] = useState("");

  // ── Plan de tratamiento ──────────────────────────────────────────────
  const [technique, setTechnique] = useState("METAL_BRACKETS");
  const [duration, setDuration] = useState(18);
  const [installedAt, setInstalledAt] = useState("");
  const [totalCost, setTotalCost] = useState(45000);
  const [anchorage, setAnchorage] = useState("MODERATE");
  const [extractions, setExtractions] = useState(false);
  const [iprRequired, setIprRequired] = useState(false);
  const [tadsRequired, setTadsRequired] = useState(false);
  const [objectives, setObjectives] = useState("AESTHETIC_AND_FUNCTIONAL");
  const [retention, setRetention] = useState(DEFAULT_RETENTION);
  const [treatingDoctorId, setTreatingDoctorId] = useState("");
  const [guardianMode, setGuardianMode] = useState<"none" | "existing" | "new">("none");
  const [responsibleGuardianId, setResponsibleGuardianId] = useState("");
  const [newGuardianName, setNewGuardianName] = useState("");
  const [newGuardianPhone, setNewGuardianPhone] = useState("");
  const [newGuardianRelation, setNewGuardianRelation] = useState("madre");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaryValid = summary.trim().length >= 40;
  const retentionValid = retention.trim().length >= 20;
  const observationValid = !inObservation || nextObservationDate.length > 0;
  const guardianValid =
    guardianMode !== "new" || (newGuardianName.trim().length >= 2 && newGuardianPhone.trim().length >= 7);

  const canSubmit =
    (!needsDiagnosis || (summaryValid && observationValid)) &&
    (inObservation || (retentionValid && guardianValid));

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const diagnosis: DrawerNewCaseDiagnosisPayload | null = needsDiagnosis
        ? {
            angleClassRight: angleR,
            angleClassLeft: angleL,
            overbiteMm,
            overbitePercentage: overbitePct,
            overjetMm,
            crowdingUpperMm: crowdU || null,
            crowdingLowerMm: crowdL || null,
            crossbite,
            crossbiteDetails: crossbite ? crossbiteDetails || null : null,
            openBite,
            openBiteDetails: openBite ? openBiteDetails || null : null,
            dentalPhase,
            tmjPainPresent: tmjPain,
            tmjClickingPresent: tmjClick,
            clinicalSummary: summary.trim(),
            referredByDoctorId: referredByDoctorId || null,
            inObservation,
            nextObservationDate:
              inObservation && nextObservationDate
                ? new Date(nextObservationDate).toISOString()
                : null,
          }
        : null;

      const plan: DrawerNewCasePlanPayload | null = inObservation
        ? null
        : {
            technique,
            estimatedDurationMonths: duration,
            installedAt: installedAt ? new Date(installedAt).toISOString() : null,
            totalCostMxn: totalCost,
            anchorageType: anchorage,
            extractionsRequired: extractions,
            iprRequired,
            tadsRequired,
            treatmentObjectives: objectives,
            retentionPlanText: retention.trim(),
            treatingDoctorId: treatingDoctorId || null,
            responsibleGuardianId: guardianMode === "existing" ? responsibleGuardianId || null : null,
            newResponsibleGuardian:
              guardianMode === "new"
                ? {
                    fullName: newGuardianName.trim(),
                    phone: newGuardianPhone.trim(),
                    parentesco: newGuardianRelation,
                  }
                : null,
          };

      await props.onConfirm({ diagnosis, plan });
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
        className={`${orto.cajon} ${orto.cajonAncho}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-case-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>
              Abrir caso de ortodoncia
            </div>
            <h3 id="new-case-title" className={orto.cajonTitulo}>
              {needsDiagnosis ? "Diagnóstico y plan · " : "Plan de tratamiento · "}
              {props.patientFullName}
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loadingOptions ? (
            <div className="flex items-center gap-2 text-xs text-[color:var(--pr-texto-3)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando doctores y tutores…
            </div>
          ) : null}

          {needsDiagnosis ? (
            <section className="space-y-4">
              <SectionTitle>Diagnóstico ortodóntico</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Angle derecha">
                  <Select value={angleR} onChange={setAngleR} options={ANGLE_OPTIONS} />
                </Field>
                <Field label="Angle izquierda">
                  <Select value={angleL} onChange={setAngleL} options={ANGLE_OPTIONS} />
                </Field>
                <Field label="Overbite (mm)">
                  <NumberInput value={overbiteMm} onChange={setOverbiteMm} step={0.5} min={-10} max={15} />
                </Field>
                <Field label="Overbite (%)">
                  <NumberInput value={overbitePct} onChange={setOverbitePct} step={1} min={0} max={100} />
                </Field>
                <Field label="Overjet (mm)">
                  <NumberInput value={overjetMm} onChange={setOverjetMm} step={0.5} min={-5} max={20} />
                </Field>
                <Field label="Fase dental">
                  <Select value={dentalPhase} onChange={setDentalPhase} options={DENTAL_PHASE_OPTIONS} />
                </Field>
                <Field label="Apiñamiento sup. (mm)">
                  <NumberInput value={crowdU} onChange={setCrowdU} step={0.5} min={0} max={20} />
                </Field>
                <Field label="Apiñamiento inf. (mm)">
                  <NumberInput value={crowdL} onChange={setCrowdL} step={0.5} min={0} max={20} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mordida cruzada">
                  <Checkbox label="Presente" checked={crossbite} onChange={setCrossbite} />
                </Field>
                <Field label="Mordida abierta">
                  <Checkbox label="Presente" checked={openBite} onChange={setOpenBite} />
                </Field>
              </div>
              {crossbite ? (
                <Field label="Detalles mordida cruzada">
                  <input value={crossbiteDetails} onChange={(e) => setCrossbiteDetails(e.target.value)} className={inputCls} placeholder="lateral derecha 15-45" />
                </Field>
              ) : null}
              {openBite ? (
                <Field label="Detalles mordida abierta">
                  <input value={openBiteDetails} onChange={(e) => setOpenBiteDetails(e.target.value)} className={inputCls} />
                </Field>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dolor ATM">
                  <Checkbox label="Presente" checked={tmjPain} onChange={setTmjPain} />
                </Field>
                <Field label="Chasquido ATM">
                  <Checkbox label="Presente" checked={tmjClick} onChange={setTmjClick} />
                </Field>
              </div>
              <Field label="Resumen clínico (mín. 40 caracteres)">
                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={`${inputCls} min-h-[90px]`} placeholder="Clase, problema principal, etiología, plan general…" />
                <div className={`text-[11px] mt-1 ${summaryValid ? "text-[color:var(--pr-exito)]" : "text-[color:var(--pr-alerta)]"}`}>
                  {summary.trim().length} / 40 mínimo
                </div>
              </Field>

              <div className="pt-2 border-t border-[color:var(--pr-borde-suave)] space-y-3">
                <div className={orto.ceja}>
                  Origen del paciente
                </div>
                <Field label="Quién lo refirió (opcional)">
                  <select value={referredByDoctorId} onChange={(e) => setReferredByDoctorId(e.target.value)} className={inputCls}>
                    <option value="">— sin referente —</option>
                    {referringDoctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName}{d.clinicName ? ` · ${d.clinicName}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="pt-2 border-t border-[color:var(--pr-borde-suave)] space-y-3">
                <label className="flex items-start gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
                  <input type="checkbox" checked={inObservation} onChange={(e) => setInObservation(e.target.checked)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">Paciente en observación</span>
                    <br />
                    <span className="text-xs text-[color:var(--pr-texto-3)]">
                      Aún no inicia tratamiento: se revisa periódicamente hasta que convenga empezar. No se
                      abre plan de tratamiento todavía.
                    </span>
                  </span>
                </label>
                {inObservation ? (
                  <Field label="Próxima revisión">
                    <input type="date" value={nextObservationDate} onChange={(e) => setNextObservationDate(e.target.value)} className={inputCls} />
                  </Field>
                ) : null}
              </div>
            </section>
          ) : null}

          {!inObservation ? (
            <section className="space-y-4">
              <SectionTitle>Plan de tratamiento</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Aparatología">
                  <Select value={technique} onChange={setTechnique} options={TECHNIQUE_OPTIONS} />
                </Field>
                <Field label="Duración estimada (meses)">
                  <NumberInput value={duration} onChange={setDuration} step={1} min={3} max={60} />
                </Field>
                <Field label="Fecha de colocación (opcional)">
                  <input type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} className={inputCls} />
                </Field>
                <Field
                  label="Costo total (MXN)"
                  hint="Precio de referencia para abrir el caso. El monto que de verdad se cobra es el de la factura del tratamiento («Cobro del tratamiento» → «Abrir plan de pago»): confírmalo ahí antes de firmar el acuerdo con el paciente."
                >
                  <NumberInput value={totalCost} onChange={setTotalCost} step={100} min={1} max={1_000_000} />
                </Field>
                <Field label="Anclaje">
                  <Select value={anchorage} onChange={setAnchorage} options={ANCHORAGE_OPTIONS} />
                </Field>
                <Field label="Objetivos">
                  <Select value={objectives} onChange={setObjectives} options={OBJECTIVE_OPTIONS} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Checkbox label="Extracciones" checked={extractions} onChange={setExtractions} />
                <Checkbox label="Requiere IPR" checked={iprRequired} onChange={setIprRequired} />
                <Checkbox label="Requiere TADs" checked={tadsRequired} onChange={setTadsRequired} />
              </div>
              <Field label="Plan de retención (mín. 20 caracteres)">
                <textarea value={retention} onChange={(e) => setRetention(e.target.value)} className={`${inputCls} min-h-[70px]`} />
                <div className={`text-[11px] mt-1 ${retentionValid ? "text-[color:var(--pr-exito)]" : "text-[color:var(--pr-alerta)]"}`}>
                  {retention.trim().length} / 20 mínimo
                </div>
              </Field>

              <div className="pt-2 border-t border-[color:var(--pr-borde-suave)] space-y-3">
                <div className={orto.ceja}>
                  Doctor tratante
                </div>
                <Field label="Quién lleva el caso">
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
                </Field>
                {!columnsExist.treatingDoctorId ? (
                  <p className="text-[11px] text-[color:var(--pr-alerta)]">
                    Falta pegar el SQL de la Ola 0 (sql/ortodoncia-nucleo.sql) — no se puede asignar todavía.
                  </p>
                ) : null}
              </div>

              <div className="pt-2 border-t border-[color:var(--pr-borde-suave)] space-y-3">
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
                  <GuardianModeButton active={guardianMode === "none"} onClick={() => setGuardianMode("none")}>Sin definir</GuardianModeButton>
                  <GuardianModeButton active={guardianMode === "existing"} onClick={() => setGuardianMode("existing")} disabled={!columnsExist.responsibleGuardianId || guardians.length === 0}>Tutor registrado</GuardianModeButton>
                  <GuardianModeButton active={guardianMode === "new"} onClick={() => setGuardianMode("new")} disabled={!columnsExist.responsibleGuardianId}>Nuevo</GuardianModeButton>
                </div>
                {guardianMode === "existing" ? (
                  <Field label="Tutor">
                    <select value={responsibleGuardianId} onChange={(e) => setResponsibleGuardianId(e.target.value)} className={inputCls}>
                      <option value="">— elegir —</option>
                      {guardians.map((g) => (
                        <option key={g.id} value={g.id}>{g.fullName} · {g.parentesco} · {g.phone}</option>
                      ))}
                    </select>
                  </Field>
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
                      <Select value={newGuardianRelation} onChange={setNewGuardianRelation} options={GUARDIAN_RELATION_OPTIONS} />
                    </Field>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {error ? (
            <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] text-[color:var(--pr-peligro)] text-xs rounded-[8px] p-2">
              {error}
            </div>
          ) : null}
        </div>

        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" aria-hidden /> Queda dentro de la ficha del paciente
          </span>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn variant="primary" size="md" onClick={submit} disabled={!canSubmit || submitting}>
              {submitting ? "Guardando…" : inObservation ? "Guardar en observación" : "Abrir caso"}
            </Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className={orto.ceja}>
      {children}
    </h4>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-[color:var(--pr-texto-3)]">{hint}</p> : null}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ v: string; l: string }>;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.l}</option>
      ))}
    </select>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className={inputCls}
    />
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-[color:var(--pr-texto-2)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function GuardianModeButton({
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
