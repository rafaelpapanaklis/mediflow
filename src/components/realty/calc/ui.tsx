"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas de las tres calculadoras.
//
// Estilo del vertical: estilos en línea con los tokens de realty-theme.css
// y medidas en PX (la raíz del panel mide 13px, así que un rem aquí no mide
// lo que uno espera). Nada de @media: el contenedor .realty-page declara
// container-type, así que las consultas son @container realty.
//
// No hay Select, Tabs ni Alert en src/components/ui: el repo los resuelve
// con elementos nativos y ARIA a mano, y eso es lo que se hace aquí.
// ═══════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import type { CalcFaltante } from "@/lib/realty/calc/catalog";

// ── Contenedores ───────────────────────────────────────────────────────

export function Tarjeta({
  children,
  titulo,
  sub,
  accion,
  padded = true,
}: {
  children: ReactNode;
  titulo?: string;
  sub?: string;
  accion?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 16,
        overflow: "hidden",
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
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
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

export function Rejilla({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

// ── Campos ─────────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  width: "100%",
  height: 38,
  background: "var(--bg)",
  color: "var(--text-1)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  padding: "0 11px",
  fontSize: 13.5,
  outline: "none",
  fontFamily: "inherit",
};

export function Campo({
  label,
  hint,
  htmlFor,
  children,
  error,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.01em" }}
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <span style={{ fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.45 }}>{hint}</span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11.5, color: "#c0392b", lineHeight: 1.45 }}>
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Input de dinero. El estado es STRING y no number a propósito: con number
 * no se puede dejar el campo vacío sin que quede un cero pegajoso, y el
 * usuario que borra para reescribir se pelea con el cursor.
 */
export function InputDinero({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 11,
          top: 0,
          height: 38,
          display: "flex",
          alignItems: "center",
          fontSize: 13.5,
          color: "var(--text-4)",
          pointerEvents: "none",
        }}
      >
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) =>
          // Solo dígitos y un punto: así nunca llega un float raro al cálculo.
          onChange(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))
        }
        style={{ ...inputBase, paddingLeft: 24 }}
      />
    </div>
  );
}

export function InputNumero({
  id,
  value,
  onChange,
  placeholder,
  sufijo,
  min,
  max,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  sufijo?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        autoComplete="off"
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputBase, paddingRight: sufijo ? 40 : undefined }}
      />
      {sufijo && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 11,
            top: 0,
            height: 38,
            display: "flex",
            alignItems: "center",
            fontSize: 12,
            color: "var(--text-4)",
            pointerEvents: "none",
          }}
        >
          {sufijo}
        </span>
      )}
    </div>
  );
}

