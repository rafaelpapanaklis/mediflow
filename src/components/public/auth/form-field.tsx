"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

interface FormFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Contenido custom (select, grupo de campos, etc.). Si se pasa, no se renderiza input interno. */
  children?: ReactNode;
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style"> & FormFieldProps;

/**
 * Wrapper de field: label + input + hint/error.
 * Si se pasa children, reemplaza el input por lo que venga (ideal para select/combos).
 */
export const FormField = forwardRef<HTMLInputElement, InputProps>(function FormField(
  { label, hint, error, children, ...inputProps },
  ref,
) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--ld-fg, #0f172a)",
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </label>

      {children ?? (
        <input
          ref={ref}
          {...inputProps}
          // Focus y error se pintan en globals.css (.landing-theme input) —
          // el border-color !important de ahí anula cualquier estilo inline.
          aria-invalid={error ? true : undefined}
          style={{
            height: 42,
            padding: "0 14px",
            borderRadius: 10,
            background: "#ffffff",
            border: "1px solid var(--ld-border)",
            color: "var(--ld-fg)",
            fontSize: 14,
            fontFamily: "inherit",
            outline: "none",
            transition: "border-color .15s, box-shadow .15s",
          }}
        />
      )}

      {error ? (
        <div role="alert" style={{ fontSize: 11, color: "#dc2626", lineHeight: 1.4 }}>{error}</div>
      ) : hint ? (
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>{hint}</div>
      ) : null}
    </div>
  );
});
