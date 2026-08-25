"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import s from "./team.module.css";

// ═══════════════════════════════════════════════════════════════════════
// Kit de UI de Equipo / Oficinas / Comisiones (DaleControl Inmuebles).
//
// Propio y NO el design system del dental ni Radix, por la misma razón que
// barber: los portales de Radix montan en <body>, FUERA de .realty-shell, y
// ahí los tokens verdes no existen — un modal heredaría la tinta del panel
// dental. Todo lo de aquí vive dentro del árbol de la página.
//
// Los textos van en español de México directamente: este vertical es
// mexicano y esta ola no toca el índice compartido de diccionarios (lo
// comparten las diez terminales de la Ola 1).
// ═══════════════════════════════════════════════════════════════════════

export { s as styles };

// ── Red ────────────────────────────────────────────────────────────────

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
  if (!res.ok) throw new ApiError(data?.error || "Algo salió mal. Inténtalo de nuevo.");
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
      setError(err instanceof Error ? err.message : "Algo salió mal. Inténtalo de nuevo.");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, error, setError, run };
}

// ── Botones ────────────────────────────────────────────────────────────

export function Btn({
  children,
  variant = "default",
  size = "md",
  iconOnly,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  iconOnly?: boolean;
}) {
  const cls = [
    s.btn,
    size === "sm" ? s.btnSm : "",
    variant === "primary" ? s.btnPrimary : "",
    variant === "ghost" ? s.btnGhost : "",
    variant === "danger" ? s.btnDanger : "",
    iconOnly ? s.btnIcon : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" {...rest} className={cls}>
      {children}
    </button>
  );
}

// ── Formularios ────────────────────────────────────────────────────────

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
  return <input {...props} className={[s.input, props.className ?? ""].join(" ")} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      inputMode="decimal"
      {...props}
      className={[s.input, s.inputNum, props.className ?? ""].join(" ")}
    />
  );
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
      className={[s.switch, checked ? s.switchOn : ""].filter(Boolean).join(" ")}
    >
      <span className={s.switchThumb} />
    </button>
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
      <div className={s.switchRowText}>
        <span className={s.switchRowTitle}>{title}</span>
        {hint ? <span className={s.hint}>{hint}</span> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

// ── Piezas de contenido ────────────────────────────────────────────────

export function Chip({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "brand" | "warn" | "danger" | "ok" | "muted";
}) {
  const cls = [
    s.chip,
    tone === "brand" ? s.chipBrand : "",
    tone === "warn" ? s.chipWarn : "",
    tone === "danger" ? s.chipDanger : "",
    tone === "ok" ? s.chipOk : "",
    tone === "muted" ? s.chipMuted : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={cls}>{children}</span>;
}

export function Banner({
  title,
  icon,
  tone = "brand",
  children,
}: {
  title?: string;
  icon?: ReactNode;
  tone?: "brand" | "warn" | "danger";
  children: ReactNode;
}) {
  const cls = [s.banner, tone === "warn" ? s.bannerWarn : "", tone === "danger" ? s.bannerDanger : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      {icon ? <span className={s.bannerIcon}>{icon}</span> : null}
      <div style={{ minWidth: 0 }}>
        {title ? <p className={s.bannerTitle}>{title}</p> : null}
        <p className={s.bannerBody}>{children}</p>
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className={s.errorText} role="alert">
      {children}
    </p>
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
      <div className={s.emptyTitle}>{title}</div>
      {body ? <p className={s.emptyBody}>{body}</p> : null}
      {action}
    </div>
  );
}

export function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <div className={s.avatar}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className={s.avatarImg} />
      ) : (
        initials
      )}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  hero,
}: {
  label: string;
  value: string;
  hint?: string;
  hero?: boolean;
}) {
  return (
    <div className={[s.kpi, hero ? s.kpiHero : ""].filter(Boolean).join(" ")}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={s.kpiValue}>{value}</span>
      {hint ? <span className={s.kpiHint}>{hint}</span> : null}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────

export function Modal({
  title,
  subtitle,
  onClose,
  footer,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  // Escape cierra, y mientras está abierto la página de atrás no hace scroll:
  // sin esto, el fondo se mueve bajo el modal en móvil y se pierde el sitio.
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
      className={s.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={[s.modal, wide ? s.modalWide : ""].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={s.modalHead}>
          <div style={{ minWidth: 0 }}>
            <h2 className={s.modalTitle}>{title}</h2>
            {subtitle ? <p className={s.modalSub}>{subtitle}</p> : null}
          </div>
          <Btn variant="ghost" iconOnly onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </Btn>
        </div>
        <div className={s.modalBody}>{children}</div>
        {footer ? <div className={s.modalFoot}>{footer}</div> : null}
      </div>
    </div>
  );
}

// ── Formato ────────────────────────────────────────────────────────────

/** Fecha corta es-MX ("14 ago 2026"). Vacío → "—". */
export function fmtDate(iso: string | null, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    });
  } catch {
    return d.toLocaleDateString("es-MX");
  }
}

/** "hace 3 días" / "hoy" / "nunca" — para el último acceso. */
export function fmtSince(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "nunca";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  if (days < 365) return `hace ${Math.floor(days / 30)} meses`;
  return `hace ${Math.floor(days / 365)} años`;
}

/** Plural sencillo: plural(3, "inmueble", "inmuebles") → "3 inmuebles". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * ¿Una credencial con fecha ya venció? ("YYYY-MM-DD", null = no vence.)
 *
 * Vive aquí y no en src/lib/realty/team.ts porque quien la necesita es el
 * formulario de la ficha del asesor, que es "use client": team.ts es
 * server-only y arrastrarlo al navegador revienta el build.
 *
 * La web pública no debe presumir un registro estatal caducado — es justo lo
 * que un cliente puede verificar en dos minutos.
 */
export function isCredentialExpired(date: string | null, now: Date = new Date()): boolean {
  if (!date) return false;
  const d = new Date(`${date}T23:59:59Z`);
  return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime();
}