export function Selector({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={inputBase}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Casilla({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        padding: "10px 12px",
        border: `1px solid ${checked ? "var(--border-brand)" : "var(--border-soft)"}`,
        background: checked ? "var(--brand-softer)" : "var(--bg)",
        borderRadius: 10,
        cursor: "pointer",
        transition: "background .12s, border-color .12s",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--brand)", width: 15, height: 15 }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, color: "var(--text-1)", fontWeight: 600 }}>
          {label}
        </span>
        {hint && (
          <span style={{ display: "block", fontSize: 11.5, color: "var(--text-4)", marginTop: 2 }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

// ── Botones ────────────────────────────────────────────────────────────

export function Boton({
  children,
  onClick,
  variante = "ghost",
  disabled,
  type = "button",
  icon,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  variante?: "primario" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  icon?: ReactNode;
  full?: boolean;
}) {
  const primario = variante === "primario";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        width: full ? "100%" : undefined,
        height: 36,
        padding: "0 15px",
        borderRadius: 10,
        fontSize: 12.5,
        // El texto blanco va sobre 600/700 del verde, nunca sobre un tono claro.
        fontWeight: primario ? 700 : 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        border: primario ? "1px solid transparent" : "1px solid var(--border-soft)",
        // El respaldo es el pine-700 de verdad (#27543E). Poner el 600 hacía
        // que el mismo botón cambiara de tono fuera del panel.
        background: primario ? "var(--pine-700, #27543E)" : "var(--bg)",
        color: primario ? "#fff" : "var(--text-2)",
        fontFamily: "inherit",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Resultado ──────────────────────────────────────────────────────────

export function CifraGrande({
  label,
  valor,
  sub,
  destacado,
}: {
  label: string;
  valor: string;
  sub?: string;
  destacado?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: destacado ? "var(--brand-softer)" : "var(--bg-elev-2)",
        border: `1px solid ${destacado ? "var(--border-brand)" : "var(--border-soft)"}`,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-3)",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: destacado ? 22 : 18,
          fontWeight: 700,
          color: "var(--text-1)",
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
          overflowWrap: "anywhere",
        }}
      >
        {valor}
      </div>
      {sub && (
        <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.45 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function FilaDesglose({
  etiqueta,
  explicacion,
  valor,
  fuerte,
}: {
  etiqueta: string;
  explicacion?: string;
  valor: string;
  fuerte?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 14,
        padding: "10px 0",
        borderBottom: "1px solid var(--border-soft)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--text-1)",
            fontWeight: fuerte ? 700 : 500,
          }}
        >
          {etiqueta}
        </div>
        {explicacion && (
          <div style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 2, lineHeight: 1.45 }}>
            {explicacion}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: fuerte ? 700 : 600,
          color: "var(--text-1)",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {valor}
      </div>
    </div>
  );
}

// ── Avisos ─────────────────────────────────────────────────────────────

export function Nota({
  children,
  tono = "info",
}: {
  children: ReactNode;
  tono?: "info" | "aviso";
}) {
  const aviso = tono === "aviso";
  return (
    <div
      style={{
        display: "flex",
        gap: 9,
        padding: "10px 12px",
        borderRadius: 10,
        background: aviso ? "rgba(191, 130, 20, 0.10)" : "var(--bg-elev-2)",
        border: `1px solid ${aviso ? "rgba(191, 130, 20, 0.32)" : "var(--border-soft)"}`,
        fontSize: 12,
        color: "var(--text-2)",
        lineHeight: 1.5,
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 1, color: aviso ? "#a8741a" : "var(--text-4)" }}>
        {aviso ? <AlertTriangle size={14} /> : <Info size={14} />}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

/**
 * La leyenda obligatoria. Va pegada a TODO resultado: ningún número de este
 * módulo se pinta sin ella.
 */
export function Leyenda({ texto }: { texto: string }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 11.5,
        color: "var(--text-4)",
        lineHeight: 1.55,
        fontStyle: "italic",
      }}
    >
      {texto}
    </p>
  );
}

/**
 * Cuando falta un parámetro, la calculadora NO calcula: dice qué falta y
 * cómo se resuelve. Es la degradación elegante que exige el contrato.
 */
export function Faltantes({
  faltantes,
  titulo,
  cuerpo,
}: {
  faltantes: CalcFaltante[];
  titulo: string;
  cuerpo: string;
}) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        background: "rgba(191, 130, 20, 0.08)",
        border: "1px solid rgba(191, 130, 20, 0.30)",
      }}
    >
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: "#a8741a" }} />
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--text-1)" }}>
            {titulo}
          </h3>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
            {cuerpo}
          </p>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
            {faltantes.map((f, i) => (
              <li key={`${f.kind}-${f.stateCode}-${i}`} style={{ fontSize: 12.5, color: "var(--text-1)" }}>
                <strong style={{ fontWeight: 600 }}>{f.etiqueta}</strong>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }}>
                  {f.comoResolver}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function ListaPasos({ titulo, pasos }: { titulo: string; pasos: string[] }) {
  if (pasos.length === 0) return null;
  return (
    <div>
      <h4
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-3)",
          fontWeight: 700,
        }}
      >
        {titulo}
      </h4>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {pasos.map((p, i) => (
          <li key={i} style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
