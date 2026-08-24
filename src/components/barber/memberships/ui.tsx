"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Piezas compartidas de la pantalla de membresías. Nada de librerías nuevas:
 * el tema caramelo y membresias.css hacen el trabajo.
 */

/**
 * Modal montado con portal en <body>. Va FUERA de .bmem a propósito: ese
 * contenedor usa container-type y un ancestro con container-type atrapa a los
 * position:fixed (el modal quedaría recortado dentro de la tarjeta).
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // El foco entra al modal para que el teclado no se quede detrás.
    const timer = window.setTimeout(() => {
      const first = boxRef.current?.querySelector<HTMLElement>(
        "input, select, textarea, button:not(.bmem-modal-close)",
      );
      first?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="bmem-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="bmem-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="bmem-modal-head">
          <h2 className="bmem-modal-title">{title}</h2>
          <button type="button" className="bmem-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {children}
        {footer ? <div className="bmem-modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="bmem-field">
      <label className="bmem-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="bmem-hint">{hint}</p> : null}
    </div>
  );
}

export type BadgeTone = "brand" | "ok" | "warn" | "bad" | "mute";

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return <span className={`bmem-badge t-${tone}`}>{children}</span>;
}

export function Chips<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="bmem-chips" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`bmem-chip${o.value === value ? " is-on" : ""}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CheckCard({
  checked,
  onChange,
  title,
  hint,
  name,
  type = "checkbox",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  hint?: string;
  name?: string;
  type?: "checkbox" | "radio";
}) {
  return (
    <label className={`bmem-check${checked ? " is-on" : ""}`}>
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="bmem-check-body">
        <span className="bmem-check-title">{title}</span>
        {hint ? <span className="bmem-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export function MoneyInput({
  value,
  onChange,
  id,
  placeholder,
  currency = "$",
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
  currency?: string;
}) {
  return (
    <div className="bmem-money">
      <span className="bmem-money-prefix">{currency}</span>
      <input
        id={id}
        className="bmem-input"
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        // Solo dígitos y un punto: nada de floats raros llegando al servidor.
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
      />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bmem-empty">
      <span className="bmem-empty-title">{title}</span>
      <p className="bmem-empty-body">{body}</p>
      {children}
    </div>
  );
}

/**
 * Respuesta de apiCall. Un solo objeto con los dos campos opcionales: con
 * `strict: false` TypeScript no estrecha uniones discriminadas por `ok`.
 */
export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** POST/PATCH/etc. con manejo de error uniforme. */
export async function apiCall<T = any>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      return { ok: false, error: data?.error ?? "Algo salió mal. Intenta de nuevo." };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "No hay conexión. Revisa tu internet e intenta de nuevo." };
  }
}
