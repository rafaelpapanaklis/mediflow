"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Dictionary, TFunction } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import s from "./properties.module.css";

/**
 * Piezas compartidas por las pantallas de cartera y propietarios.
 *
 * ── i18n: CONVENCIÓN B, SIN EXCEPCIONES ────────────────────────────────
 * El servidor baja el sub-árbol YA RECORTADO (`realty.inmuebles`) y aquí
 * NO se antepone prefijo: t("title"), no t("realty.inmuebles.title").
 * Cruzar las dos convenciones aplica el prefijo dos veces y pinta la llave
 * cruda en pantalla — el bug de /barber/campanas. makeRealtyT lo grita en
 * consola en desarrollo; hay que hacerle caso.
 *
 * Se usa makeRealtyT y NUNCA makeT pelado: con makeT se pierde ese aviso
 * (y hay una prueba que lo comprueba recorriendo estos archivos).
 */
export { s as styles };

export function useRealtyT(dict: Dictionary): TFunction {
  return useMemo(() => makeRealtyT(dict), [dict]);
}

// ── Fetch con errores que se pueden enseñar ────────────────────────────
export class RealtyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RealtyApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Cliente HTTP del módulo. Devuelve el JSON ya tipado y lanza
 * RealtyApiError con el mensaje del servidor: la pantalla enseña ESE
 * texto, no uno genérico que no dice qué pasó.
 */
export async function apiCall<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers:
      json === undefined
        ? rest.headers
        : { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    body: json === undefined ? rest.body : JSON.stringify(json),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!res.ok) {
    throw new RealtyApiError(
      data?.error || "Algo salió mal. Inténtalo otra vez.",
      res.status,
      data?.code,
    );
  }
  return data as T;
}

/** Estado de guardado de una sección: ocupado + error propio. */
export function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      // Un componente desmontado a media petición no debe intentar pintar.
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Algo salió mal. Inténtalo otra vez.");
      }
      return false;
    } finally {
      if (alive.current) setSaving(false);
    }
  }, []);

  return { saving, error, setError, run };
}

// ── Presentación ───────────────────────────────────────────────────────
export type Tone = "info" | "brand" | "warning" | "success" | "danger" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  info: s.badgeInfo,
  brand: s.badgeBrand,
  warning: s.badgeWarning,
  success: s.badgeSuccess,
  danger: s.badgeDanger,
  neutral: s.badgeNeutral,
};

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={`${s.badge} ${TONE_CLASS[tone]}`} title={title}>
      {children}
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${s.field} ${wide ? s.wide : ""}`}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className={s.hint}>{hint}</span> : null}
      {error ? <span className={s.errorText}>{error}</span> : null}
    </div>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <span className={s.errorText} role="alert">
      {children}
    </span>
  );
}

/**
 * Diálogo del módulo.
 *
 * 🔴 Lo monta quien lo usa FUERA de cualquier contenedor con
 * container-type (`.realty-page`, `.cardsWrap`, …): un position:fixed
 * dentro de un contexto de contención se ancla al contenedor y el modal
 * sale metido en una esquina. Por eso todas las pantallas de este módulo
 * lo renderizan como hermano del <div className={s.page}>.
 *
 * Tampoco se usa el Dialog de Radix: monta en un portal al <body>, fuera
 * de .realty-shell, donde los tokens verdes del vertical no existen — el
 * dental ya se quemó con modales que heredaban la tinta equivocada.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  closeLabel,
  footer,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeLabel: string;
  footer?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={s.overlay}
      role="presentation"
      onMouseDown={(e) => {
        // Solo el clic que EMPIEZA en el velo cierra: si no, arrastrar para
        // seleccionar texto y soltar fuera cerraba el diálogo a medio llenar.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`${s.modal} ${wide ? s.modalWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={s.modalHead}>
          <div>
            <h2 className={s.modalTitle}>{title}</h2>
            {subtitle ? <p className={s.modalSub}>{subtitle}</p> : null}
          </div>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label={closeLabel}>
            <X size={15} />
          </button>
        </div>
        <div className={s.modalBody}>{children}</div>
        {footer ? <div className={s.modalFoot}>{footer}</div> : null}
      </div>
    </div>
  );
}

// ── Formato ────────────────────────────────────────────────────────────
/**
 * Precio del INMUEBLE (nunca el de un plan: en este panel no se enseñan
 * precios de suscripción). Sin centavos: nadie anuncia una casa en
 * $2,450,000.00 y los decimales solo hacen ruido en la tabla.
 */
export function formatPrice(amount: number, currency: string, locale = "es-MX"): string {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
      style: "currency",
      currency: currency === "USD" ? "USD" : "MXN",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${Math.round(value).toLocaleString("es-MX")}`;
  }
}

export function formatNumber(n: number, locale = "es-MX"): string {
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX").format(n);
  } catch {
    return String(n);
  }
}

export function formatDate(iso: string | null | undefined, locale = "es"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "2.4 GB" / "860 MB". Espejo del helper del servidor (realty/media). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function initials(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/** Teléfono mexicano legible: 33 1234 5678. Deja tal cual lo que no cuadre. */
export function prettyPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  if (d.length === 12 && d.startsWith("52")) {
    const local = d.slice(2);
    return `+52 ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  return phone;
}

/** Valor de texto de un <input>, ya sin espacios de sobra. */
export function trimmed(v: string): string {
  return v.trim();
}

/**
 * Número de un input, o null si está vacío. `Number("")` es 0 y guardar un
 * cero donde el asesor no puso nada convierte "no sé" en "cero recámaras".
 */
export function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
