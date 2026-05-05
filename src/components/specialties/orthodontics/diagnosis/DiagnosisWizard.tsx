"use client";
// Orthodontics — wizard de diagnóstico inicial 4 pasos. SPEC §6.5.

import { useState } from "react";
import toast from "react-hot-toast";
import { WizardShell } from "../shared/WizardShell";
import { createDiagnosis } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type {
  AngleClass,
  DentalPhase,
  HabitType,
} from "@prisma/client";

export interface DiagnosisWizardProps {
  patientId: string;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

const ANGLE_OPTIONS: AngleClass[] = [
  "CLASS_I",
  "CLASS_II_DIV_1",
  "CLASS_II_DIV_2",
  "CLASS_III",
  "ASYMMETRIC",
];

const HABIT_OPTIONS: HabitType[] = [
  "DIGITAL_SUCKING",
  "MOUTH_BREATHING",
  "TONGUE_THRUSTING",
  "BRUXISM",
  "NAIL_BITING",
  "LIP_BITING",
  "OTHER",
];

const DENTAL_PHASE_OPTIONS: DentalPhase[] = [
  "DECIDUOUS",
  "MIXED_EARLY",
  "MIXED_LATE",
  "PERMANENT",
];

export function DiagnosisWizard(props: DiagnosisWizardProps) {
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);

  // Step 1 — Angle + mordida
  const [angleR, setAngleR] = useState<AngleClass>("CLASS_I");
  const [angleL, setAngleL] = useState<AngleClass>("CLASS_I");
  const [overbiteMm, setOverbiteMm] = useState(2);
  const [overbitePct, setOverbitePct] = useState(20);
  const [overjetMm, setOverjetMm] = useState(2);
  const [midline, setMidline] = useState(0);
  const [crossbite, setCrossbite] = useState(false);
  const [crossDetails, setCrossDetails] = useState("");
  const [openBite, setOpenBite] = useState(false);
  const [openDetails, setOpenDetails] = useState("");

  // Step 2 — Apiñamiento + etiología
  const [crowdingUpper, setCrowdingUpper] = useState(0);
  const [crowdingLower, setCrowdingLower] = useState(0);
  const [etioSkel, setEtioSkel] = useState(false);
  const [etioDental, setEtioDental] = useState(false);
  const [etioFunc, setEtioFunc] = useState(false);
  const [etioNotes, setEtioNotes] = useState("");

  // Step 3 — Hábitos + ATM + fase dental
  const [habits, setHabits] = useState<HabitType[]>([]);
  const [habitsDesc, setHabitsDesc] = useState("");
  const [dentalPhase, setDentalPhase] = useState<DentalPhase>("PERMANENT");
  const [tmjPain, setTmjPain] = useState(false);
  const [tmjClick, setTmjClick] = useState(false);
  const [tmjNotes, setTmjNotes] = useState("");

  // Step 4 — Resumen + archivos
  const [summary, setSummary] = useState("");

  const canProceed = step === 4 ? summary.length >= 40 : true;

