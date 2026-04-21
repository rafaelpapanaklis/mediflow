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
  const borderColor = error
    ? "rgba(239,68,68,0.5)"
    : "var(--ld-border)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--ld-fg, #f5f5f7)",
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </label>

      {children ?? (
        <input
          ref={ref}
          {...inputProps}
          style={{
            height: 42,
            padding: "0 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${borderColor}`,
            color: "var(--ld-fg)",
            fontSize: 14,
            fontFamily: "inherit",
            outline: "none",
            transition: "border-color .15s, background .15s",
          }}
          onFocus={e => {
            if (!error) e.currentTarget.style.borderColor = "rgba(124,58,237,0.6)";
            inputProps.onFocus?.(e);
          }}
          onBlur={e => {
            if (!error) e.currentTarget.style.borderColor = "var(--ld-border)";
            inputProps.onBlur?.(e);
          }}
        />
      )}

      {error ? (
        <div style={{ fontSize: 11, color: "#f87171", lineHeight: 1.4 }}>{error}</div>
      ) : hint ? (
        <div style={{ fontSize: 11, color: "var(--ld-fg-muted)", lineHeight: 1.4 }}>{hint}</div>
      ) : null}
    </div>
  );
});
