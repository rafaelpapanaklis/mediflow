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

export const WIRE_MATERIAL_OPTIONS: ReadonlyArray<{
  key: string;
  label: string;
  hint: string;
}> = [
  {
    key: "NITI_SUPER",
    label: "NiTi superelástico",
    hint: "Alineación inicial · fuerzas constantes ligeras",
  },
  {
    key: "NITI_THERMO",
    label: "NiTi termoactivado",
    hint: "Activación por temperatura corporal",
  },
  {
    key: "NITI_CONV",
    label: "NiTi convencional",
    hint: "Casos rutinarios estándar",
  },
  { key: "SS", label: "Acero (SS)", hint: "Mecánicas de cierre y working" },
  { key: "TMA", label: "TMA / β-titanio", hint: "Detalles, finishing, springs" },
  {
    key: "MULTI",
    label: "Multi-stranded",
    hint: "Trenzado · arcos retención provisional",
  },
  { key: "CRCO", label: "Cr-Co (Elgiloy)", hint: "Quad-helix, Nance, custom" },
];

export const WIRE_GAUGE_ROUND = [
  { key: "014", label: ".014" },
  { key: "016", label: ".016" },
  { key: "018", label: ".018" },
] as const;

export const WIRE_GAUGE_RECT = [
  { key: "16x22", label: "16x22" },
  { key: "17x25", label: "17x25" },
  { key: "19x25", label: "19x25" },
] as const;

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
        className="fixed inset-0 bg-slate-900/30 z-40 dark:bg-slate-950/60"
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-wire-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-violet-50/40 flex items-center justify-between dark:border-slate-800 dark:bg-violet-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
              G3 · Wire step wizard
            </div>
            <h3
              id="drawer-wire-title"
              className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100"
            >
              Nuevo paso de arco
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <Field label="Fase">
            <div className="flex flex-wrap gap-1.5">
              {PHASE_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPhase(p)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus:outline-none ${
                    phase === p
                      ? "border-violet-500 bg-violet-50 text-violet-900 font-medium dark:bg-violet-900/20 dark:border-violet-500 dark:text-violet-200"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
                  }`}
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
                  className={`text-left text-xs px-3 py-2 rounded border transition-colors focus:outline-none ${
                    material === opt.key
                      ? "border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-900/20 dark:border-violet-500 dark:text-violet-200"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 dark:text-slate-400">
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
                  className={`text-xs px-3 py-1.5 rounded border ${
                    shape === s
                      ? "border-violet-500 bg-violet-50 text-violet-900 font-medium dark:bg-violet-900/20"
                      : "border-slate-200 bg-white text-slate-700 dark:bg-slate-900 dark:border-slate-700"
                  }`}
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
                  className={`font-mono text-xs px-2.5 py-1 rounded border ${
                    gauge === g.key
                      ? "border-violet-500 bg-violet-50 text-violet-900 font-semibold dark:bg-violet-900/20"
                      : "border-slate-200 bg-white text-slate-700 dark:bg-slate-900 dark:border-slate-700"
                  }`}
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
              className="w-24 text-sm border border-slate-200 rounded px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
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
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      on
                        ? "border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-900/20"
                        : "border-slate-200 bg-white text-slate-600 dark:bg-slate-900 dark:border-slate-700"
                    }`}
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
              className="w-full text-sm border border-slate-200 rounded px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
            />
          </Field>

          <Field label="Notas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-slate-200 rounded px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
            />
          </Field>
        </div>
        <footer className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 dark:border-slate-800 dark:bg-slate-900/40">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1.5 dark:text-slate-400">
        {label}
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
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border focus:outline-none ${
        checked
          ? "border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-900/20"
          : "border-slate-200 bg-white text-slate-600 dark:bg-slate-900 dark:border-slate-700"
      }`}
    >
      <span
        className={`w-3 h-3 rounded-full ${checked ? "bg-violet-500" : "bg-slate-300 dark:bg-slate-600"}`}
        aria-hidden
      />
      {label}
    </button>
  );
}
