"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas de Rentas y Cobranza. Nada de esto vive en
// src/components/ui: los primitivos de ahí están hechos con los tokens del
// panel dental (bg-card, text-muted-foreground) y varios traen violetas
// escritos a mano que en el panel verde se ven fuera de lugar.
//
// 🔴 El <Modal> se monta con PORTAL en <body>. La pantalla declara
// container-type (.rnt) y eso ATRAPA a position:fixed: un modal dentro del
// contenedor se pintaría recortado al ancho de la tarjeta. Por eso el CSS
// del modal vuelve a declarar sus tokens: al montar fuera del shell ya no
// hereda los del vertical.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type Tone = "success" | "brand" | "info" | "warning" | "danger" | "neutral";

// ── Píldora ─────────────────────────────────────────────────────────────

export function Pill({
  tone = "neutral",
  dot,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`rnt-pill rnt-pill--${tone}`}>
      {dot ? <span className="rnt-pill__dot" /> : null}
      {children}
    </span>
  );
}

// ── Tarjeta ─────────────────────────────────────────────────────────────

export function Card({
  title,
  sub,
  action,
  flush,
  children,
}: {
  title?: string;
  sub?: string;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rnt-card">
      {title || action ? (
        <header className="rnt-card__head">
          <div style={{ minWidth: 0 }}>
            {title ? <div className="rnt-card__title">{title}</div> : null}
            {sub ? <div className="rnt-card__sub">{sub}</div> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={flush ? "rnt-card__body rnt-card__body--flush" : "rnt-card__body"}>
        {children}
      </div>
    </section>
  );
}

// ── KPI ─────────────────────────────────────────────────────────────────

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "good";
}) {
  const cls = tone ? `rnt-kpi rnt-kpi--${tone}` : "rnt-kpi";
  return (
    <div className={cls}>
      <div className="rnt-kpi__label">{label}</div>
      <div className="rnt-kpi__value">{value}</div>
      {hint ? <div className="rnt-kpi__hint">{hint}</div> : null}
    </div>
  );
}

// ── Campo de formulario ────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="rnt-field">
      <span className="rnt-field__label">{label}</span>
      {children}
      {hint ? <span className="rnt-field__hint">{hint}</span> : null}
    </label>
  );
}

// ── Vacío ───────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rnt-empty" role="status">
      <div className="rnt-empty__title">{title}</div>
      <p className="rnt-empty__body">{body}</p>
      {action}
    </div>
  );
}

// ── Aviso en línea ─────────────────────────────────────────────────────

export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger" | "brand";
  children: ReactNode;
}) {
  return (
    <div className={`rnt-note rnt-note--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <div>{children}</div>
    </div>
  );
}

// ── Pestañas ────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ key: T; label: string; count?: number }>;
  value: T;
  onChange: (key: T) => void;
  label: string;
}) {
  return (
    <div className="rnt-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === value}
          className="rnt-tab"
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {typeof t.count === "number" ? <span className="rnt-tab__count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────

export function Modal({
  open,
  title,
  sub,
  size,
  onClose,
  footer,
  children,
  closeLabel,
}: {
  open: boolean;
  title: string;
  sub?: string;
  size?: "wide" | "full";
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  closeLabel: string;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 🔴 onClose llega casi siempre como una flecha en línea
  // (`onClose={() => setX(false)}`), así que cambia de identidad en CADA
  // render del padre. Metido en las dependencias del efecto, el efecto se
  // volvía a correr con cada tecleo dentro del modal y el
  // `panelRef.focus()` le ROBABA el foco al textarea: se escribía una letra
  // y el cursor se salía. Por eso la función vive en un ref y el efecto
  // depende SOLO de `open`.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // El foco entra al panel UNA vez, al abrir: sin esto, tabular desde el
  // modal recorre la pantalla de atrás y quien navega con teclado se pierde.
  // `mounted` va en las dependencias porque en el primer render el portal
  // todavía no existe y el ref está en null: sin él, un modal que nace
  // abierto nunca recibiría el foco.
  useEffect(() => {
    if (!open || !mounted) return;
    panelRef.current?.focus();
  }, [open, mounted]);

  if (!open || !mounted) return null;

  const cls = size === "full" ? "rnt-modal rnt-modal--full" : size === "wide" ? "rnt-modal rnt-modal--wide" : "rnt-modal";

  return createPortal(
    <div
      className="rnt-modal__overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cls}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="rnt-modal__head">
          <div style={{ minWidth: 0 }}>
            <div className="rnt-modal__title">{title}</div>
            {sub ? <div className="rnt-modal__sub">{sub}</div> : null}
          </div>
          <button type="button" className="rnt-modal__close" onClick={onClose} aria-label={closeLabel}>
            <X size={16} />
          </button>
        </header>
        <div className="rnt-modal__body">{children}</div>
        {footer ? <footer className="rnt-modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

// ── Comprimir la foto ANTES de subirla ─────────────────────────────────
//
// La evidencia del inventario se toma con el teléfono: una foto de 12 MP
// pesa 4-6 MB y el cupo del plan PROPIETARIO son 2 GB. Comprimida a 1600 px
// y JPEG 0.72 baja a ~250-400 KB sin perder lo que importa (una mancha, un
// vidrio roto). Se hace en el navegador para no gastar ni el cupo ni el
// tiempo de subida.
//
// Si algo falla (un formato que el canvas no sabe leer), se devuelve el
// archivo original: mejor una foto pesada que ninguna evidencia.

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.72;

export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gtx = canvas.getContext("2d");
    if (!gtx) return file;
    gtx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY),
    );
    // Si comprimir no ganó nada (una foto ya diminuta), se sube la original.
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  }
}

/** Bytes → "1.4 MB" / "320 KB". Para decirle al usuario qué está gastando. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