  const submit = async () => {
    setPending(true);
    try {
      const result = await createDiagnosis({
        patientId: props.patientId,
        angleClassRight: angleR,
        angleClassLeft: angleL,
        overbiteMm,
        overbitePercentage: overbitePct,
        overjetMm,
        midlineDeviationMm: midline || null,
        crossbite,
        crossbiteDetails: crossbite ? crossDetails : null,
        openBite,
        openBiteDetails: openBite ? openDetails : null,
        crowdingUpperMm: crowdingUpper || null,
        crowdingLowerMm: crowdingLower || null,
        etiologySkeletal: etioSkel,
        etiologyDental: etioDental,
        etiologyFunctional: etioFunc,
        etiologyNotes: etioNotes || null,
        habits,
        habitsDescription: habitsDesc || null,
        dentalPhase,
        tmjPainPresent: tmjPain,
        tmjClickingPresent: tmjClick,
        tmjNotes: tmjNotes || null,
        clinicalSummary: summary,
      });
      if (isFailure(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Diagnóstico creado");
      props.onCreated?.(result.data.id);
      props.onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <WizardShell
      title="Diagnóstico ortodóntico inicial"
      step={step}
      totalSteps={4}
      onClose={props.onClose}
      onPrev={() => setStep((s) => Math.max(1, s - 1))}
      onNext={() => setStep((s) => Math.min(4, s + 1))}
      onSubmit={submit}
      pending={pending}
      canProceed={canProceed}
    >
      {step === 1 ? (
        <Section title="Análisis Angle + mordida">
          <Row label="Clase derecha">
            <Select value={angleR} onChange={(v) => setAngleR(v as AngleClass)} options={ANGLE_OPTIONS} />
          </Row>
          <Row label="Clase izquierda">
            <Select value={angleL} onChange={(v) => setAngleL(v as AngleClass)} options={ANGLE_OPTIONS} />
          </Row>
          <Row label="Overbite (mm)">
            <NumberInput value={overbiteMm} onChange={setOverbiteMm} min={-10} max={15} step={0.5} />
          </Row>
          <Row label="Overbite (%)">
            <NumberInput value={overbitePct} onChange={setOverbitePct} min={0} max={100} step={1} />
          </Row>
          <Row label="Overjet (mm)">
            <NumberInput value={overjetMm} onChange={setOverjetMm} min={-5} max={20} step={0.5} />
          </Row>
          <Row label="Desviación línea media (mm)">
            <NumberInput value={midline} onChange={setMidline} min={-10} max={10} step={0.5} />
          </Row>
          <Toggle label="Mordida cruzada" value={crossbite} onChange={setCrossbite} />
          {crossbite ? (
            <TextArea
              label="Detalles mordida cruzada"
              value={crossDetails}
              onChange={setCrossDetails}
            />
          ) : null}
          <Toggle label="Mordida abierta" value={openBite} onChange={setOpenBite} />
          {openBite ? (
            <TextArea
              label="Detalles mordida abierta"
              value={openDetails}
              onChange={setOpenDetails}
            />
          ) : null}
        </Section>
      ) : null}

      {step === 2 ? (
        <Section title="Apiñamiento + etiología">
          <Row label="Apiñamiento superior (mm)">
            <NumberInput value={crowdingUpper} onChange={setCrowdingUpper} min={0} max={20} step={0.5} />
          </Row>
          <Row label="Apiñamiento inferior (mm)">
            <NumberInput value={crowdingLower} onChange={setCrowdingLower} min={0} max={20} step={0.5} />
          </Row>
          <Toggle label="Etiología esquelética" value={etioSkel} onChange={setEtioSkel} />
          <Toggle label="Etiología dental" value={etioDental} onChange={setEtioDental} />
          <Toggle label="Etiología funcional" value={etioFunc} onChange={setEtioFunc} />
          <TextArea label="Notas etiología" value={etioNotes} onChange={setEtioNotes} />
        </Section>
      ) : null}

      {step === 3 ? (
        <Section title="Hábitos + ATM + fase dental">
          <Row label="Fase dental">
            <Select
              value={dentalPhase}
              onChange={(v) => setDentalPhase(v as DentalPhase)}
              options={DENTAL_PHASE_OPTIONS}
            />
          </Row>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
            {HABIT_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() =>
                  setHabits((curr) =>
                    curr.includes(h) ? curr.filter((x) => x !== h) : [...curr, h],
                  )
                }
                style={chipStyle(habits.includes(h))}
              >
                {h.replace("_", " ").toLowerCase()}
              </button>
            ))}
          </div>
          <TextArea label="Descripción hábitos" value={habitsDesc} onChange={setHabitsDesc} />
          <Toggle label="Dolor ATM" value={tmjPain} onChange={setTmjPain} />
          <Toggle label="Chasquido ATM" value={tmjClick} onChange={setTmjClick} />
          <TextArea label="Notas ATM" value={tmjNotes} onChange={setTmjNotes} />
        </Section>
      ) : null}

      {step === 4 ? (
        <Section title="Resumen clínico (≥40 caracteres)">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={8}
            placeholder="Resume el caso: clasificación, problema principal, etiología, plan general."
            style={textareaStyle}
          />
          <div style={{ fontSize: 11, color: summary.length >= 40 ? "#22C55E" : "#F59E0B" }}>
            {summary.length} / 40 mínimo
          </div>
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

function Select(props: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={selectStyle}
    >
      {props.options.map((opt) => (
        <option key={opt} value={opt}>
          {opt.replace("_", " ").toLowerCase()}
        </option>
      ))}
    </select>
  );
}

function NumberInput(props: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
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
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span style={{ fontSize: 12 }}>{props.label}</span>
    </label>
  );
}

function TextArea(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={props.label}>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        style={textareaStyle}
      />
    </Row>
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
const selectStyle: React.CSSProperties = { ...inputStyle };
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: "vertical", minHeight: 60 };

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    borderRadius: 20,
    border: active ? "1px solid var(--brand, #6366f1)" : "1px solid var(--border)",
    background: active ? "var(--brand-soft, rgba(99,102,241,0.18))" : "transparent",
    color: active ? "var(--brand, #6366f1)" : "var(--text-1)",
    fontSize: 11,
    cursor: "pointer",
    textTransform: "capitalize",
  };
}
