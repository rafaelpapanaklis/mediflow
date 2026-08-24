"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas chiquitas que comparten la agenda y la fila virtual.
//
// El modal se renderiza EN EL ÁRBOL, no con createPortal a <body>: los
// tokens del tema caramelo viven bajo `.barber-shell`, y un portal fuera
// del shell saldría con los colores del panel dental. A cambio hay que
// montarlo FUERA del contenedor con `container-type` (que atraparía al
// position:fixed) — por eso los modales cuelgan de la raíz de cada
// pantalla y no de la rejilla.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import css from "./agenda.module.css";

export type Tone = "info" | "brand" | "warning" | "success" | "danger" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  info: css.toneInfo,
  brand: css.toneBrand,
  warning: css.toneWarning,
  success: css.toneSuccess,
  danger: css.toneDanger,
  neutral: css.toneNeutral,
};

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`${css.pill} ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: string | null;
}) {
  return (
    <div className={css.field}>
      <span className={css.label}>{label}</span>
      {children}
      {hint ? <p className={css.hint}>{hint}</p> : null}
      {error ? <p className={css.errorText}>{error}</p> : null}
    </div>
  );
}

/**
 * Modal accesible sin dependencias: Escape cierra, el foco entra al abrir y
 * regresa a donde estaba al cerrar, y el clic en el fondo cierra (pero no
 * el clic que empezó DENTRO y terminó fuera al arrastrar).
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  closeLabel: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<Element | null>(null);
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [tabindex]:not([tabindex='-1'])",
    );
    firstFocusable?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = returnFocusRef.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [onClose]);

  return (
    <div
      className={css.backdrop}
      role="presentation"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${css.modal} ${wide ? css.modalWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={css.modalHead}>
          <h2 className={css.modalTitle}>{title}</h2>
          <button type="button" className={css.iconBtn} onClick={onClose} aria-label={closeLabel}>
            <X size={16} />
          </button>
        </div>
        <div className={css.modalBody}>{children}</div>
        {footer ? <div className={css.modalFoot}>{footer}</div> : null}
      </div>
    </div>
  );
}

/** Aviso flotante con acción opcional (el "Deshacer" de mover una visita). */
export function Toast({
  message,
  note,
  actionLabel,
  onAction,
  tone,
}: {
  message: string;
  note?: string | null;
  actionLabel?: string | null;
  onAction?: () => void;
  tone?: "ok" | "bad";
}) {
  return (
    <div className={`${css.toast} ${tone === "bad" ? css.toastBad : ""}`} role="status">
      <span>
        {message}
        {note ? <span className={css.toastNote}> · {note}</span> : null}
      </span>
      {actionLabel && onAction ? (
        <button type="button" className={css.toastAction} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Iniciales para el avatar del barbero cuando no hay foto. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Color estable por barbero: el mismo barbero se pinta siempre igual sin
 * guardar nada en la base. Tonos cálidos para no pelear con el caramelo.
 */
export function barberColor(barberId: string): string {
  let hash = 0;
  for (let i = 0; i < barberId.length; i++) hash = (hash * 31 + barberId.charCodeAt(i)) >>> 0;
  const hues = [26, 200, 150, 340, 45, 265, 15, 180];
  return `hsl(${hues[hash % hues.length]} 62% 45%)`;
}

export { css as agendaCss };
