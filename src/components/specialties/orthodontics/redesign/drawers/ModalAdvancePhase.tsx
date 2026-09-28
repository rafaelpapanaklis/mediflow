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
import orto from "../orto.module.css";

// El checklist vive en `phase-criteria.ts` (se importa también desde las
// pruebas, sin el componente). Se reexporta para quien ya lo tomaba de aquí.
import { PHASE_CRITERIA, type PhaseCriterion } from "./phase-criteria";
export { PHASE_CRITERIA, type PhaseCriterion };

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
        <div className="px-5 py-5 text-[13px] text-[color:var(--pr-texto-2)]">
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
          <ChevronRight className="w-4 h-4 text-[color:var(--orto-violeta)]" aria-hidden />
          {PHASE_LABELS[toPhase]}
        </span>
      }
      eyebrow="Avanzar fase ortodóntica"
      onClose={props.onClose}
    >
      <div className="px-5 py-4 border-b border-[color:var(--pr-borde-suave)]">
        <div className="text-[11px] text-[color:var(--pr-texto-3)] mb-2">
          Confirma cada criterio clínico antes de avanzar. La acción queda en el audit
          trail con tu firma.
        </div>
        <ul className="space-y-2">
          {criteria.map((c) => {
            const on = checked.has(c.key);
            return (
              <li key={c.key}>
                <label className="flex items-start gap-3 px-3 py-2 rounded-[8px] border border-[color:var(--pr-borde)] hover:bg-[color:var(--pr-hover)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onCheck(c.key)}
                    className="mt-0.5"
                    aria-label={c.label}
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[13px] ${on ? "text-[color:var(--pr-exito)]" : "text-[color:var(--pr-texto-2)]"}`}
                    >
                      {on ? "✅ " : ""}
                      {c.label}
                    </div>
                    {c.hint ? (
                      <div className="text-[11px] text-[color:var(--pr-texto-3)] mt-0.5">
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
          <div className="text-[13px] text-[color:var(--pr-texto-3)] italic">
            Esta fase no tiene checklist específico.
          </div>
        ) : null}
      </div>

      <div className="px-5 py-4 border-b border-[color:var(--pr-borde-suave)]">
        <div className={`${orto.ceja} mb-1`}>
          Notas clínicas (opcional)
        </div>
        <textarea
          value={doctorNotes}
          onChange={(e) => setDoctorNotes(e.target.value)}
          rows={2}
          placeholder="Observaciones del cambio de fase…"
          className={`${orto.entrada} w-full resize-y`}
        />
      </div>

      {props.canOverride && !allChecked ? (
        <div className="px-5 py-4 border-b border-[color:var(--pr-borde-suave)] bg-[color:var(--pr-alerta-suave)]">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="w-4 h-4 text-[color:var(--pr-alerta)] mt-0.5"
              aria-hidden
            />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-[color:var(--pr-texto)]">
                Avanzar sin cumplir la lista
              </div>
              <div className="text-[11px] text-[color:var(--pr-texto-2)]">
                Solo el doctor titular. Pide razón clínica y PIN, y queda registrado en el
                historial de fases.
              </div>
              <label className="mt-2 inline-flex items-center gap-2 text-[13px] cursor-pointer">
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
                    <div className={`${orto.ceja} mb-0.5`}>
                      Razón clínica (mín. 10 caracteres)
                    </div>
                    <textarea
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      rows={2}
                      placeholder="Ej. Paciente viaja al extranjero, fase saltada por logística…"
                      className={`${orto.entrada} w-full resize-y`}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-[color:var(--pr-texto-3)] mb-0.5 inline-flex items-center gap-1">
                      <Lock className="w-3 h-3" aria-hidden /> PIN del titular
                    </div>
                    <input
                      type="password"
                      value={overridePin}
                      onChange={(e) => setOverridePin(e.target.value)}
                      placeholder="••••"
                      className={`${orto.entrada} w-32`}
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
        className={orto.velo}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-advance-phase-title"
        className={orto.ventanaMarco}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-[color:var(--pr-tarjeta)] border border-[color:var(--pr-borde)] rounded-[14px] shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        >
          <header className={orto.cajonCabeza}>
            <div>
              {eyebrow ? (
                <div className={orto.cajonCeja}>
                  {eyebrow}
                </div>
              ) : null}
              <h3
                id="modal-advance-phase-title"
                className={orto.cajonTitulo}
              >
                {title}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className={orto.botonIcono}
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
    <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
      {children}
    </footer>
  );
}
