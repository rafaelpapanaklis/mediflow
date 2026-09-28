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
//
// 28-sep-2026 (ws1-t3, H18 de la QA en vivo). Tres arreglos, con sus reglas en
// `src/lib/orthodontics/alta-caso-formulario.ts` (puro, con tests):
//   (a) el teléfono del responsable dice que es obligatorio y por qué, y junto
//       al botón sale lo que falta cuando está gris;
//   (b) «Quién lo refirió» deja agregar un referente ahí mismo;
//   (c) el costo nace VACÍO: antes traía 45000 escrito en el código.

import { useEffect, useId, useState } from "react";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { getCaseIntakeOptions } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { createDoctorContact } from "@/app/actions/clinical-shared/referrals";
import { isFailure as referenteFallo } from "@/lib/clinical-shared/result";
import { ORTHO_BILLING_MODE_DEFAULT, type OrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import {
  MOTIVO_TELEFONO_TUTOR,
  errorReferenteNuevo,
  errorTelefonoTutor,
  faltantesDelAlta,
  fraseDeFaltantes,
  leerCostoTotal,
  referenteParaGuardar,
  referenteYaRegistrado,
  textosDelCosto,
  type ModoResponsable,
} from "@/lib/orthodontics/alta-caso-formulario";
import { useCajon } from "../atoms/useCajon";
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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
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
  const [billingMode, setBillingMode] = useState<OrthoBillingMode>(ORTHO_BILLING_MODE_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    getCaseIntakeOptions({ patientId: props.patientId }).then((res) => {
      if (cancelled || isFailure(res)) return;
      setDoctors(res.data.doctors);
      setGuardians(res.data.guardians);
      setReferringDoctors(res.data.referringDoctors);
      setColumnsExist(res.data.columnsExist);
      setBillingMode(res.data.billingMode);
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
  // (b) Agregar un referente sin salir del alta.
  const [agregandoReferente, setAgregandoReferente] = useState(false);
  const [referenteNuevo, setReferenteNuevo] = useState({ fullName: "", clinicName: "", phone: "" });
  const [guardandoReferente, setGuardandoReferente] = useState(false);
  const [errorReferente, setErrorReferente] = useState<string | null>(null);
  const [inObservation, setInObservation] = useState(false);
  const [nextObservationDate, setNextObservationDate] = useState("");

  // ── Plan de tratamiento ──────────────────────────────────────────────
  const [technique, setTechnique] = useState("METAL_BRACKETS");
  const [duration, setDuration] = useState(18);
  const [installedAt, setInstalledAt] = useState("");
  // (c) Vacío a propósito: el precio lo escribe la clínica, no el código.
  const [totalCost, setTotalCost] = useState("");
  const [anchorage, setAnchorage] = useState("MODERATE");
  const [extractions, setExtractions] = useState(false);
  const [iprRequired, setIprRequired] = useState(false);
  const [tadsRequired, setTadsRequired] = useState(false);
  const [objectives, setObjectives] = useState("AESTHETIC_AND_FUNCTIONAL");
  const [retention, setRetention] = useState(DEFAULT_RETENTION);
  const [treatingDoctorId, setTreatingDoctorId] = useState("");
  const [guardianMode, setGuardianMode] = useState<ModoResponsable>("none");
  const [responsibleGuardianId, setResponsibleGuardianId] = useState("");
  const [newGuardianName, setNewGuardianName] = useState("");
  const [newGuardianPhone, setNewGuardianPhone] = useState("");
  const [newGuardianRelation, setNewGuardianRelation] = useState("madre");
  const idTelefonoTutor = useId();
  const idCosto = useId();
  const idFaltantes = useId();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaryValid = summary.trim().length >= 40;
  const retentionValid = retention.trim().length >= 20;
  const costo = leerCostoTotal(totalCost);
  const textosCosto = textosDelCosto(billingMode);
  const errorTelefono = errorTelefonoTutor(newGuardianPhone);

  // Lo que falta, dicho para quien llena el formulario: es lo que decide si
  // el botón se puede pulsar Y lo que se pinta junto a él cuando no.
  const faltantes = faltantesDelAlta({
    necesitaDiagnostico: needsDiagnosis,
    enObservacion: inObservation,
    resumen: summary,
    proximaRevision: nextObservationDate,
    retencion: retention,
    costoTotal: totalCost,
    modoResponsable: guardianMode,
    tutorElegidoId: responsibleGuardianId,
    tutorNombre: newGuardianName,
    tutorTelefono: newGuardianPhone,
  });
  const fraseFaltantes = fraseDeFaltantes(faltantes, inObservation);
  const canSubmit = faltantes.length === 0;

  const guardarReferente = async () => {
    const problema = errorReferenteNuevo(referenteNuevo);
    if (problema) {
      setErrorReferente(problema);
      return;
    }
    // Si ya está en la lista, se elige ese: no se guarda dos veces.
    const repetido = referenteYaRegistrado(referringDoctors, referenteNuevo.fullName);
    if (repetido) {
      setReferredByDoctorId(repetido.id);
      setAgregandoReferente(false);
      setReferenteNuevo({ fullName: "", clinicName: "", phone: "" });
      setErrorReferente(null);
      return;
    }
    setGuardandoReferente(true);
    setErrorReferente(null);
    try {
      const datos = referenteParaGuardar(referenteNuevo);
      const res = await createDoctorContact(datos);
      if (referenteFallo(res)) {
        setErrorReferente(res.error || "No se pudo guardar el referente. Intenta de nuevo.");
        return;
      }
      setReferringDoctors((lista) =>
        [...lista, { id: res.data.id, fullName: datos.fullName, clinicName: datos.clinicName }].sort((a, b) =>
          a.fullName.localeCompare(b.fullName, "es"),
        ),
      );
      setReferredByDoctorId(res.data.id);
      setAgregandoReferente(false);
      setReferenteNuevo({ fullName: "", clinicName: "", phone: "" });
    } catch {
      setErrorReferente("No se pudo guardar el referente. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setGuardandoReferente(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    // Sin plan (observación) no hay costo; con plan, `faltantes` ya lo exigió.
    if (!inObservation && costo === null) return;
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
            totalCostMxn: costo as number,
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
        ref={cajonRef}
        tabIndex={-1}
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
                <Field
                  label="Quién lo refirió (opcional)"
                  hint={
                    referringDoctors.length === 0 && !agregandoReferente && !loadingOptions
                      ? "Aún no hay referentes registrados en la clínica. Agrega el primero aquí mismo."
                      : undefined
                  }
                >
                  <div className="flex gap-2">
                    <select
                      value={referredByDoctorId}
                      onChange={(e) => setReferredByDoctorId(e.target.value)}
                      className={inputCls}
                      aria-label="Quién lo refirió"
                    >
                      <option value="">— sin referente —</option>
                      {referringDoctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.fullName}{d.clinicName ? ` · ${d.clinicName}` : ""}
                        </option>
                      ))}
                    </select>
                    {!agregandoReferente ? (
                      <Btn
                        variant="secondary"
                        size="md"
                        className="shrink-0"
                        icon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
                        onClick={() => {
                          setAgregandoReferente(true);
                          setErrorReferente(null);
                        }}
                      >
                        Agregar
                      </Btn>
                    ) : null}
                  </div>
                </Field>
                {agregandoReferente ? (
                  <div
                    className="rounded-[10px] border border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta-2)] p-3 space-y-3"
                    role="group"
                    aria-label="Nuevo referente"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Nombre de quien lo refirió">
                        <input
                          autoFocus
                          value={referenteNuevo.fullName}
                          onChange={(e) => setReferenteNuevo({ ...referenteNuevo, fullName: e.target.value })}
                          className={inputCls}
                          placeholder="Ej. Dra. Laura Méndez"
                          maxLength={120}
                        />
                      </Field>
                      <Field label="Consultorio o clínica (opcional)">
                        <input
                          value={referenteNuevo.clinicName}
                          onChange={(e) => setReferenteNuevo({ ...referenteNuevo, clinicName: e.target.value })}
                          className={inputCls}
                          maxLength={120}
                        />
                      </Field>
                      <Field label="Teléfono (opcional)">
                        <input
                          type="tel"
                          inputMode="tel"
                          value={referenteNuevo.phone}
                          onChange={(e) => setReferenteNuevo({ ...referenteNuevo, phone: e.target.value })}
                          className={inputCls}
                          maxLength={40}
                        />
                      </Field>
                    </div>
                    {errorReferente ? (
                      <p className="text-[11.5px] text-[color:var(--pr-peligro)]" role="alert">
                        {errorReferente}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <Btn variant="primary" size="sm" onClick={guardarReferente} disabled={guardandoReferente}>
                        {guardandoReferente ? "Guardando…" : "Guardar referente"}
                      </Btn>
                      <Btn
                        variant="ghost"
                        size="sm"
                        disabled={guardandoReferente}
                        onClick={() => {
                          setAgregandoReferente(false);
                          setErrorReferente(null);
                        }}
                      >
                        Cancelar
                      </Btn>
                      <span className="text-[11px] text-[color:var(--pr-texto-3)]">
                        Queda en el directorio de la clínica para los siguientes casos.
                      </span>
                    </div>
                  </div>
                ) : null}
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
                <Field label={textosCosto.rotulo} hint={textosCosto.pista} htmlFor={idCosto}>
                  <input
                    id={idCosto}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={totalCost}
                    onChange={(e) => setTotalCost(e.target.value)}
                    placeholder="Escribe el importe"
                    aria-invalid={totalCost.trim() !== "" && costo === null}
                    className={inputCls}
                  />
                  {totalCost.trim() !== "" && costo === null ? (
                    <p className="mt-1 text-[11px] text-[color:var(--pr-peligro)]" role="alert">
                      Escribe solo el importe, mayor que cero. Por ejemplo: 36000.
                    </p>
                  ) : null}
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
                    <Field label="Nombre completo (obligatorio)">
                      <input value={newGuardianName} onChange={(e) => setNewGuardianName(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Teléfono (obligatorio)" hint={MOTIVO_TELEFONO_TUTOR} htmlFor={idTelefonoTutor}>
                      <input
                        id={idTelefonoTutor}
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        required
                        value={newGuardianPhone}
                        onChange={(e) => setNewGuardianPhone(e.target.value)}
                        placeholder="10 dígitos"
                        aria-invalid={errorTelefono !== null}
                        className={inputCls}
                      />
                      {errorTelefono ? (
                        <p className="mt-1 text-[11px] text-[color:var(--pr-peligro)]" role="alert">
                          {errorTelefono}
                        </p>
                      ) : null}
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
          {fraseFaltantes ? (
            // (a) El botón gris ya no es un misterio: aquí dice qué falta.
            <span id={idFaltantes} className="text-[11.5px] leading-snug text-[color:var(--pr-alerta)]" role="status">
              {fraseFaltantes}
            </span>
          ) : (
            <span className="text-[11px] text-[color:var(--pr-texto-3)] inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" aria-hidden /> Queda dentro de la ficha del paciente
            </span>
          )}
          <div className="flex gap-2 shrink-0">
            <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
            <Btn
              variant="primary"
              size="md"
              onClick={submit}
              disabled={!canSubmit || submitting}
              aria-describedby={fraseFaltantes ? idFaltantes : undefined}
            >
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

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** El `id` del campo, para que pulsar el rótulo lo enfoque y el lector de pantalla los una. */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">{label}</label>
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
