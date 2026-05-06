"use client";
// Clinical-shared — picker de plantillas SOAP por módulo.

import { useEffect, useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import type { ClinicalModule } from "@prisma/client";
import { listEvolutionTemplates } from "@/app/actions/clinical-shared/evolution-templates";
import type { EvolutionTemplateDTO, SoapTemplateBody } from "@/lib/clinical-shared/evolution-templates/types";
import { isFailure } from "@/lib/clinical-shared/result";

export interface EvolutionTemplatePickerProps {
  module: ClinicalModule;
  /**
   * Callback con el cuerpo SOAP listo para insertar/sustituir en los
   * campos del formulario. El consumidor decide si reemplaza o concatena.
   */
  onApply: (template: EvolutionTemplateDTO) => void;
  /** Si true (default para Pediatría), llama a ensurePediatricDefaults. */
  ensureDefaults?: boolean;
}

export function EvolutionTemplatePicker(props: EvolutionTemplatePickerProps) {
  const [templates, setTemplates] = useState<EvolutionTemplateDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setLoading(true);
      const res = await listEvolutionTemplates({
        module: props.module,
        ensureDefaults: props.ensureDefaults ?? props.module === "pediatrics",
      });
      if (cancelled) return;
      if (isFailure(res)) setError(res.error);
      else setTemplates(res.data);
      setLoading(false);
    }
    void fetchAll();
    return () => {
      cancelled = true;
    };
  }, [props.module, props.ensureDefaults]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Plantillas de evolución"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          fontSize: 12,
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          color: "var(--text-1)",
          cursor: "pointer",
        }}
      >
        <Sparkles size={13} aria-hidden />
        Plantillas
        {templates.length > 0 ? ` (${templates.length})` : ""}
      </button>

      {open ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            minWidth: 260,
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            padding: 4,
          }}
        >
          {loading ? (
            <div style={{ padding: 10, fontSize: 12, color: "var(--text-2)" }}>
              Cargando…
            </div>
          ) : error ? (
            <div style={{ padding: 10, fontSize: 12, color: "var(--danger)" }}>
              {error}
            </div>
          ) : templates.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12, color: "var(--text-2)" }}>
              Sin plantillas para este módulo.
            </div>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  props.onApply(t);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  fontSize: 12,
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color: "var(--text-1)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--surface-2)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <FileText size={12} aria-hidden style={{ color: "var(--text-2)" }} />
                <span>{t.name}</span>
                {t.isDefault ? (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "var(--text-2)",
                    }}
                  >
                    default
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Helper para fusionar el cuerpo SOAP en un state local del formulario. */
export function applyTemplateToSoap(
  current: SoapTemplateBody,
  tpl: SoapTemplateBody,
  mode: "replace" | "append" = "append",
): SoapTemplateBody {
  if (mode === "replace") return { ...tpl };
  const join = (a: string, b: string) => (a ? `${a}\n\n${b}` : b);
  return {
    S: join(current.S, tpl.S),
    O: join(current.O, tpl.O),
    A: join(current.A, tpl.A),
    P: join(current.P, tpl.P),
  };
}
