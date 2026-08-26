"use client";

// ═══════════════════════════════════════════════════════════════════════
// Átomos del área de Visitas y Llaves.
//
// El diálogo se pinta EN UN PORTAL A `.realty-shell`, y las dos mitades de
// esa frase importan:
//
//  · PORTAL, porque `.realty-page` declara container-type (realty-theme.css)
//    y un container-type CREA CONTEXTO DE CONTENCIÓN, que ATRAPA a
//    position:fixed. Sin el portal, el modal se ancla a la página y se va
//    con el scroll en vez de quedarse fijo en la pantalla.
//
//  · A `.realty-shell` Y NO A <body>, porque los tokens del vertical
//    (--bg-elev, --text-1, --brand…) se declaran EN `.realty-shell`. Un
//    portal a <body> cae fuera de esa cascada y el modal sale con el fondo
//    transparente y el texto del color de otro producto. El shell no
//    declara container-type, así que escapar hasta ahí basta para soltar el
//    fixed sin perder el tema.
//
// Es el mismo criterio del `Dialog` de prospectos (lead-bits.tsx). No se
// importa aquél a propósito: sus clases viven en LEADS_CSS, que solo
// inyectan las pantallas de prospectos, y este módulo tiene el suyo.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import css from "./visits.module.css";

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // El portal se monta DESPUÉS del primer render: en el servidor no existe
  // `document`, y pintarlo en el HTML inicial daría desajuste de hidratación.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    if (ref.current) ref.current.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={css.overlay}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={wide ? `${css.dialog} ${css.dialogWide}` : css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className={css.dialogHead}>
          <h2 className={css.dialogTitle}>{title}</h2>
          <button type="button" className={`${css.btn} ${css.btnGhost} ${css.btnSm}`} onClick={onClose} aria-label={closeLabel}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className={css.dialogBody}>{children}</div>
        {footer ? <div className={css.dialogFoot}>{footer}</div> : null}
      </div>
    </div>,
    document.querySelector(".realty-shell") ?? document.body,
  );
}

export interface ToastState {
  message: string;
  note?: string | null;
  tone?: "ok" | "bad";
  actionLabel?: string | null;
  onAction?: (() => void) | null;
}

export function Toast({ state, onDone }: { state: ToastState | null; onDone: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!state) return;
    // Con acción de deshacer se deja más tiempo: cinco segundos no alcanzan
    // para leer, decidir y hacer clic.
    const ms = state.onAction ? 9000 : 4200;
    const id = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(id);
  }, [state, onDone]);

  if (!mounted || !state) return null;

  return createPortal(
    <div className={state.tone === "bad" ? `${css.toast} ${css.toastBad}` : css.toast} role="status">
      <div>
        <span>{state.message}</span>
        {state.note ? <span className={css.toastNote}>{state.note}</span> : null}
      </div>
      {state.actionLabel && state.onAction ? (
        <button
          type="button"
          className={css.toastAction}
          onClick={() => {
            const run = state.onAction;
            onDone();
            if (run) run();
          }}
        >
          {state.actionLabel}
        </button>
      ) : null}
    </div>,
    document.querySelector(".realty-shell") ?? document.body,
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | null;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      {children}
      {error ? <span className={css.errorText}>{error}</span> : null}
      {!error && hint ? <span className={css.fieldHint}>{hint}</span> : null}
    </label>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "brand" | "danger" | "warn";
  children: ReactNode;
}) {
  const map = {
    neutral: css.pillNeutral,
    brand: css.pillBrand,
    danger: css.pillDanger,
    warn: css.pillWarn,
  };
  return <span className={`${css.pill} ${map[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={css.empty}>{children}</p>;
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn";
  children: ReactNode;
}) {
  return (
    <div className={`${css.banner} ${tone === "warn" ? css.bannerWarn : css.bannerInfo}`} role="note">
      {children}
    </div>
  );
}

/** Reloj de la pantalla. Un minuto basta: la línea del "ahora" no necesita más. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
