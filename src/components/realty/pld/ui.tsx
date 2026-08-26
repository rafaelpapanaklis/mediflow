"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas del módulo de cumplimiento.
//
// Estilo del vertical: estilos EN LÍNEA con los tokens de realty-theme.css
// y medidas en PX — la raíz del panel mide 13px, así que un rem aquí no
// mide lo que uno espera. Nada de @media: el contenedor .realty-page
// declara container-type, así que las consultas serían @container realty.
//
// Se reutiliza el kit de las calculadoras (Tarjeta, Boton, Campo, Nota…)
// en vez de clonarlo: es del mismo vertical y ya resuelve los mismos
// problemas. Aquí solo viven las piezas que aquel no tiene.
//
// 🔴 EL MODAL VA POR createPortal Y NO PUEDE NO IRLO. `.realty-page`
// declara `container-type`, y un contenedor de consulta ATRAPA a sus hijos
// `position: fixed`: el overlay se quedaría dentro de la caja del panel,
// desplazado y recortado, en vez de cubrir la pantalla. Montándolo en
// document.body se sale de esa trampa — y por eso el modal vuelve a
// declarar los colores que ya no hereda del shell.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import type { EstadoExpediente, NivelUmbral, PldRisk } from "@/lib/realty/pld/contrato";

export type Tono = "neutral" | "ok" | "aviso" | "peligro" | "info";

const TONOS: Record<Tono, { fondo: string; borde: string; texto: string }> = {
  neutral: { fondo: "var(--bg-elev-2)", borde: "var(--border-soft)", texto: "var(--text-3)" },
  ok: { fondo: "rgba(22, 128, 84, 0.12)", borde: "rgba(22, 128, 84, 0.34)", texto: "#12805a" },
  aviso: { fondo: "rgba(191, 130, 20, 0.12)", borde: "rgba(191, 130, 20, 0.34)", texto: "#a8741a" },
  peligro: { fondo: "rgba(186, 40, 40, 0.12)", borde: "rgba(186, 40, 40, 0.34)", texto: "#b03030" },
  info: { fondo: "rgba(37, 99, 190, 0.12)", borde: "rgba(37, 99, 190, 0.32)", texto: "#2a63b8" },
};

export function Pastilla({
  tono = "neutral",
  children,
}: {
  tono?: Tono;
  children: ReactNode;
}) {
  const t = TONOS[tono];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        background: t.fondo,
        border: `1px solid ${t.borde}`,
        color: t.texto,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** El tono de cada estado, en UN solo sitio: dos tablas se separan solas. */
export const TONO_ESTADO: Record<EstadoExpediente, Tono> = {
  COMPLETO: "ok",
  INCOMPLETO: "aviso",
  VENCIDO: "peligro",
};

export const TONO_RIESGO: Record<PldRisk, Tono> = {
  BAJO: "ok",
  MEDIO: "aviso",
  ALTO: "peligro",
};

export const TONO_NIVEL: Record<NivelUmbral, Tono> = {
  NINGUNO: "neutral",
  IDENTIFICACION: "info",
  AVISO: "aviso",
};

/**
 * LA BANDERA ROJA DEL EFECTIVO.
 *
 * No es un aviso más y no se pinta como uno: la operación que la enciende
 * es ilegal, no "revisable". Por eso lleva su propio componente, con el
 * texto de contrato.ts pegado dentro, y no un <Nota tono="aviso"> que
 * cualquiera pudiera cambiar de tono sin darse cuenta.
 */
export function BanderaRoja({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(186, 40, 40, 0.10)",
        border: "1px solid rgba(186, 40, 40, 0.38)",
        color: "var(--text-1)",
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
      role="alert"
    >
      <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1, color: "#b03030" }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/**
 * La leyenda de alcance. Va ARRIBA de la pantalla, siempre visible, nunca
 * detrás de un acordeón: es la frase que separa "te ordeno el papeleo" de
 * "cumplo por ti".
 */
export function LeyendaLegal({ texto, fuerte }: { texto: string; fuerte?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 11.5,
        color: fuerte ? "var(--text-2)" : "var(--text-4)",
        lineHeight: 1.55,
        fontStyle: fuerte ? "normal" : "italic",
        fontWeight: fuerte ? 600 : 400,
      }}
    >
      {texto}
    </p>
  );
}

