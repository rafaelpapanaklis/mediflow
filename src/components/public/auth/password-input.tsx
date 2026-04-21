"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";

interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "type"> {
  label?: string;
  error?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { label, error, ...rest },
  ref,
) {
  const [show, setShow] = useState(false);
  const borderColor = error ? "rgba(239,68,68,0.5)" : "var(--ld-border)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
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
      )}

      <div style={{ position: "relative" }}>
        <input
          ref={ref}
          type={show ? "text" : "password"}
          {...rest}
          style={{
            width: "100%",
            height: 42,
            padding: "0 44px 0 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${borderColor}`,
            color: "var(--ld-fg)",
            fontSize: 14,
            fontFamily: "inherit",
            outline: "none",
            transition: "border-color .15s",
            boxSizing: "border-box",
          }}
          onFocus={e => {
            if (!error) e.currentTarget.style.borderColor = "rgba(124,58,237,0.6)";
            rest.onFocus?.(e);
          }}
          onBlur={e => {
            if (!error) e.currentTarget.style.borderColor = "var(--ld-border)";
            rest.onBlur?.(e);
          }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          tabIndex={-1}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            width: 30,
            height: 30,
            borderRadius: 6,
            background: "transparent",
            border: "none",
            color: "var(--ld-fg-muted)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      {error && <div style={{ fontSize: 11, color: "#f87171", lineHeight: 1.4 }}>{error}</div>}
    </div>
  );
});

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
