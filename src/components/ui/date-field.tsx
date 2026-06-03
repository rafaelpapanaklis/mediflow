"use client";

import { forwardRef } from "react";
import { Calendar } from "lucide-react";

function toDMY(value?: string): string {
  if (!value || typeof value !== "string") return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

type DateFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  placeholder?: string;
};

/**
 * Campo de fecha que SIEMPRE muestra dd/mm/aaaa (día primero) sin importar el
 * idioma del navegador. Internamente usa <input type="date"> nativo (calendario
 * y teclado nativos) pero lo hace invisible y superpone el texto formateado.
 * Drop-in de <input type="date">: reenvía value, onChange, min, max, required,
 * disabled, name, id, className, style y ref.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { className, style, value, placeholder = "dd/mm/aaaa", disabled, ...rest },
  ref,
) {
  const text = toDMY(typeof value === "string" ? value : undefined);
  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        justifyContent: "space-between",
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{ pointerEvents: "none", whiteSpace: "nowrap", color: text ? "inherit" : "var(--text-3)" }}
      >
        {text || placeholder}
      </span>
      <Calendar size={13} aria-hidden style={{ pointerEvents: "none", flexShrink: 0, opacity: 0.7 }} />
      <input
        ref={ref}
        type="date"
        value={value}
        disabled={disabled}
        {...rest}
        onClick={(e) => {
          rest.onClick?.(e);
          const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
          try { el.showPicker?.(); } catch {}
        }}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          opacity: 0, margin: 0, padding: 0, border: "none",
          cursor: disabled ? "default" : "pointer",
        }}
      />
    </span>
  );
});