/** Una cifra del tablero. `tono` la enciende solo cuando hay algo que hacer. */
export function Contador({
  etiqueta,
  valor,
  tono = "neutral",
  pie,
  onClick,
}: {
  etiqueta: string;
  valor: number | string;
  tono?: Tono;
  pie?: string;
  onClick?: () => void;
}) {
  const t = TONOS[tono];
  const activo = tono !== "neutral";
  const contenido = (
    <>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: activo ? t.texto : "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {valor}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.4 }}>
        {etiqueta}
      </div>
      {pie && (
        <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 3, lineHeight: 1.4 }}>
          {pie}
        </div>
      )}
    </>
  );

  const estilo = {
    padding: "14px 16px",
    borderRadius: 12,
    background: activo ? t.fondo : "var(--bg-elev-2)",
    border: `1px solid ${activo ? t.borde : "var(--border-soft)"}`,
    textAlign: "left" as const,
    width: "100%",
    display: "block",
    cursor: onClick ? "pointer" : "default",
  };

  if (!onClick) return <div style={estilo}>{contenido}</div>;
  return (
    <button type="button" onClick={onClick} style={{ ...estilo, font: "inherit" }}>
      {contenido}
    </button>
  );
}

// ── Tabla ──────────────────────────────────────────────────────────────

/**
 * Envoltorio de tabla con scroll PROPIO. El panel nunca hace scroll
 * horizontal: la tabla ancha se desplaza dentro de su caja.
 */
export function Tabla({ children }: { children: ReactNode }) {
  return (
    <div style={{ overflowX: "auto", margin: "0 -2px", padding: "0 2px" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          minWidth: 640,
        }}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({ children, ancho }: { children: ReactNode; ancho?: number }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-4)",
        fontWeight: 700,
        borderBottom: "1px solid var(--border-soft)",
        whiteSpace: "nowrap",
        width: ancho,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numerico,
  colSpan,
}: {
  children: ReactNode;
  numerico?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "9px 10px",
        borderBottom: "1px solid var(--border-soft)",
        color: "var(--text-2)",
        verticalAlign: "top",
        textAlign: numerico ? "right" : "left",
        fontVariantNumeric: numerico ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </td>
  );
}

export function Vacio({ texto }: { texto: string }) {
  return (
    <div
      style={{
        padding: "28px 20px",
        textAlign: "center",
        fontSize: 12.5,
        color: "var(--text-4)",
        lineHeight: 1.6,
      }}
    >
      {texto}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────

/**
 * Modal montado en document.body. Ver la nota de la cabecera: dentro de
 * `.realty-page` un `position: fixed` queda ATRAPADO por el container-type.
 *
 * Al salir del shell ya no hereda los tokens del vertical, así que el panel
 * vuelve a declarar su fondo y su color de texto — si no, un modal blanco
 * hereda la tinta de la plantilla y sale texto claro sobre fondo claro.
 */
export function Modal({
  abierto,
  titulo,
  onCerrar,
  children,
  pie,
  ancho = 720,
}: {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: number;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto, onCerrar]);

  if (!abierto || !montado) return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(9, 18, 14, 0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
        overflowY: "auto",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        style={{
          width: "100%",
          maxWidth: ancho,
          // Se vuelven a declarar: fuera del shell ya no se heredan.
          background: "var(--bg-elev, #fff)",
          color: "var(--text-1, #111)",
          border: "1px solid var(--border-soft, #e4e4e4)",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-soft, #e4e4e4)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--text-1, #111)" }}>
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--border-soft, #e4e4e4)",
              background: "transparent",
              color: "var(--text-3, #666)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </header>
        <div style={{ padding: 18, display: "grid", gap: 16 }}>{children}</div>
        {pie && (
          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 18px",
              borderTop: "1px solid var(--border-soft, #e4e4e4)",
              background: "var(--bg-elev-2, #fafafa)",
            }}
          >
            {pie}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Pestañas ───────────────────────────────────────────────────────────

export function Pestanas({
  activa,
  onCambiar,
  items,
}: {
  activa: string;
  onCambiar: (k: string) => void;
  items: { key: string; label: string; contador?: number }[];
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        overflowX: "auto",
        borderBottom: "1px solid var(--border-soft)",
        paddingBottom: 0,
      }}
    >
      {items.map((it) => {
        const on = it.key === activa;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onCambiar(it.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 13px",
              border: "none",
              borderBottom: `2px solid ${on ? "var(--brand, #167a54)" : "transparent"}`,
              background: "transparent",
              color: on ? "var(--text-1)" : "var(--text-3)",
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              font: "inherit",
              fontFamily: "inherit",
            }}
          >
            {it.label}
            {typeof it.contador === "number" && it.contador > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 17,
                  height: 17,
                  padding: "0 4px",
                  borderRadius: 999,
                  background: "rgba(186, 40, 40, 0.14)",
                  color: "#b03030",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {it.contador}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Aviso ámbar corto, para lo que hay que leer pero no bloquea. */
export function AvisoAmbar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 9,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(191, 130, 20, 0.10)",
        border: "1px solid rgba(191, 130, 20, 0.32)",
        fontSize: 12,
        color: "var(--text-2)",
        lineHeight: 1.5,
      }}
    >
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1, color: "#a8741a" }} />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
