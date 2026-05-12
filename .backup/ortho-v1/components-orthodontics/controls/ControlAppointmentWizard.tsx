"use client";
// Orthodontics — wizard de control mensual 3 pasos. SPEC §6.8.

import { useState } from "react";
import toast from "react-hot-toast";
import { WizardShell } from "../shared/WizardShell";
import { createControlAppointment } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { AdjustmentType, ControlAttendance } from "@prisma/client";

const ADJUSTMENT_OPTIONS: AdjustmentType[] = [
  "WIRE_CHANGE",
  "BRACKET_REPOSITION",
  "ELASTIC_CHANGE",
  "NEW_ALIGNERS_DELIVERED",
  "IPR",
  "BUTTON_PLACEMENT",
  "ATTACHMENT_PLACEMENT",
  "HYGIENE_REINFORCEMENT",
  "OTHER",
];

export interface ControlAppointmentWizardProps {
  patientId: string;
  treatmentPlanId: string;
  monthInTreatment: number;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export function ControlAppointmentWizard(props: ControlAppointmentWizardProps) {
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);

  const [scheduledAt, setScheduledAt] = useState(new Date().toISOString().slice(0, 10));
  const [attendance, setAttendance] = useState<ControlAttendance>("ATTENDED");
  const [hygiene, setHygiene] = useState(85);
  const [bracketsLoose, setBracketsLoose] = useState(0);
  const [bracketsBroken, setBracketsBroken] = useState(0);
  const [appliancesIntact, setAppliancesIntact] = useState(true);
  const [reportsPain, setReportsPain] = useState(false);
  const [painNotes, setPainNotes] = useState("");

  const [adjustments, setAdjustments] = useState<AdjustmentType[]>([]);
  const [adjNotes, setAdjNotes] = useState("");

  const [nextDate, setNextDate] = useState("");
  const [nextNotes, setNextNotes] = useState("");

  const submit = async () => {
    setPending(true);
    try {
      const performedAt =
        attendance === "ATTENDED" ? new Date(scheduledAt).toISOString() : null;
      const result = await createControlAppointment({
        treatmentPlanId: props.treatmentPlanId,
        patientId: props.patientId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        performedAt,
        monthInTreatment: props.monthInTreatment,
        attendance,
        hygieneScore: attendance === "ATTENDED" ? hygiene : null,
        bracketsLoose: attendance === "ATTENDED" ? bracketsLoose : null,
        bracketsBroken: attendance === "ATTENDED" ? bracketsBroken : null,
        appliancesIntact: attendance === "ATTENDED" ? appliancesIntact : null,
        patientReportsPain: reportsPain,
        patientPainNotes: reportsPain ? painNotes : null,
        adjustments,
        adjustmentNotes: adjNotes || null,
        nextAppointmentAt: nextDate ? new Date(nextDate).toISOString() : null,
        nextAppointmentNotes: nextNotes || null,
      });
      if (isFailure(result)) {
        toast.error(result.error);
        return;
      }
      toast.success("Control registrado");
      props.onCreated?.(result.data.id);
      props.onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <WizardShell
      title="Control mensual"
      subtitle={`Mes ${props.monthInTreatment}`}
      step={step}
      totalSteps={3}
      onClose={props.onClose}
      onPrev={() => setStep((s) => Math.max(1, s - 1))}
      onNext={() => setStep((s) => Math.min(3, s + 1))}
      onSubmit={submit}
      pending={pending}
    >
      {step === 1 ? (
        <Section title="Asistencia + hallazgos">
          <Row label="Fecha programada">
            <input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={inputStyle} />
          </Row>
          <Row label="Asistencia">
            <select
              value={attendance}
              onChange={(e) => setAttendance(e.target.value as ControlAttendance)}
              style={inputStyle}
            >
              <option value="ATTENDED">Asistió</option>
              <option value="RESCHEDULED">Reagendó</option>
              <option value="NO_SHOW">No asistió</option>
            </select>
          </Row>
          {attendance === "ATTENDED" ? (
            <>
              <Row label="Higiene (0-100)">
                <NumberInput value={hygiene} onChange={setHygiene} min={0} max={100} step={1} />
              </Row>
              <Row label="Brackets sueltos">
                <NumberInput value={bracketsLoose} onChange={setBracketsLoose} min={0} max={32} step={1} />
              </Row>
              <Row label="Brackets rotos">
                <NumberInput value={bracketsBroken} onChange={setBracketsBroken} min={0} max={32} step={1} />
              </Row>
              <Toggle label="Aparatología íntegra" value={appliancesIntact} onChange={setAppliancesIntact} />
            </>
          ) : null}
          <Toggle label="Paciente reporta dolor" value={reportsPain} onChange={setReportsPain} />
          {reportsPain ? (
            <Row label="Notas dolor">
              <textarea value={painNotes} onChange={(e) => setPainNotes(e.target.value)} rows={2} style={textareaStyle} />
            </Row>
          ) : null}
        </Section>
      ) : null}

      {step === 2 ? (
        <Section title="Ajustes realizados">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ADJUSTMENT_OPTIONS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() =>
                  setAdjustments((curr) =>
                    curr.includes(a) ? curr.filter((x) => x !== a) : [...curr, a],
                  )
                }
                style={chipStyle(adjustments.includes(a))}
              >
                {a.replaceAll("_", " ").toLowerCase()}
              </button>
            ))}
          </div>
          <Row label="Notas">
            <textarea value={adjNotes} onChange={(e) => setAdjNotes(e.target.value)} rows={3} style={textareaStyle} />
          </Row>
        </Section>
      ) : null}

      {step === 3 ? (
        <Section title="Próxima cita">
          <Row label="Fecha próxima cita">
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} style={inputStyle} />
          </Row>
          <Row label="Notas">
            <textarea value={nextNotes} onChange={(e) => setNextNotes(e.target.value)} rows={2} style={textareaStyle} />
          </Row>
          <p style={{ margin: 0, fontSize: 11, color: "var(--text-3)" }}>
            El status financiero al momento de este control queda como snapshot
            en la cita (`paymentStatusSnapshot`).
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
