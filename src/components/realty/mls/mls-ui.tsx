"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas de la BOLSA INMOBILIARIA.
//
// Estilo del vertical, igual que calc/ui.tsx: estilos en línea con los
// tokens de realty-theme.css y medidas en PX (la raíz del panel mide 13px,
// así que un rem aquí no mide lo que uno espera). Nada de @media: el
// contenedor .realty-page declara container-type, así que las consultas son
// @container realty.
//
// 🔴 EL MODAL VA POR PORTAL A <body>, y no es una manía: `.realty-page`
// declara `container-type: inline-size` y eso ATRAPA a position:fixed — un
// modal montado dentro se pintaría recortado al ancho de la tarjeta. Al
// salir del shell pierde los tokens del vertical, así que el portal vuelve
// a envolver todo en `.realty-shell`, que es SOLO un contenedor de
// variables (ver realty-theme.css: no declara layout). Así el modal hereda
// el verde del panel y su modo oscuro sin copiar un color a mano.
// ═══════════════════════════════════════════════════════════════════════

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { RealtyCurrency } from "@/lib/realty/types";

// ── Formato ────────────────────────────────────────────────────────────

/**
 * Dinero del vertical. Sin decimales: un inmueble de $4,250,000 no necesita
 * centavos y con ellos la tarjeta deja de caber.
 */
export function money(amount: number, currency: RealtyCurrency = "MXN"): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency === "USD" ? "USD" : "MXN",
      maximumFractionDigits: 0,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `$${Math.round(amount || 0).toLocaleString("es-MX")}`;
  }
}

