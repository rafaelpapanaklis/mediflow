"use client";
// Modal G5 — Open Choice cotización.
// Presenta 3 escenarios financieros side-by-side. Doctor selecciona uno
// para preparar contrato + Sign@Home (G6).

import { useState } from "react";
import { Check, MessageCircle, Pencil, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { fmtMoney } from "../atoms/format";
import type { QuoteScenarioDTO } from "../types-finance";
import orto from "../orto.module.css";

export interface ModalOpenChoiceProps {
  scenarios: QuoteScenarioDTO[];
  patientFirstName?: string;
  /** Confirma escenario seleccionado y dispara Sign@Home G6. */
  onConfirm?: (scenarioId: string) => Promise<void> | void;
  /** Edita un escenario en sitio (enganche/meses/monto). Cierra edit mode al
   *  resolver. Si no se provee, los cards son read-only. */
  onUpdateScenario?: (payload: {
    scenarioId: string;
    downPayment: number;
    monthlyAmount: number;
    monthsCount: number;
    totalAmount: number;
  }) => Promise<void> | void;
  onClose: () => void;
}

export function ModalOpenChoice(props: ModalOpenChoiceProps) {
  const [selected, setSelected] = useState<string>(props.scenarios[1]?.id ?? props.scenarios[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // Local edit state per scenario in edit mode.
  const [draftDown, setDraftDown] = useState(0);
  const [draftMonthly, setDraftMonthly] = useState(0);
  const [draftMonths, setDraftMonths] = useState(0);

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await props.onConfirm?.(selected);
    } finally {
      setSubmitting(false);
    }
  };

  const beginEdit = (s: QuoteScenarioDTO) => {
    setEditing(s.id);
    setDraftDown(s.downPayment);
    setDraftMonthly(s.monthlyAmount);
    setDraftMonths(s.monthsCount);
  };
  const cancelEdit = () => {
    setEditing(null);
  };
  const saveEdit = async (s: QuoteScenarioDTO) => {
    if (!props.onUpdateScenario) return;
    setSavingEdit(true);
    try {
      // Total derivado = enganche + monthly × months (paymentMode CONTADO ignora months).
      const newTotal =
        draftMonths > 0
          ? draftDown + draftMonthly * draftMonths
          : draftDown;
      await props.onUpdateScenario({
        scenarioId: s.id,
        downPayment: draftDown,
        monthlyAmount: draftMonthly,
        monthsCount: draftMonths,
        totalAmount: newTotal,
      });
      setEditing(null);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <>
      <div
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <div
        className={orto.ventanaMarco}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-openchoice-title"
      >
        <div className="bg-[color:var(--pr-tarjeta)] rounded-[14px] shadow-xl border border-[color:var(--pr-borde)] w-full max-w-4xl pointer-events-auto max-h-[90vh] flex flex-col">
          <header className={orto.cajonCabeza}>
            <div>
              <div className={orto.cajonCeja}>
                G5 · Open Choice cotización
              </div>
              <h3
                id="modal-openchoice-title"
                className="text-[17px] font-semibold text-[color:var(--pr-texto)]"
              >
                Presentar 3 escenarios{props.patientFirstName ? ` a ${props.patientFirstName}` : ""}
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Cerrar"
              className={orto.botonIcono}
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-5">
            <div className="text-xs text-[color:var(--pr-texto-3)] mb-4">
              OrthoFi reporta +30% de same-day starts cuando se presentan 3 opciones
              financieras lado a lado en tablet. Selecciona una para preparar contrato y
              pasarela.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {props.scenarios.map((s) => {
                const isSel = selected === s.id;
                const isEditing = editing === s.id;
                return (
                  <div
                    key={s.id}
                    className={`text-left rounded-[10px] p-5 border-2 transition-colors ${
                      isSel
                        ? "border-[color:var(--pr-activo)] bg-[color:var(--pr-activo-suave)] ring-4 ring-[color:var(--orto-violeta-borde)]"
                        : "border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
                        {s.label}
                      </div>
                      <div className="flex items-center gap-1">
                        {s.badge ? (
                          <Pill color={isSel ? "violet" : "slate"} size="xs">
                            {s.badge}
                          </Pill>
                        ) : null}
                        {props.onUpdateScenario && !isEditing ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              beginEdit(s);
                            }}
                            className="text-[color:var(--pr-texto-3)] hover:text-[color:var(--orto-violeta)]"
                            aria-label={`Editar ${s.label}`}
                            title="Editar escenario"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="space-y-2 mb-3 pb-3 border-b border-[color:var(--pr-borde)]">
                        <EditField label="Enganche" value={draftDown} onChange={setDraftDown} />
                        <EditField label="Mensualidad" value={draftMonthly} onChange={setDraftMonthly} />
                        <EditField label="# meses" value={draftMonths} onChange={setDraftMonths} step={1} />
                        <div className="text-[11px] text-[color:var(--pr-texto-3)]">
                          Total derivado: <span className="tabular-nums font-semibold">{fmtMoney(draftDown + (draftMonths > 0 ? draftMonthly * draftMonths : 0))}</span>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Btn variant="ghost" size="sm" onClick={cancelEdit} disabled={savingEdit}>
                            Cancelar
                          </Btn>
                          <Btn variant="primary" size="sm" icon={<Check className="w-3 h-3" aria-hidden />} onClick={() => void saveEdit(s)} disabled={savingEdit}>
                            {savingEdit ? "Guardando..." : "Guardar"}
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelected(s.id)}
                        className="w-full text-left"
                      >
                        <div className="my-3 pb-3 border-b border-[color:var(--pr-borde)]">
                          <div className={orto.ceja}>
                            Mensualidad
                          </div>
                          <div className="text-[26px] font-bold text-[color:var(--pr-texto)] tabular-nums">
                            {s.monthlyAmount > 0 ? fmtMoney(s.monthlyAmount) : "—"}
                          </div>
                          <div className="text-[11px] text-[color:var(--pr-texto-3)]">
                            {s.monthsCount > 0 ? `× ${s.monthsCount} meses` : "pago único"}
                          </div>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <Row k="Enganche" v={fmtMoney(s.downPayment)} />
                          <Row k="Total" v={fmtMoney(s.totalAmount)} />
                          {s.discountPct ? (
                            <Row
                              k="Descuento"
                              v={`-${s.discountPct}%`}
                              vClass="text-[color:var(--pr-exito)]"
                            />
                          ) : null}
                        </div>
                        {s.includes.length > 0 ? (
                          <ul className="mt-3 pt-3 border-t border-[color:var(--pr-borde)] space-y-1 text-[11px] text-[color:var(--pr-texto-2)]">
                            {s.includes.map((inc, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span
                                  className="w-1 h-1 rounded-full bg-[color:var(--orto-violeta-borde)] mt-1.5 flex-shrink-0"
                                  aria-hidden
                                />
                                {inc}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="mt-3 pt-3 border-t border-[color:var(--pr-borde)] flex items-center gap-1.5 text-[11px] text-[color:var(--pr-texto-3)]">
                          <Shield className="w-3 h-3" aria-hidden />
                          CFDI 4.0 con Facturapi · contratar para activar
                        </div>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
            <div className="text-xs text-[color:var(--pr-texto-3)]">
              Selección:{" "}
              <span className="font-medium text-[color:var(--pr-texto)]">
                {props.scenarios.find((s) => s.id === selected)?.label ?? "—"}
              </span>
            </div>
            <div className="flex gap-2">
              <Btn variant="secondary" size="md" onClick={props.onClose}>
                Cancelar
              </Btn>
              <Btn
                variant="emerald"
                size="md"
                icon={<MessageCircle className="w-4 h-4" aria-hidden />}
                onClick={() => void submit()}
                disabled={!selected || submitting}
              >
                {submitting ? "Confirmando…" : "Enviar Sign@Home WhatsApp · G6"}
              </Btn>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

function Row({ k, v, vClass }: { k: string; v: string; vClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[color:var(--pr-texto-3)]">{k}</span>
      <span
        className={`tabular-nums font-medium ${vClass ?? "text-[color:var(--pr-texto)]"}`}
      >
        {v}
      </span>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className={orto.ceja}>
        {label}
      </span>
      <input
        type="number"
        step={step ?? 100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${orto.entrada} mt-0.5 w-full`}
      />
    </label>
  );
}
