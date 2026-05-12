"use client";
// ModalAdvancePhase — guard clínico para avanzar fase ortodóntica.
//
// Muestra checklist clínico de la fase actual definido en
// PHASE_CRITERIA[from]. Bloquea el avance hasta que TODOS los items estén
// confirmados; ofrece override (segundo factor PIN del doctor titular) con
// razón requerida. Persiste audit trail en OrthoPhaseTransition cuando el
// caller invoca onConfirm.

import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Lock, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import {
  PHASE_LABELS,
  PHASE_ORDER,
  type OrthoPhaseKey,
} from "../types";

export interface PhaseCriterion {
  key: string;
  label: string;
  /** Hint clínico breve si la criteria no es obvia. */
  hint?: string;
}

/**
 * Checklist clínico por fase de origen. El doctor confirma cada item antes
 * de poder avanzar a la siguiente. Diseñado contra el SPEC §HANDOFF #2 con
 * el vocabulario clínico real (NiTi, MBT, Clase II, etc.).
 */
export const PHASE_CRITERIA: Record<OrthoPhaseKey, PhaseCriterion[]> = {
  ALIGNMENT: [
    { key: "all-bonded", label: "Todos los brackets cementados de canino a canino" },
    { key: "no-rotation", label: "Rotaciones corregidas <2 mm" },
    { key: "wire-rectangular", label: "Wire NiTi rectangular tolerado sin molestia" },
    { key: "photos-t0", label: "Foto-set T0 capturado y revisado" },
  ],
  LEVELING: [
    { key: "wire-ss", label: "Curva de Spee nivelada a SS rectangular" },
    { key: "overjet-stable", label: "Overjet estable, sin compensación dental" },
    { key: "elastics-tolerated", label: "Elásticos Clase II/III tolerados ≥2 sem" },
    { key: "hygiene-ok", label: "Higiene <30% placa en última cita" },
  ],
  SPACE_CLOSURE: [
    { key: "spaces-closed", label: "Espacios cerrados o pendientes documentados" },
    { key: "anchorage-ok", label: "Anclaje verificado (TADs/Clase II/molar block)" },
    { key: "midlines-ok", label: "Líneas medias con desviación ≤1 mm" },
    { key: "torque-control", label: "Control de torque en incisivos confirmado" },
  ],
  DETAILS: [
    { key: "ipr-done", label: "IPR planeado completado al 100%" },
    { key: "settling", label: "Settling iniciado en próximo control" },
    { key: "cosmetic-bonding", label: "Bonding cosmético / acabado revisado" },
  ],
  FINISHING: [
    { key: "occlusion-class-i", label: "Oclusión Clase I funcional verificada" },
    { key: "panoramic-final", label: "Panorámica final tomada (paralelismo)" },
    { key: "patient-approved", label: "Paciente aprobó resultado estético" },
    { key: "retainers-ordered", label: "LabOrder de retenedores enviada" },
  ],
  RETENTION: [
    { key: "retention-confirmed", label: "Retención permanente confirmada" },
  ],
};

export interface ModalAdvancePhaseProps {
  fromPhase: OrthoPhaseKey;
  /** Si se omite, se calcula como la fase canónica siguiente. */
  toPhase?: OrthoPhaseKey;
  /** ¿El usuario actual es admin/titular y puede hacer override? */
  canOverride?: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    fromPhase: OrthoPhaseKey;
    toPhase: OrthoPhaseKey;
    criteriaChecked: string[];
    doctorNotes: string | null;
    isOverride: boolean;
    overrideReason: string | null;
    overridePin: string | null;
  }) => Promise<void> | void;
}

