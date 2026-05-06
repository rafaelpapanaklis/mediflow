"use client";
// Clinical-shared — componente reutilizable de notas SOAP con picker de
// plantillas. Pensado para módulos clínicos que necesiten una sola
// celda S/O/A/P + reemplazar/agregar plantilla por módulo.

import { useState } from "react";
import type { ClinicalModule } from "@prisma/client";
import { EvolutionTemplatePicker, applyTemplateToSoap } from "./EvolutionTemplatePicker";
import type { SoapTemplateBody } from "@/lib/clinical-shared/evolution-templates/types";

export interface SoapNoteProps {
  module: ClinicalModule;
  value: SoapTemplateBody;
  onChange: (next: SoapTemplateBody) => void;
  disabled?: boolean;
}

const FIELDS: Array<{ key: keyof SoapTemplateBody; label: string; placeholder: string }> = [
  { key: "S", label: "Subjetivo (motivo, antecedentes referidos)", placeholder: "Lo que el paciente / tutor refiere…" },
  { key: "O", label: "Objetivo (exploración, hallazgos)", placeholder: "Hallazgos clínicos, signos, mediciones…" },
  { key: "A", label: "Análisis (diagnóstico, juicio clínico)", placeholder: "Impresión diagnóstica, riesgo, evolución…" },
  { key: "P", label: "Plan (tratamiento, próximos pasos)", placeholder: "Acciones realizadas, indicaciones, próxima cita…" },
];

export function SoapNote(props: SoapNoteProps) {
  const [applyMode, setApplyMode] = useState<"append" | "replace">("append");

  const set = (key: keyof SoapTemplateBody, v: string) =>
    props.onChange({ ...props.value, [key]: v });

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 14, color: "var(--text-1)" }}>Nota de evolución (SOAP)</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={applyMode}
            onChange={(e) => setApplyMode(e.target.value as "append" | "replace")}
            aria-label="Modo de aplicación de plantilla"
            style={{
              fontSize: 11,
              padding: "3px 6px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "var(--surface-1)",
              color: "var(--text-1)",
            }}
          >
            <option value="append">Agregar a lo escrito</option>
            <option value="replace">Reemplazar contenido</option>
          </select>
          <EvolutionTemplatePicker
            module={props.module}
            onApply={(tpl) =>
              props.onChange(applyTemplateToSoap(props.value, tpl.soapTemplate, applyMode))
            }
          />
        </div>
      </header>

      {FIELDS.map((f) => (
        <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>{f.label}</label>
          <textarea
            value={props.value[f.key]}
            onChange={(e) => set(f.key, e.target.value)}
            disabled={props.disabled}
            placeholder={f.placeholder}
            style={{
              minHeight: 70,
              padding: 8,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-1)",
              color: "var(--text-1)",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </div>
      ))}
    </section>
  );
}
