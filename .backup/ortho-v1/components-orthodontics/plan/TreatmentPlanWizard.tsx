"use client";
// Orthodontics — wizard de plan de tratamiento 3 pasos. SPEC §6.6.

import { useState } from "react";
import toast from "react-hot-toast";
import { WizardShell } from "../shared/WizardShell";
import { createTreatmentPlan } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
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

const TECHNIQUE_OPTIONS: OrthoTechnique[] = [
  "METAL_BRACKETS",
  "CERAMIC_BRACKETS",
  "SELF_LIGATING_METAL",
  "SELF_LIGATING_CERAMIC",
  "LINGUAL_BRACKETS",
  "CLEAR_ALIGNERS",
  "HYBRID",
];

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

const DEFAULT_RETENTION =
  "Retenedor fijo lingual 3-3 inferior + retenedor removible Hawley superior. " +
  "24 horas por 6 meses, luego nocturno permanente.";

export function TreatmentPlanWizard(props: TreatmentPlanWizardProps) {
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);

  const [technique, setTechnique] = useState<OrthoTechnique>("METAL_BRACKETS");
  const [techniqueNotes, setTechniqueNotes] = useState("");
  const [duration, setDuration] = useState(18);
  const [installedAt, setInstalledAt] = useState("");
  const [totalCost, setTotalCost] = useState(45000);

  const [anchorage, setAnchorage] = useState<AnchorageType>("MODERATE");
  const [anchorageNotes, setAnchorageNotes] = useState("");
  const [extractions, setExtractions] = useState(false);
  const [extractFdi, setExtractFdi] = useState("");
  const [iprRequired, setIprRequired] = useState(false);
  const [tadsRequired, setTadsRequired] = useState(false);
  const [objectives, setObjectives] = useState<TreatmentObjective>("AESTHETIC_AND_FUNCTIONAL");
  const [patientGoals, setPatientGoals] = useState("");

  const [retention, setRetention] = useState(DEFAULT_RETENTION);

  const canProceed = step === 3 ? retention.length >= 20 : true;

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
        techniqueNotes: techniqueNotes || null,
        estimatedDurationMonths: duration,
        installedAt: installedAt ? new Date(installedAt).toISOString() : null,
        totalCostMxn: totalCost,
        anchorageType: anchorage,
        anchorageNotes: anchorageNotes || null,
        extractionsRequired: extractions,
        extractionsTeethFdi: fdi,
        iprRequired,
        tadsRequired,
        treatmentObjectives: objectives,
        patientGoals: patientGoals || null,
        retentionPlanText: retention,
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
            <Select value={technique} onChange={(v) => setTechnique(v as OrthoTechnique)} options={TECHNIQUE_OPTIONS} />
          </Row>
          <Row label="Notas de técnica">
            <textarea value={techniqueNotes} onChange={(e) => setTechniqueNotes(e.target.value)} rows={2} style={textareaStyle} />
          </Row>
          <Row label="Duración estimada (meses, 3-60)">
            <NumberInput value={duration} onChange={setDuration} min={3} max={60} step={1} />
          </Row>
          <Row label="Fecha de instalación (opcional)">
            <input type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} style={inputStyle} />
          </Row>
          <Row label="Costo total MXN">
            <NumberInput value={totalCost} onChange={setTotalCost} min={1} max={1000000} step={100} />
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
            rows={6}
            style={textareaStyle}
          />
          <div style={{ fontSize: 11, color: retention.length >= 20 ? "#22C55E" : "#F59E0B" }}>
            {retention.length} / 20 mínimo
          </div>
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
