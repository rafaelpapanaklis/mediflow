"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { type Dictionary, type TVars } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import s from "./admin.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas de las pantallas de administración barber.
//
// i18n: el servidor manda el diccionario COMPLETO del vertical y aquí se
// arma el mismo makeT que usa el server. Así las llaves son idénticas en los
// dos lados ("barber.admin.…") y no hay dos verdades.
//
// Estilo: todo sale del tema caramelo por variables (.barber-shell). Ningún
// color en duro y ningún @media: el CSS module usa @container.
// ═══════════════════════════════════════════════════════════════════════

const DictContext = createContext<Dictionary | null>(null);

export function AdminI18n({ dict, children }: { dict: Dictionary; children: ReactNode }) {
  return <DictContext.Provider value={dict}>{children}</DictContext.Provider>;
}

export type AdminT = (key: string, vars?: TVars) => string;

/** t() con el prefijo barber.admin ya puesto: t("team.title"). */
export function useT(): AdminT {
  const dict = useContext(DictContext);
  return useMemo(() => {
    return makeBarberT(dict ?? {}, "barber.admin");
  }, [dict]);
}

// ── Botón ──────────────────────────────────────────────────────────────

type BtnVariant = "primary" | "default" | "ghost" | "danger";

export function Btn({
  variant = "default",
  size,
  className,
  children,
  ...rest
}: {
  variant?: BtnVariant;
  size?: "sm";
  className?: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantClass =
    variant === "primary"
      ? s.btnPrimary
      : variant === "ghost"
        ? s.btnGhost
        : variant === "danger"
          ? s.btnDanger
          : "";
  return (
    <button
      type="button"
      {...rest}
      className={[s.btn, variantClass, size === "sm" ? s.btnSm : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

// ── Campos ─────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={[s.field, full ? s.formFull : ""].filter(Boolean).join(" ")}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint ? <p className={s.hint}>{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={s.input} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={s.textarea} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={s.select} />;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={s.switch}
    />
  );
}

export function SwitchRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={s.switchRow}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
        {hint ? <p className={s.hint} style={{ marginTop: 2 }}>{hint}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className={s.segmented}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={s.segment}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Modal propio ───────────────────────────────────────────────────────
// No se usa el Dialog de Radix a propósito: monta en un portal al <body>,
// FUERA de .barber-shell, y ahí los tokens del tema caramelo no existen (el
// dental ya se quemó con modales que heredaban la tinta equivocada). Este
// vive dentro del árbol de la página, así que hereda el tema. Su cadena de
// ancestros no lleva container-type, así que el position:fixed es real.

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className={s.modalRoot}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[s.modal, wide ? s.modalWide : ""].filter(Boolean).join(" ")}
      >
        <div className={s.modalHead}>
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} className={s.modalTitle}>
              {title}
            </h2>
            {subtitle ? <p className={s.modalSub}>{subtitle}</p> : null}
          </div>
          <Btn variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </Btn>
        </div>
        <div className={s.modalBody}>{children}</div>
        {footer ? <div className={s.modalFoot}>{footer}</div> : null}
      </div>
    </div>
  );
}

// ── Avisos y vacíos ────────────────────────────────────────────────────

export function Banner({
  title,
  children,
  tone,
  icon,
  action,
}: {
  title?: string;
  children: ReactNode;
  tone?: "danger";
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={[s.banner, tone === "danger" ? s.bannerDanger : ""].filter(Boolean).join(" ")}>
      {icon ? <div style={{ flexShrink: 0, color: "var(--brand)" }}>{icon}</div> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <p className={s.bannerTitle}>{title}</p> : null}
        <div className={s.bannerBody}>{children}</div>
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>{icon}</div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
      {body ? <p style={{ margin: 0, fontSize: 13, maxWidth: "46ch" }}>{body}</p> : null}
      {action}
    </div>
  );
}

export function Chip({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "brand" | "warn" | "danger" | "muted";
}) {
  const toneClass =
    tone === "brand"
      ? s.chipBrand
      : tone === "warn"
        ? s.chipWarn
        : tone === "danger"
          ? s.chipDanger
          : tone === "muted"
            ? s.chipMuted
            : "";
  return <span className={[s.chip, toneClass].filter(Boolean).join(" ")}>{children}</span>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className={s.errorText} role="alert">
      {children}
    </p>
  );
}

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  if (url) {
    // Foto externa pegada por la barbería: <img> normal a propósito (no
    // next/image, que exige allowlist de dominios y aquí el dominio es libre).
    return <img className={s.avatar} src={url} alt="" loading="lazy" />;
  }
  return (
    <div className={s.avatar} aria-hidden="true">
      {initials || "?"}
    </div>
  );
}

// ── Llamadas al API ────────────────────────────────────────────────────

export class ApiError extends Error {}

/**
 * fetch + JSON con el error del servidor ya legible. Todos los endpoints del
 * vertical responden { error } cuando algo falla, así que aquí se traduce a
 * un mensaje que la pantalla puede enseñar tal cual.
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
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new ApiError(data?.error || "Algo salió mal. Intenta de nuevo.");
  }
  return data as T;
}

/** Estado de "guardando + error" que repiten todos los formularios. */
export function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal. Intenta de nuevo.");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, error, setError, run };
}

/** Fecha corta legible en la zona del navegador. */
export function formatWhen(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export { s as adminStyles };