export function ModalAdvancePhase(props: ModalAdvancePhaseProps) {
  const idx = PHASE_ORDER.indexOf(props.fromPhase);
  const computedNext = idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : null;
  const toPhase = props.toPhase ?? computedNext;

  const criteria = useMemo(() => PHASE_CRITERIA[props.fromPhase] ?? [], [props.fromPhase]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [doctorNotes, setDoctorNotes] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overridePin, setOverridePin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!toPhase) {
    return (
      <ModalShell title="No hay siguiente fase" onClose={props.onClose}>
        <div className="px-6 py-5 text-sm text-slate-600 dark:text-slate-400">
          El paciente está en la última fase canónica ({PHASE_LABELS[props.fromPhase]}). No
          hay avance posible.
        </div>
        <ModalFooter>
          <Btn variant="secondary" size="md" onClick={props.onClose}>
            Cerrar
          </Btn>
        </ModalFooter>
      </ModalShell>
    );
  }

  const allChecked = criteria.length > 0 && criteria.every((c) => checked.has(c.key));
  const canConfirm = allChecked || (overrideMode && overrideReason.trim().length >= 10 && overridePin.trim().length > 0);

  const onCheck = (key: string) => {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await props.onConfirm({
        fromPhase: props.fromPhase,
        toPhase,
        criteriaChecked: Array.from(checked),
        doctorNotes: doctorNotes.trim() || null,
        isOverride: overrideMode,
        overrideReason: overrideMode ? overrideReason.trim() : null,
        overridePin: overrideMode ? overridePin.trim() : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-2">
          {PHASE_LABELS[props.fromPhase]}
          <ChevronRight className="w-4 h-4 text-violet-500" aria-hidden />
          {PHASE_LABELS[toPhase]}
        </span>
      }
      eyebrow="Avanzar fase ortodóntica"
      onClose={props.onClose}
    >
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="text-[11px] text-slate-500 mb-2 dark:text-slate-400">
          Confirma cada criterio clínico antes de avanzar. La acción queda en el audit
          trail con tu firma.
        </div>
        <ul className="space-y-2">
          {criteria.map((c) => {
            const on = checked.has(c.key);
            return (
              <li key={c.key}>
                <label className="flex items-start gap-3 px-3 py-2 rounded border border-slate-200 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onCheck(c.key)}
                    className="mt-0.5"
                    aria-label={c.label}
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm ${on ? "text-emerald-700 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}
                    >
                      {on ? "✅ " : ""}
                      {c.label}
                    </div>
                    {c.hint ? (
                      <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
                        {c.hint}
                      </div>
                    ) : null}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
        {criteria.length === 0 ? (
          <div className="text-sm text-slate-500 italic dark:text-slate-400">
            Esta fase no tiene checklist específico.
          </div>
        ) : null}
      </div>

      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1 dark:text-slate-400">
          Notas clínicas (opcional)
        </div>
        <textarea
          value={doctorNotes}
          onChange={(e) => setDoctorNotes(e.target.value)}
          rows={2}
          placeholder="Observaciones para el audit trail…"
          className="w-full text-sm bg-white border border-slate-200 rounded px-2.5 py-1.5 resize-y dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
        />
      </div>

      {props.canOverride && !allChecked ? (
        <div className="px-6 py-4 border-b border-slate-100 bg-amber-50/40 dark:border-slate-800 dark:bg-amber-900/10">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="w-4 h-4 text-amber-600 mt-0.5 dark:text-amber-400"
              aria-hidden
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Override del checklist
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                Solo doctor titular. Requiere razón clínica + PIN. Se registra como override
                en el audit trail.
              </div>
              <label className="mt-2 inline-flex items-center gap-2 text-sm cursor-pointer dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={overrideMode}
                  onChange={(e) => setOverrideMode(e.target.checked)}
                />
                Activar override
              </label>
              {overrideMode ? (
                <div className="mt-2 space-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 dark:text-slate-400">
                      Razón clínica (mín. 10 caracteres)
                    </div>
                    <textarea
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      rows={2}
                      placeholder="Ej. Paciente viaja al extranjero, fase saltada por logística…"
                      className="w-full text-sm bg-white border border-amber-300 rounded px-2.5 py-1.5 resize-y dark:bg-slate-800 dark:border-amber-700 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 dark:text-slate-400 inline-flex items-center gap-1">
                      <Lock className="w-3 h-3" aria-hidden /> PIN del titular
                    </div>
                    <input
                      type="password"
                      value={overridePin}
                      onChange={(e) => setOverridePin(e.target.value)}
                      placeholder="••••"
                      className="w-32 text-sm bg-white border border-amber-300 rounded px-2.5 py-1.5 dark:bg-slate-800 dark:border-amber-700 dark:text-slate-200"
                      autoComplete="off"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <ModalFooter>
        <div className="flex items-center gap-2">
          {allChecked ? (
            <Pill color="emerald" size="xs">
              <Check className="w-3 h-3" aria-hidden /> Checklist completo
            </Pill>
          ) : (
            <Pill color="slate" size="xs">
              {checked.size}/{criteria.length} criterios confirmados
            </Pill>
          )}
        </div>
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" onClick={props.onClose}>
            Cancelar
          </Btn>
          <Btn
            variant="primary"
            size="md"
            disabled={!canConfirm || submitting}
            icon={<Check className="w-3.5 h-3.5" aria-hidden />}
            onClick={() => void submit()}
          >
            {submitting ? "Confirmando…" : `Avanzar a ${PHASE_LABELS[toPhase]}`}
          </Btn>
        </div>
      </ModalFooter>
    </ModalShell>
  );
}

function ModalShell({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/30 z-40 dark:bg-slate-950/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-advance-phase-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col dark:bg-slate-900 dark:border-slate-800"
        >
          <header className="px-6 py-4 border-b border-slate-100 flex items-start justify-between dark:border-slate-800">
            <div>
              {eyebrow ? (
                <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
                  {eyebrow}
                </div>
              ) : null}
              <h3
                id="modal-advance-phase-title"
                className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100"
              >
                {title}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <footer className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2 flex-wrap dark:border-slate-800 dark:bg-slate-900/40">
      {children}
    </footer>
  );
}