/** Porcentaje sin ceros de relleno: 50 y no 50.00, pero 12.5 sí. */
export function pctText(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}%`;
}

/**
 * Fecha corta en la zona de la cuenta.
 *
 * `timeZone` se pasa SIEMPRE desde el servidor. Sin él, el navegador usa la
 * suya y una inmobiliaria de Cancún vería las fechas de una de Tijuana
 * corridas un día — que es exactamente el reclamo que nadie sabe explicar.
 */
export function fechaCorta(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }).format(d);
  } catch {
    return d.toLocaleDateString("es-MX");
  }
}

/** Metros cuadrados, sin decimales inventados. */
export function m2(n: number | null): string | null {
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  return `${Number.isInteger(n) ? n : Number(n.toFixed(1))} m²`;
}

// ── Contenedores ───────────────────────────────────────────────────────

export function Tarjeta({
  children,
  titulo,
  sub,
  accion,
  padded = true,
  style,
}: {
  children: ReactNode;
  titulo?: string;
  sub?: string;
  accion?: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 16,
        overflow: "hidden",
        ...style,
      }}
    >
      {(titulo || accion) && (
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid var(--border-soft)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            {titulo && (
              <h2
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--text-1)",
                  letterSpacing: "-0.01em",
                }}
              >
                {titulo}
              </h2>
            )}
            {sub && (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 12.5,
                  color: "var(--text-3)",
                  lineHeight: 1.5,
                }}
              >
                {sub}
              </p>
            )}
          </div>
          {accion}
        </header>
      )}
      <div style={padded ? { padding: 18 } : undefined}>{children}</div>
    </section>
  );
}

/**
 * Estado vacío. En la bolsa NO es un adorno: al principio va a estar vacía
 * de verdad, así que este componente es lo que la mayoría va a ver el
 * primer día. Por eso admite una acción — el vacío honesto dice qué pasa Y
 * qué se puede hacer, no solo "no hay nada".
 */
export function Vacio({
  icono,
  titulo,
  cuerpo,
  accion,
}: {
  icono?: ReactNode;
  titulo: string;
  cuerpo: string;
  accion?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "44px 24px",
        textAlign: "center",
      }}
    >
      {icono ? <div style={{ color: "var(--text-4)", marginBottom: 2 }}>{icono}</div> : null}
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>
        {titulo}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-3)",
          lineHeight: 1.65,
          maxWidth: 460,
        }}
      >
        {cuerpo}
      </p>
      {accion ? <div style={{ marginTop: 8 }}>{accion}</div> : null}
    </div>
  );
}

// ── Etiquetas ──────────────────────────────────────────────────────────

export type Tono = "brand" | "neutro" | "ok" | "aviso" | "malo";

const TONOS: Record<Tono, { bg: string; fg: string; bd: string }> = {
  brand: { bg: "var(--brand-soft)", fg: "var(--brand)", bd: "var(--border-brand)" },
  neutro: { bg: "var(--bg-elev-2)", fg: "var(--text-2)", bd: "var(--border-soft)" },
  ok: { bg: "rgba(63, 132, 97, 0.12)", fg: "var(--brand)", bd: "var(--border-brand)" },
  aviso: { bg: "rgba(191, 138, 20, 0.14)", fg: "#8A6100", bd: "rgba(191, 138, 20, 0.32)" },
  malo: { bg: "rgba(179, 38, 30, 0.10)", fg: "var(--danger)", bd: "rgba(179, 38, 30, 0.28)" },
};

export function Chip({
  children,
  tono = "neutro",
  title,
}: {
  children: ReactNode;
  tono?: Tono;
  title?: string;
}) {
  const c = TONOS[tono];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1.4,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * La comisión compartida, destacada. Es LO PRIMERO que mira el otro asesor,
 * así que se pinta como un dato y no como una etiqueta más entre otras.
 */
export function ComisionChip({ pct, cero }: { pct: number; cero: string }) {
  if (!pct || pct <= 0) {
    return <Chip tono="neutro">{cero}</Chip>;
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 8,
        background: "var(--brand-soft)",
        border: "1px solid var(--border-brand)",
        color: "var(--brand)",
        whiteSpace: "nowrap",
      }}
    >
      <strong style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em" }}>
        {pctText(pct)}
      </strong>
    </span>
  );
}

// ── Botones ────────────────────────────────────────────────────────────

export function Boton({
  children,
  onClick,
  variante = "ghost",
  disabled,
  type = "button",
  title,
  ancho,
}: {
  children: ReactNode;
  onClick?: () => void;
  variante?: "primario" | "ghost" | "peligro";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  ancho?: boolean;
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "8px 14px",
    borderRadius: 10,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    width: ancho ? "100%" : undefined,
    transition: "background 120ms ease, border-color 120ms ease",
  };
  if (variante === "primario") {
    return (
      <button
        type={type}
        title={title}
        onClick={onClick}
        disabled={disabled}
        className="realty-btn-primary"
        style={base}
      >
        {children}
      </button>
    );
  }
  const extra: CSSProperties =
    variante === "peligro"
      ? { border: "1px solid rgba(179, 38, 30, 0.32)", color: "var(--danger)", background: "transparent" }
      : { border: "1px solid var(--border-soft)", color: "var(--text-2)", background: "var(--bg-elev)" };
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} style={{ ...base, ...extra }}>
      {children}
    </button>
  );
}

// ── Campos ─────────────────────────────────────────────────────────────

const CAMPO_INPUT: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 9,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)",
  color: "var(--text-1)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

export function Campo({
  label,
  ayuda,
  children,
  htmlFor,
}: {
  label: string;
  ayuda?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}
      >
        {label}
      </label>
      {children}
      {ayuda ? (
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}

export function Texto({
  value,
  onChange,
  placeholder,
  id,
  type = "text",
  min,
  max,
  step,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  type?: "text" | "number" | "search";
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={CAMPO_INPUT}
    />
  );
}

export function Selector<T extends string>({
  value,
  onChange,
  options,
  id,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ ...CAMPO_INPUT, cursor: "pointer" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function AreaTexto({
  value,
  onChange,
  placeholder,
  id,
  rows = 3,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...CAMPO_INPUT, resize: "vertical", lineHeight: 1.6 }}
    />
  );
}

/** Interruptor con su etiqueta y su explicación. */
export function Interruptor({
  checked,
  onChange,
  label,
  ayuda,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  ayuda?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, width: 16, height: 16, accentColor: "var(--brand)", cursor: "inherit" }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
          {label}
        </span>
        {ayuda ? (
          <span
            style={{
              display: "block",
              fontSize: 11.5,
              color: "var(--text-3)",
              lineHeight: 1.55,
              marginTop: 2,
            }}
          >
            {ayuda}
          </span>
        ) : null}
      </span>
    </label>
  );
}

// ── Avisos ─────────────────────────────────────────────────────────────

export function Aviso({
  tono = "neutro",
  children,
  icono,
}: {
  tono?: Tono;
  children: ReactNode;
  icono?: ReactNode;
}) {
  const c = TONOS[tono];
  return (
    <div
      role={tono === "malo" ? "alert" : undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        padding: "10px 12px",
        borderRadius: 10,
        background: c.bg,
        border: `1px solid ${c.bd}`,
        color: c.fg,
        fontSize: 12.5,
        lineHeight: 1.6,
      }}
    >
      {icono ? <span style={{ flexShrink: 0, marginTop: 1 }}>{icono}</span> : null}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────

/**
 * Modal por PORTAL a <body>, envuelto en `.realty-shell` para no perder los
 * tokens (ver la cabecera de este archivo).
 *
 * `onClose` vive en un ref y NO en las dependencias del efecto: si el padre
 * la redefine en cada render —lo normal con una flecha en línea— el efecto
 * se vuelve a correr con cada tecleo y el `focus()` le roba el cursor al
 * campo que se está escribiendo. Le pasó a Rentas y se arregló así.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  pie,
  ancho = 620,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
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
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previo;
    };
  }, [open]);

  // `mounted` va en las dependencias porque en el primer render el portal
  // todavía no existe y el ref está en null: sin él, un modal que nace
  // abierto nunca recibiría el foco.
  useEffect(() => {
    if (!open || !mounted) return;
    panelRef.current?.focus();
  }, [open, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="realty-shell"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
      }}
    >
      <div
        onClick={() => closeRef.current()}
        style={{ position: "absolute", inset: 0, background: "rgba(14, 30, 22, 0.55)" }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: ancho,
          maxHeight: "92vh",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-elev)",
          color: "var(--text-1)",
          border: "1px solid var(--border-soft)",
          borderRadius: "16px 16px 0 0",
          boxShadow: "var(--shadow-3)",
          outline: "none",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-soft)",
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={() => closeRef.current()}
            aria-label={title}
            style={{
              display: "inline-flex",
              padding: 6,
              borderRadius: 8,
              border: "1px solid var(--border-soft)",
              background: "transparent",
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            <X size={15} />
          </button>
        </header>

        <div style={{ padding: 18, overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>

        {pie ? (
          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 18px",
              borderTop: "1px solid var(--border-soft)",
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            {pie}
          </footer>
        ) : null}
      </div>
      <style dangerouslySetInnerHTML={{ __html: MODAL_CSS }} />
    </div>,
    document.body,
  );
}

/**
 * El modal nace pegado abajo (hoja de móvil) y se centra en pantallas
 * anchas. Es @media y NO @container a propósito: al montarse por portal en
 * <body> ya no está dentro de `.realty-page`, así que no hay contenedor que
 * consultar. Es la única excepción a la regla del vertical, y esta es la
 * razón.
 */
const MODAL_CSS = `
@media (min-width: 640px) {
  .realty-shell [role="dialog"] {
    border-radius: 16px !important;
  }
  .realty-shell [role="dialog"]:not(.mls-sheet) {
    margin: auto !important;
  }
}
`;

// ── Rejilla ────────────────────────────────────────────────────────────

/**
 * Rejilla de tarjetas. `@container realty` y no `@media`: la pantalla vive
 * dentro de `.realty-page`, que declara el contenedor, y el sidebar cambia
 * el ancho disponible sin cambiar el de la ventana.
 */
export function Rejilla({ children, min = 250 }: { children: ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`,
      }}
    >
      {children}
    </div>
  );
}
