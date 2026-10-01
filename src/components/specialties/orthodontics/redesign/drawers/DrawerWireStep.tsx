"use client";
// Drawer G3 — Wire step wizard (alta de paso de arco).
// 480px lateral. WIRE_OPTIONS catalogadas (NiTi superelástico/termoactivado/
// convencional, SS, TMA, Multi-stranded, Cr-Co) + gauges round (.014/.016/
// .018) y rect (16x22, 17x25, 19x25) + auxiliares (loops, hooks, stops,
// step-bend, GAC palatal arch).

import { useState } from "react";
import { Send, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { PHASE_LABELS, PHASE_ORDER } from "../types";
import type { OrthoPhaseKey } from "../types";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

// El catálogo vive en `wire-options.ts` (se importa también desde las pruebas,
// sin el componente). Se reexporta para quien ya lo tomaba de aquí.
import { WIRE_GAUGE_RECT, WIRE_GAUGE_ROUND, WIRE_MATERIAL_OPTIONS } from "./wire-options";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";
export { WIRE_GAUGE_RECT, WIRE_GAUGE_ROUND, WIRE_MATERIAL_OPTIONS };

const AUXILIARIES = [
  "Loops omega",
  "Hooks",
  "Stops",
  "Step-bend",
  "Toe-in/out",
  "GAC palatal arch",
  "Powerchain",
  "Open coil",
  "Closed coil",
];

export interface DrawerWireStepSubmit {
  phase: OrthoPhaseKey;
  material: string;
  shape: "ROUND" | "RECT";
  gauge: string;
  archUpper: boolean;
  archLower: boolean;
  durationWeeks: number;
  auxiliaries: string[];
  purpose: string | null;
  notes: string | null;
}

export interface DrawerWireStepProps {
  defaultPhase: OrthoPhaseKey | null;
  onClose: () => void;
  onSubmit?: (payload: DrawerWireStepSubmit) => Promise<void> | void;
}

export function DrawerWireStep(props: DrawerWireStepProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const [phase, setPhase] = useState<OrthoPhaseKey>(
    props.defaultPhase ?? "ALIGNMENT",
  );
  const [material, setMaterial] = useState<string>("NITI_SUPER");
  const [shape, setShape] = useState<"ROUND" | "RECT">("ROUND");
  const [gauge, setGauge] = useState<string>("014");
  const [archUpper, setArchUpper] = useState(true);
  const [archLower, setArchLower] = useState(true);
  const [durationWeeks, setDurationWeeks] = useState<number>(6);
  const [auxiliaries, setAuxiliaries] = useState<string[]>([]);
  const [purpose, setPurpose] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const toggleAux = (a: string) =>
    setAuxiliaries((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));

  const submit = async () => {
    if (!props.onSubmit) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        phase,
        material,
        shape,
        gauge,
        archUpper,
        archLower,
        durationWeeks,
        auxiliaries,
        purpose: purpose.trim() || null,
        notes: notes.trim() || null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const gaugeOptions = shape === "ROUND" ? WIRE_GAUGE_ROUND : WIRE_GAUGE_RECT;

  return (
    <>
      <div
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-wire-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>
              Secuencia de arcos
            </div>
            <h3
              id="drawer-wire-title"
              className={orto.cajonTitulo}
            >
              Nuevo paso de arco
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className={orto.botonIcono}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <Field label="Fase">
            <div className="flex flex-wrap gap-1.5">
              {PHASE_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPhase(p)}
                  className={[orto.chip, phase === p ? orto.chipElegido : orto.chipNeutro].join(" ")}
                >
                  {PHASE_LABELS[p]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Material">
            <div className="grid grid-cols-1 gap-1.5">
              {WIRE_MATERIAL_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMaterial(opt.key)}
                  className={`text-left text-xs px-3 py-2 rounded-[8px] border transition-colors ${
                    material === opt.key
                      ? "border-[color:var(--pr-activo)] bg-[color:var(--pr-activo-suave)] text-[color:var(--orto-violeta)]"
                      : "border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto-2)] hover:border-[color:var(--pr-borde)]"
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[11px] text-[color:var(--pr-texto-3)] mt-0.5">
                    {opt.hint}
                  </div>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Forma & calibre">
            <div className="flex gap-1.5 mb-2">
              {(["ROUND", "RECT"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setShape(s);
                    setGauge(s === "ROUND" ? "014" : "16x22");
                  }}
                  className={[orto.chip, shape === s ? orto.chipElegido : orto.chipNeutro].join(" ")}
                >
                  {s === "ROUND" ? "Redondo" : "Rectangular"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {gaugeOptions.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGauge(g.key)}
                  className={[orto.chip, gauge === g.key ? orto.chipElegido : orto.chipNeutro].join(" ")}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Arcos">
            <div className="flex gap-2">
              <Toggle
                label="Superior"
                checked={archUpper}
                onChange={() => setArchUpper((v) => !v)}
              />
              <Toggle
                label="Inferior"
                checked={archLower}
                onChange={() => setArchLower((v) => !v)}
              />
            </div>
          </Field>

          <Field label="Duración estimada (semanas)">
            <input
              type="number"
              min={1}
              max={26}
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(Number(e.target.value) || 6)}
              className={`${orto.entrada} w-24`}
            />
          </Field>

          <Field label="Auxiliares">
            <div className="flex flex-wrap gap-1.5">
              {AUXILIARIES.map((a) => {
                const on = auxiliaries.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleAux(a)}
                    className={[orto.chip, on ? orto.chipElegido : orto.chipNeutro].join(" ")}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
            {auxiliaries.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {auxiliaries.map((a) => (
                  <Pill key={a} color="violet" size="xs">
                    {a}
                  </Pill>
                ))}
              </div>
            ) : null}
          </Field>

          <Field label="Propósito">
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Ej. cerrar diastema, alineación inicial superior"
              className={`${orto.entrada} w-full`}
            />
          </Field>

          <Field label="Notas" dictado={(t) => setNotes((p) => appendDictado(p, t))}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${orto.entrada} w-full`}
            />
          </Field>
        </div>
        <footer className={orto.cajonPie}>
          <Btn variant="secondary" size="md" onClick={props.onClose}>
            Cancelar
          </Btn>
          <Btn
            variant="primary"
            size="md"
            disabled={submitting || (!archUpper && !archLower)}
            icon={<Send className="w-4 h-4" aria-hidden />}
            onClick={() => void submit()}
          >
            {submitting ? "Guardando…" : "Agregar al plan"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}

function Field({ label, dictado, children }: { label: string; dictado?: (texto: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <div className={`${orto.ceja} mb-1.5 flex items-center justify-between gap-2`}>
        <span>{label}</span>
        {dictado ? <DictationMic onText={dictado} /> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className={[orto.chip, checked ? orto.chipElegido : orto.chipNeutro].join(" ")}
    >
      <span
        className={`w-3 h-3 rounded-full ${checked ? "bg-[color:var(--pr-activo)]" : "bg-[color:var(--pr-borde)]"}`}
        aria-hidden
      />
      {label}
    </button>
  );
}
