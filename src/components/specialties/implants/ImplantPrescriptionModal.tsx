"use client";

/**
 * Modal de generación de receta para implantes. Picker de las 3
 * plantillas (post-cirugía, post-segunda fase, peri-implantitis) con
 * preview, y al confirmar dispara onApply con los items+indicaciones
 * para que el caller los pase al PrescriptionModal genérico (el que
 * crea la prescription real con NOM-024 + CUMS).
 */

import * as React from "react";
import { Pill, X } from "lucide-react";
import {
  PRESCRIPTION_TEMPLATES,
  renderPrescriptionTextPreview,
  type PrescriptionTemplate,
  type PrescriptionTemplateKey,
} from "@/lib/prescriptions/templates";

export interface ImplantPrescriptionModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Callback invocado al hacer click en "Usar esta receta". El caller
   * recibe la plantilla y debe abrir el modal NOM-024 con los items
   * pre-cargados, o usar este preview como punto de partida del
   * borrador.
   */
  onApply: (tpl: PrescriptionTemplate) => void;
}

export default function ImplantPrescriptionModal({
  open,
  onClose,
  onApply,
}: ImplantPrescriptionModalProps) {
  const [selectedKey, setSelectedKey] =
    React.useState<PrescriptionTemplateKey | null>(null);

  const tpls = React.useMemo(
    () => PRESCRIPTION_TEMPLATES.filter((t) => t.specialty === "implants"),
    [],
  );

  const selected = React.useMemo(
    () => tpls.find((t) => t.key === selectedKey) ?? null,
    [tpls, selectedKey],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="implant-rx-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] max-h-[800px] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2
            id="implant-rx-title"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Pill className="h-4 w-4 text-[var(--color-muted-fg)]" aria-hidden />
            Plantillas de receta — Implantes
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--accent)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[260px_1fr]">
          {/* lista */}
          <ul
            role="listbox"
            aria-label="Plantillas disponibles"
            className="overflow-y-auto border-r border-[var(--border)] bg-[var(--background)]"
          >
            {tpls.map((tpl) => {
              const active = tpl.key === selectedKey;
              return (
                <li key={tpl.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedKey(tpl.key)}
                    className={`block w-full border-b border-[var(--border)] px-3 py-2.5 text-left transition ${
                      active
                        ? "bg-[var(--primary)]/10"
                        : "hover:bg-[var(--accent)]"
                    }`}
                  >
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {tpl.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-muted-fg)]">
                      {tpl.description}
                    </p>
                    <p className="mt-1 text-[10px] text-[var(--color-muted-fg)]">
                      {tpl.items.length} medicamento
                      {tpl.items.length !== 1 ? "s" : ""}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* preview */}
          <div className="flex flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                  <h3 className="text-sm font-semibold">{selected.label}</h3>
                  <div className="space-y-2">
                    {selected.items.map((it, i) => (
                      <div
                        key={i}
                        className="rounded border border-[var(--border)] bg-[var(--background)] p-3"
                      >
                        <p className="text-sm font-medium">
                          {it.drugName} —{" "}
                          <span className="text-[var(--color-muted-fg)]">
                            {it.presentation}
                          </span>
                        </p>
                        <p className="mt-1 text-xs">
                          <strong>Posología:</strong> {it.dosage} · {it.route}
                        </p>
                        <p className="text-xs">
                          <strong>Duración:</strong> {it.duration}
                        </p>
                        {it.notes ? (
                          <p className="mt-1 text-xs text-[var(--color-muted-fg)]">
                            {it.notes}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-fg)]">
                      Indicaciones generales
                    </h4>
                    <p className="text-xs leading-relaxed">
                      {selected.indications}
                    </p>
                  </div>
                  <details className="rounded border border-[var(--border)] bg-[var(--background)] p-2">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--color-muted-fg)]">
                      Ver versión texto plano (para copiar)
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px]">
                      {renderPrescriptionTextPreview(selected)}
                    </pre>
                  </details>
                </div>
                <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onApply(selected);
                      onClose();
                    }}
                    className="rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-fg)] hover:opacity-90"
                  >
                    Usar esta receta
                  </button>
                </footer>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-4 py-6">
                <p className="max-w-prose text-center text-sm text-[var(--color-muted-fg)]">
                  Seleccione una plantilla a la izquierda para ver los
                  medicamentos pre-cargados.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
