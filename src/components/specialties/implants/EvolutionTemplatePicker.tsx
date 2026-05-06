"use client";

/**
 * Picker de plantillas SOAP de evolución implantológica.
 * Se monta dentro del editor SoapNote como botón "Usar plantilla".
 *
 * Al seleccionar una plantilla:
 *  1) renderiza con el contexto del implante actual (paciente, diente, etc.)
 *  2) llama onApply con las 4 secciones SOAP hidratadas
 *  3) cierra el modal
 *
 * No hace IO — todas las plantillas son builtin (`IMPLANT_EVOLUTION_TEMPLATES`).
 */

import * as React from "react";
import { FileText, ChevronRight, X } from "lucide-react";
import {
  IMPLANT_EVOLUTION_TEMPLATES,
  renderSoapTemplate,
  type ImplantEvolutionTemplate,
  type SoapTemplate,
} from "@/lib/clinical-shared/evolution-templates";

export type EvolutionTemplateContext = Record<
  string,
  string | number | null | undefined
>;

export interface EvolutionTemplatePickerProps {
  /** Si null, no se renderiza. */
  open: boolean;
  onClose: () => void;
  /** Contexto para hidratar placeholders {{var}}. */
  context: EvolutionTemplateContext;
  /** Callback con SOAP renderizado al elegir plantilla. */
  onApply: (
    template: ImplantEvolutionTemplate,
    rendered: SoapTemplate,
  ) => void;
}

export default function EvolutionTemplatePicker({
  open,
  onClose,
  context,
  onApply,
}: EvolutionTemplatePickerProps) {
  const [selectedKey, setSelectedKey] =
    React.useState<ImplantEvolutionTemplate["key"] | null>(null);

  const sorted = React.useMemo(
    () =>
      [...IMPLANT_EVOLUTION_TEMPLATES].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    [],
  );

  const selected = React.useMemo(
    () => sorted.find((t) => t.key === selectedKey) ?? null,
    [sorted, selectedKey],
  );

  const preview = React.useMemo(
    () => (selected ? renderSoapTemplate(selected.soapTemplate, context) : null),
    [selected, context],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="evol-template-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] max-h-[800px] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2
            id="evol-template-picker-title"
            className="flex items-center gap-2 text-base font-semibold text-[var(--foreground)]"
          >
            <FileText className="h-4 w-4 text-[var(--color-muted-fg)]" aria-hidden />
            Plantillas de evolución — Implantes
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

        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[280px_1fr]">
          {/* lista de plantillas */}
          <ul
            role="listbox"
            aria-label="Plantillas disponibles"
            className="overflow-y-auto border-r border-[var(--border)] bg-[var(--background)]"
          >
            {sorted.map((tpl) => {
              const active = tpl.key === selectedKey;
              return (
                <li key={tpl.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedKey(tpl.key)}
                    className={`flex w-full items-center justify-between border-b border-[var(--border)] px-3 py-2.5 text-left transition ${
                      active
                        ? "bg-[var(--primary)]/10 text-[var(--foreground)]"
                        : "hover:bg-[var(--accent)]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">
                        {tpl.name}
                      </p>
                      <p className="truncate text-xs text-[var(--color-muted-fg)]">
                        {tpl.description}
                      </p>
                    </div>
                    <ChevronRight
                      className={`ml-2 h-3.5 w-3.5 text-[var(--color-muted-fg)] ${active ? "rotate-90" : ""}`}
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* preview */}
          <div className="flex flex-col overflow-hidden">
            {selected && preview ? (
              <>
                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                  <PreviewSection title="Subjetivo (S)" body={preview.S} />
                  <PreviewSection title="Objetivo (O)" body={preview.O} />
                  <PreviewSection title="Análisis (A)" body={preview.A} />
                  <PreviewSection title="Plan (P)" body={preview.P} />

                  {selected.proceduresPrefilled.length > 0 && (
                    <div>
                      <h4 className="mb-1 text-xs font-semibold text-[var(--color-muted-fg)]">
                        Procedimientos sugeridos
                      </h4>
                      <ul className="flex flex-wrap gap-1.5">
                        {selected.proceduresPrefilled.map((p) => (
                          <li
                            key={p}
                            className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-xs"
                          >
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onApply(selected, preview);
                      onClose();
                    }}
                    className="rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-fg)] hover:opacity-90"
                  >
                    Aplicar plantilla
                  </button>
                </footer>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-4 py-6">
                <p className="max-w-prose text-center text-sm text-[var(--color-muted-fg)]">
                  Seleccione una plantilla a la izquierda para ver el contenido
                  pre-cargado y aplicarlo al SOAP.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSection({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-fg)]">
        {title}
      </h4>
      <pre className="whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--background)] p-2 font-sans text-xs leading-relaxed text-[var(--foreground)]">
        {body}
      </pre>
    </section>
  );
}
