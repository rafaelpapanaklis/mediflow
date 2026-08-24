"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { makeT, type Dictionary, type TVars } from "@/i18n/t";
import s from "./clients.module.css";

/**
 * Piezas compartidas del módulo de clientes barber. Todo lo visual sale de
 * los tokens de barber-theme.css: aquí no hay un solo color de marca escrito
 * a mano, así que light y dark ya vienen resueltos.
 */

// ── i18n en cliente ────────────────────────────────────────────────────
// El servidor resuelve el locale de la barbería y baja SOLO el subárbol
// `barber.clientes`, así que las llaves son cortas: t("tabs.all"). Mismo
// motor makeT que usa el servidor — imposible que diverjan.

export type BarberT = (key: string, vars?: TVars) => string;

export function useBarberT(dict: Dictionary): BarberT {
  return useMemo(() => makeT(dict), [dict]);
}

// ── Insignias ──────────────────────────────────────────────────────────

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "danger" | "success";
}) {
  const cls =
    tone === "brand"
      ? `${s.badge} ${s.badgeBrand}`
      : tone === "danger"
        ? `${s.badge} ${s.badgeDanger}`
        : tone === "success"
          ? `${s.badge} ${s.badgeSuccess}`
          : s.badge;
  return <span className={cls}>{children}</span>;
}

// ── Sellos de la tarjeta de lealtad ────────────────────────────────────

export function Stamps({
  filled,
  total,
  big = false,
  label,
}: {
  filled: number;
  total: number;
  big?: boolean;
  label?: string;
}) {
  // Una tarjeta de 60 sellos no se pinta punto por punto: se resume.
  const dots = Math.min(total, 20);
  const scale = total > dots ? dots / total : 1;
  const on = Math.round(Math.min(filled, total) * scale);
  return (
    <div
      className={`${s.stamps} ${big ? s.stampsBig : ""}`}
      role="img"
      aria-label={label ?? `${filled}/${total}`}
    >
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className={`${s.stamp} ${i < on ? s.stampOn : ""}`} aria-hidden="true" />
      ))}
    </div>
  );
}

// ── Campo de formulario ────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  htmlFor,
  wide = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${s.field} ${wide ? s.prefWide : ""}`}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className={s.errorText}>{error}</span> : null}
      {!error && hint ? <span className={s.hint}>{hint}</span> : null}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────

/**
 * OJO CONTAINER QUERIES: este overlay es `position: fixed`, y un ancestro
 * con `container-type` lo anclaría al contenedor en vez de a la ventana. Por
 * eso se monta como HERMANO de la página, nunca dentro de un .cq*. Ver la
 * cabecera de clients.module.css.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  closeLabel = "Cerrar",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  closeLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // El foco entra al panel para que el lector de pantalla y el teclado
    // no se queden atrás en la página.
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input, textarea, select, button",
    );
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className={s.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${s.modal} ${wide ? s.modalWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={s.modalHead}>
          <h2 className={s.modalTitle}>{title}</h2>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label={closeLabel}>
            <X size={16} />
          </button>
        </div>
        <div className={s.modalBody}>{children}</div>
        {footer ? <div className={s.modalFoot}>{footer}</div> : null}
      </div>
    </div>
  );
}

// ── Aviso efímero ──────────────────────────────────────────────────────

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const node = message ? (
    <div className={s.toast} role="status" aria-live="polite">
      {message}
    </div>
  ) : null;

  return { show, node };
}

// ── Iniciales para el avatar ───────────────────────────────────────────

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Formato de teléfono y fechas ───────────────────────────────────────

/** 5512345678 → 55 1234 5678. Solo presentación; en BD van los 10 dígitos. */
export function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length !== 10) return phone;
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}

export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "en" ? "en-US" : "es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Hoy" / "Ayer" / "hace N días" / fecha corta. */
export function relativeVisit(iso: string | null, t: BarberT, locale: string): string {
  if (!iso) return t("table.never");
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return t("table.never");
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return t("table.today");
  if (days === 1) return t("table.yesterday");
  if (days < 30) return t("table.daysAgo", { days });
  return formatDate(iso, locale);
}

export function formatMoney(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { s as clientStyles };
