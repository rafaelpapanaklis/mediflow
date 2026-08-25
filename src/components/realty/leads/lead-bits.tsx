"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { HEAT_COLORS, TONE_COLORS, type RealtyContactHeat, type RealtyTone } from "./lead-ui";

/** Píldora de estado. Los seis tonos son los del contrato (REALTY_*_UI). */
export function Chip({
  tone = "neutral",
  children,
  title,
}: {
  tone?: RealtyTone;
  children: ReactNode;
  title?: string;
}) {
  const c = TONE_COLORS[tone];
  return (
    <span
      className="lead-chip"
      title={title}
      style={{ color: c.fg, background: c.bg, borderColor: c.border }}
    >
      {children}
    </span>
  );
}

/** El semáforo: punto de color + cuánto lleva. */
export function HeatBadge({
  heat,
  label,
  never,
  neverLabel,
}: {
  heat: RealtyContactHeat;
  label: string;
  never: boolean;
  neverLabel: string;
}) {
  const c = HEAT_COLORS[heat];
  return (
    <span
      className="lead-chip"
      style={{ color: c.text, background: c.bg, borderColor: "transparent" }}
      title={never ? neverLabel : label}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: c.dot,
          flexShrink: 0,
          // El anillo hace legible el punto rojo sobre el fondo rojo suave
          // (y sostiene el semáforo para quien no distingue rojo de verde:
          // el texto de al lado dice el tiempo, el color solo acompaña).
          boxShadow: heat === "NEUTRO" ? "none" : `0 0 0 2px ${c.bg}`,
        }}
      />
      {never ? neverLabel : label}
    </span>
  );
}

export function Field({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="lead-field">
      <label className="lead-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help ? <span className="lead-help">{help}</span> : null}
    </div>
  );
}

/**
 * Diálogo del área.
 *
 * 🔴 SE PINTA EN UN PORTAL A <body>, y no donde lo monta quien lo usa. La
 * razón es concreta: `.realty-page` declara container-type (realty-theme.css)
 * y un container-type CREA CONTEXTO DE CONTENCIÓN, que ATRAPA a
 * position:fixed — el modal se quedaría anclado a la página y se iría con el
 * scroll en vez de quedarse fijo en la pantalla. Con el portal deja de
 * importar desde qué componente se abre.
 *
 * 🔴 Y el destino del portal es `.realty-shell`, NO <body>. Los tokens
 * semánticos del vertical (--bg-elev, --text-1, --brand…) se declaran EN
 * `.realty-shell`; un portal a <body> cae fuera de esa cascada y el modal
 * sale con fondo transparente y texto del color de otro producto. El shell
 * no declara container-type (eso solo lo hace `.realty-page`), así que
 * escapar hasta ahí basta para soltar el fixed sin perder el tema.
 *
 * El portal se monta después del primer render: en el servidor no existe
 * `document`, y pintarlo en el HTML inicial daría un desajuste de
 * hidratación.
 */
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

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Enfoca el panel para que el lector de pantalla anuncie el diálogo y
    // el tabulador empiece dentro.
    ref.current?.focus();
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
      className="lead-dialog__overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={wide ? "lead-dialog lead-dialog--wide" : "lead-dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>{title}</h2>
          <button type="button" className="lead-btn lead-btn--sm lead-btn--ghost" onClick={onClose}>
            <X size={15} aria-hidden />
            <span className="lead-sr">{closeLabel}</span>
          </button>
        </div>
        {children}
        {footer ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.querySelector(".realty-shell") ?? document.body,
  );
}

export function Kpi({
  label,
  value,
  help,
  tone = "neutral",
  onClick,
  active,
}: {
  label: string;
  value: number | string;
  help?: string;
  tone?: RealtyTone;
  onClick?: () => void;
  active?: boolean;
}) {
  const c = TONE_COLORS[tone];
  const inner = (
    <>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700, color: c.fg, lineHeight: 1.1 }}>{value}</span>
      {help ? (
        <span style={{ fontSize: 11, color: "var(--text-4)", lineHeight: 1.4 }}>{help}</span>
      ) : null}
    </>
  );
  const style: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: "11px 13px",
    background: "var(--bg-elev)",
    border: `1px solid ${active ? c.border : "var(--border-soft)"}`,
    borderRadius: 13,
    boxShadow: active ? "var(--shadow-2)" : "var(--shadow-1)",
    textAlign: "left",
    minWidth: 0,
  };
  if (!onClick) return <div style={style}>{inner}</div>;
  return (
    <button type="button" onClick={onClick} style={{ ...style, cursor: "pointer", font: "inherit" }}>
      {inner}
    </button>
  );
}

/** Ahora, refrescado cada minuto: el semáforo se mueve solo sin recargar. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    // Al volver a la pestaña se recalcula de inmediato: los temporizadores
    // se frenan en segundo plano y el semáforo llegaría atrasado.
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
  return now;
}

/** Botón de copiar con acuse. */
export function CopyButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      className="lead-btn lead-btn--sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Sin permiso de portapapeles (o http): se selecciona para que la
          // persona copie a mano en vez de quedarse sin nada.
          const el = document.createElement("textarea");
          el.value = value;
          document.body.appendChild(el);
          el.select();
          try {
            document.execCommand("copy");
            setCopied(true);
          } catch {
            /* sin copiar: el texto está a la vista */
          }
          document.body.removeChild(el);
        }
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
