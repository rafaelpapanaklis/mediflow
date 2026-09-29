"use client";
// Orthodontics — wizard de plan de tratamiento 3 pasos. SPEC §6.6.

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { WizardShell } from "../shared/WizardShell";
import { createTreatmentPlan, getCaseIntakeOptions } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { DateField } from "@/components/ui/date-field";
import { costoAProponer } from "@/lib/orthodontics/precios-por-tecnica";
import { leerCostoTotal } from "@/lib/orthodontics/alta-caso-formulario";
import { nombrePropioAGuardar, tecnicasDeSiempre, type TecnicaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import { EJEMPLO_DE_RETENCION } from "@/lib/orthodontics/retencion-ejemplo";
import {
  MENSAJE_FALTA_DOCTOR,
  motivoFaltaDoctor,
  textoDeLaPropuesta,
  type MotivoDeLaPropuesta,
} from "@/lib/orthodontics/doctores-tratantes";
import type {
  AnchorageType,
  OrthoTechnique,
  TreatmentObjective,
} from "@prisma/client";

export interface TreatmentPlanWizardProps {
  patientId: string;
  diagnosisId: string;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

const ANCHORAGE_OPTIONS: AnchorageType[] = [
  "MAXIMUM",
  "MODERATE",
  "MINIMUM",
  "COMPOUND",
];

const OBJECTIVE_OPTIONS: TreatmentObjective[] = [
  "AESTHETIC_ONLY",
  "FUNCTIONAL_ONLY",
  "AESTHETIC_AND_FUNCTIONAL",
];

export function TreatmentPlanWizard(props: TreatmentPlanWizardProps) {
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);

  // ws1-t10: técnicas de la clínica (activas, por su nombre); el tipo base viaja en `technique`.
  const [tecnicas, setTecnicas] = useState<TecnicaClinica[]>(() => tecnicasDeSiempre());
  const [tecnicaId, setTecnicaId] = useState("METAL_BRACKETS");
  const tecnica = tecnicas.find((x) => x.id === tecnicaId) ?? tecnicas[0] ?? null;
  const technique: OrthoTechnique = tecnica?.base ?? "METAL_BRACKETS";
  const [techniqueNotes, setTechniqueNotes] = useState("");
  const [duration, setDuration] = useState(18);
  const [installedAt, setInstalledAt] = useState("");
  // (d) Vacío a propósito: el precio lo pone la clínica (Configuración → Técnicas y precios), no el código.
  // Se PROPONE con el de la técnica elegida —misma regla que el alta nueva— sin pisar lo que se tecleó.
  const [totalCost, setTotalCost] = useState("");
  const costoSugeridoRef = useRef<string | null>(null);
  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;

  const [anchorage, setAnchorage] = useState<AnchorageType>("MODERATE");
  const [anchorageNotes, setAnchorageNotes] = useState("");
  const [extractions, setExtractions] = useState(false);
  const [extractFdi, setExtractFdi] = useState("");
  const [iprRequired, setIprRequired] = useState(false);
  const [tadsRequired, setTadsRequired] = useState(false);
  const [objectives, setObjectives] = useState<TreatmentObjective>("AESTHETIC_AND_FUNCTIONAL");
  const [patientGoals, setPatientGoals] = useState("");

  const [retention, setRetention] = useState("");

  // ws1-t10: el doctor tratante arranca con quien abre el caso (si es doctor con acceso a
  // Ortodoncia) o con el único de la sede; si no hay, se elige aquí y no se avanza sin él.
  const [doctors, setDoctors] = useState<Array<{ id: string; fullName: string }>>([]);
  const [treatingDoctorId, setTreatingDoctorId] = useState("");
  const [motivoPropuesta, setMotivoPropuesta] = useState<MotivoDeLaPropuesta | null>(null);
  const [columnaDoctor, setColumnaDoctor] = useState(true);
  const sinDoctor = motivoFaltaDoctor({ treatingDoctorId, columnaExiste: columnaDoctor }) !== null;

  useEffect(() => {
    let cancelado = false;
    getCaseIntakeOptions({ patientId: props.patientId }).then((res) => {
      if (cancelado || isFailure(res)) return;
      setTecnicas(res.data.tecnicas);
      setTecnicaId((actual) => (res.data.tecnicas.some((x) => x.id === actual) ? actual : (res.data.tecnicas[0]?.id ?? "")));
      setDoctors(res.data.doctors);
      setColumnaDoctor(res.data.columnsExist.treatingDoctorId);
      if (res.data.columnsExist.treatingDoctorId && res.data.suggestedTreatingDoctorId) {
        setMotivoPropuesta(res.data.suggestedTreatingDoctorReason);
        setTreatingDoctorId((actual) => actual || res.data.suggestedTreatingDoctorId);
      }
    });
    return () => {
      cancelado = true;
    };
  }, [props.patientId]);

  useEffect(() => {
    const nuevo = costoAProponer({ actual: totalCostRef.current, ultimoSugerido: costoSugeridoRef.current, precio: tecnica?.precio ?? null, hayPresupuesto: false });
    if (nuevo === null) return;
    costoSugeridoRef.current = nuevo === "" ? null : nuevo;
    setTotalCost(nuevo);
  }, [tecnica]);

  const costo = leerCostoTotal(totalCost);
  const canProceed = step === 3 ? retention.length >= 20 && !sinDoctor : step === 1 ? tecnica !== null && costo !== null : true;

  const submit = async () => {
    setPending(true);
    try {
      const fdi = extractFdi
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 11 && n <= 48);
      const result = await createTreatmentPlan({
        diagnosisId: props.diagnosisId,
        patientId: props.patientId,
        technique,
        techniqueLabel: nombrePropioAGuardar(tecnica),
        techniqueNotes: techniqueNotes || null,
        estimatedDurationMonths: duration,
        installedAt: installedAt ? new Date(installedAt).toISOString() : null,
        totalCostMxn: costo as number,
        anchorageType: anchorage,
        anchorageNotes: anchorageNotes || null,
        extractionsRequired: extractions,
        extractionsTeethFdi: fdi,
        iprRequired,
        tadsRequired,
        treatmentObjectives: objectives,
        patientGoals: patientGoals || null,
        retentionPlanText: retention,
        treatingDoctorId: treatingDoctorId || null,
      });
      if (isFailure(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan creado");
      props.onCreated?.(result.data.id);
      props.onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <WizardShell
      title="Plan de tratamiento ortodóntico"
      step={step}
      totalSteps={3}
      onClose={props.onClose}
      onPrev={() => setStep((s) => Math.max(1, s - 1))}
      onNext={() => setStep((s) => Math.min(3, s + 1))}
      onSubmit={submit}
      pending={pending}
      canProceed={canProceed}
    >
      {step === 1 ? (
        <Section title="Técnica + duración + costo">
          <Row label="Técnica">
            {tecnicas.length > 0 ? (
              <select
                value={tecnica?.id ?? ""}
                onChange={(e) => setTecnicaId(e.target.value)}
                style={inputStyle}
              >
                {tecnicas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: 12, color: "#F59E0B" }}>
                La clínica no tiene técnicas activas. Agrégalas en Configuración → Técnicas y precios.
              </span>
            )}
          </Row>
          <Row label="Notas de técnica">
            <textarea value={techniqueNotes} onChange={(e) => setTechniqueNotes(e.target.value)} rows={2} style={textareaStyle} />
          </Row>
          <Row label="Duración estimada (meses, 3-60)">
            <NumberInput value={duration} onChange={setDuration} min={3} max={60} step={1} />
          </Row>
          <Row label="Fecha de instalación (opcional)">
            <DateField value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} style={inputStyle} />
          </Row>
          <Row label="Costo total MXN">
            <input value={totalCost} onChange={(e) => setTotalCost(e.target.value)} inputMode="decimal" placeholder="Sin precio: escríbelo" aria-invalid={costo === null} style={inputStyle} />
          </Row>
        </Section>
      ) : null}

      {step === 2 ? (
        <Section title="Anclaje + extracciones + objetivos">
          <Row label="Tipo de anclaje">
            <Select value={anchorage} onChange={(v) => setAnchorage(v as AnchorageType)} options={ANCHORAGE_OPTIONS} />
          </Row>
          <Row label="Notas anclaje">
            <textarea value={anchorageNotes} onChange={(e) => setAnchorageNotes(e.target.value)} rows={2} style={textareaStyle} />
          </Row>
          <Toggle label="Extracciones requeridas" value={extractions} onChange={setExtractions} />
          {extractions ? (
            <Row label="FDI dientes a extraer (separados por coma)">
              <input
                value={extractFdi}
                onChange={(e) => setExtractFdi(e.target.value)}
                placeholder="14, 24"
                style={inputStyle}
              />
            </Row>
          ) : null}
          <Toggle label="IPR requerido" value={iprRequired} onChange={setIprRequired} />
          <Toggle label="TADs requeridos" value={tadsRequired} onChange={setTadsRequired} />
          <Row label="Objetivos">
            <Select value={objectives} onChange={(v) => setObjectives(v as TreatmentObjective)} options={OBJECTIVE_OPTIONS} />
          </Row>
          <Row label="Metas del paciente">
            <textarea value={patientGoals} onChange={(e) => setPatientGoals(e.target.value)} rows={2} style={textareaStyle} />
          </Row>
        </Section>
      ) : null}

      {step === 3 ? (
        <Section title="Plan de retención (≥20 caracteres)">
          <textarea
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            placeholder={`Ejemplo: ${EJEMPLO_DE_RETENCION}`}
            rows={6}
            style={textareaStyle}
          />
          <div style={{ fontSize: 11, color: retention.length >= 20 ? "#22C55E" : "#F59E0B" }}>
            {retention.length} / 20 mínimo
          </div>
          <Row label="Doctor tratante (obligatorio)">
            <select
              value={treatingDoctorId}
              onChange={(e) => setTreatingDoctorId(e.target.value)}
              disabled={!columnaDoctor}
              aria-invalid={sinDoctor}
              style={inputStyle}
            >
              <option value="">{columnaDoctor ? "— elige al doctor —" : "— sin asignar —"}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </Row>
          {treatingDoctorId !== "" && textoDeLaPropuesta(motivoPropuesta) ? (
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>{textoDeLaPropuesta(motivoPropuesta)}</div>
          ) : null}
          {sinDoctor ? <div style={{ fontSize: 11, color: "#F59E0B" }}>{MENSAJE_FALTA_DOCTOR}</div> : null}
          <p style={{ margin: 0, fontSize: 11, color: "var(--text-3)" }}>
            Tras guardar, se abrirá el modal del consentimiento de tratamiento (SPEC §10.4)
            para firma del paciente o tutor.
          </p>
        </Section>
      ) : null}
    </WizardShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, color: "var(--text-1)" }}>{title}</h3>
      {children}
    </section>
  );
}
function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--text-2)" }}>{props.label}</span>
      {props.children}
    </label>
  );
}
function Select(props: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} style={inputStyle}>
      {props.options.map((opt) => (
        <option key={opt} value={opt}>
          {opt.replaceAll("_", " ").toLowerCase()}
        </option>
      ))}
    </select>
  );
}
function NumberInput(props: { value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <input
      type="number"
      value={props.value}
      onChange={(e) => props.onChange(Number(e.target.value))}
      min={props.min}
      max={props.max}
      step={props.step}
      style={inputStyle}
    />
  );
}
function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-1)" }}>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
      <span style={{ fontSize: 12 }}>{props.label}</span>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  background: "var(--bg)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: "vertical", minHeight: 60 };
