"use client";
/* ============================================================
   Piezas que comparten varias de las ocho plantillas. Viven aquí
   para que un arreglo valga para todas (el comparador antes/después
   lo usan equipo, sonrisa y especialistas; el simulador de meses sin
   intereses lo usan sonrisa y especialistas).

   Sin fotos o sin plazos configurados, cada pieza devuelve null: la
   sección que la contiene se oculta entera en vez de dejar hueco.
   ============================================================ */
import { useId, useState } from "react";
import { alpha } from "./landing-utils";

/* ---------- comparador antes / después ---------- */

export interface BeforeAfterProps {
  antes: string | null;
  despues: string | null;
  accent: string;
  /** Etiquetas sobre la imagen. La de la derecha admite copy propio. */
  etiquetaAntes?: string;
  etiquetaDespues?: string;
  /** Estilo de la caja: cuadrada (sonrisa/especialistas) o redondeada. */
  radius?: number;
  aspect?: string;
  /** Tono de las etiquetas: sobre fondo claro u oscuro. */
  surface?: "light" | "dark";
  className?: string;
}

/**
 * Dos fotos superpuestas con un range que recorta la de arriba. El input
 * ocupa toda la caja y es transparente: se arrastra con el ratón, con el
 * dedo y TAMBIÉN con las flechas del teclado, que es lo que un div con
 * onMouseMove nunca da gratis.
 */
export function BeforeAfter({
  antes, despues, accent,
  etiquetaAntes = "Antes",
  etiquetaDespues = "Después",
  radius = 14,
  aspect = "4/3",
  surface = "light",
  className = "",
}: BeforeAfterProps) {
  const [corte, setCorte] = useState(50);
  const id = useId();
  if (!antes || !despues) return null;

  const etiquetaBase: React.CSSProperties = {
    position: "absolute", top: 14,
    fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase",
    background: surface === "dark" ? "rgba(10,15,26,.8)" : "rgba(19,36,32,.72)",
    color: "#fff", padding: "5px 11px", borderRadius: 999, pointerEvents: "none", zIndex: 2,
  };

  return (
    <div
      className={className}
      style={{ position: "relative", borderRadius: radius, overflow: "hidden", aspectRatio: aspect, userSelect: "none" }}
    >
      <img src={antes} alt={etiquetaAntes} loading="lazy"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <img src={despues} alt={etiquetaDespues} loading="lazy"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", clipPath: `inset(0 0 0 ${corte}%)` }} />

      <span style={{ ...etiquetaBase, left: 14 }}>{etiquetaAntes}</span>
      <span style={{ ...etiquetaBase, right: 14, background: accent }}>{etiquetaDespues}</span>

      <span aria-hidden="true" style={{
        position: "absolute", top: 0, bottom: 0, left: `${corte}%`, width: 2,
        background: "#fff", pointerEvents: "none", zIndex: 2, boxShadow: "0 0 0 1px rgba(0,0,0,.12)",
      }}>
        <span style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: 38, height: 38, borderRadius: "50%", background: "#fff",
          boxShadow: "0 2px 10px rgba(0,0,0,.28)", display: "grid", placeItems: "center",
          color: "#111", fontSize: 15,
        }}>↔</span>
      </span>

      <label htmlFor={id} className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Comparar antes y después
      </label>
      <input
        id={id}
        type="range" min={0} max={100} value={corte}
        onChange={e => setCorte(Number(e.target.value))}
        aria-label="Comparar antes y después"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "ew-resize", margin: 0, zIndex: 3 }}
      />
    </div>
  );
}

/* ---------- simulador de meses sin intereses ---------- */

export interface MsiSimulatorProps {
  /** Plazos configurados por la clínica (landingMsiPlazos). Vacío = no pintar. */
  plazos: number[];
  /** Tratamientos con precio numérico; el primero es el que arranca elegido. */
  opciones: { label: string; monto: number }[];
  accent: string;
  surface?: "light" | "dark";
  ink: string;
  muted: string;
  line: string;
  field: string;
}

/**
 * Divide el precio entre el plazo. No es una simulación financiera: son
 * meses SIN intereses, así que la cuenta es la división y nada más. Sin
 * plazos configurados o sin ningún precio numérico, devuelve null.
 */
export function MsiSimulator({ plazos, opciones, accent, surface = "light", ink, muted, line, field }: MsiSimulatorProps) {
  const [idx, setIdx] = useState(0);
  const [meses, setMeses] = useState(() => plazos[Math.min(1, plazos.length - 1)] ?? plazos[0]);
  if (plazos.length === 0 || opciones.length === 0) return null;

  const elegido = opciones[Math.min(idx, opciones.length - 1)];
  const mensual = Math.round(elegido.monto / meses);
  const fmt = (n: number) => `$${n.toLocaleString("es-MX")}`;

  return (
    <div>
      {opciones.length > 1 && (
        <>
          <label htmlFor="msi-trat" style={{ fontSize: 13.5, color: muted, display: "block", marginBottom: 9 }}>Tratamiento</label>
          <select
            id="msi-trat"
            value={idx}
            onChange={e => setIdx(Number(e.target.value))}
            style={{
              width: "100%", height: 52, background: field, border: `1px solid ${line}`,
              borderRadius: 8, color: ink, padding: "0 16px", fontFamily: "inherit", fontSize: 15, marginBottom: 16,
            }}
          >
            {opciones.map((o, i) => (
              <option key={o.label + i} value={i}>{o.label} — {fmt(o.monto)}</option>
            ))}
          </select>
        </>
      )}

      <div style={{ fontSize: 13.5, color: muted, marginBottom: 9 }}>Plazo</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
        {plazos.map(m => {
          const on = m === meses;
          return (
            <button key={m} type="button" onClick={() => setMeses(m)} aria-pressed={on}
              style={{
                flex: 1, minWidth: 74, padding: "13px 0", borderRadius: 8, cursor: "pointer",
                fontFamily: "var(--font-mono)", fontSize: 14, transition: ".15s",
                background: on ? accent : field,
                color: on ? (surface === "dark" ? "#1a1206" : "#fff") : muted,
                border: `1px solid ${on ? accent : line}`,
              }}>
              {m}
            </button>
          );
        })}
      </div>

      <div style={{
        border: `1px solid ${accent}`, borderRadius: 8, padding: 26,
        background: alpha(accent, surface === "dark" ? 0.06 : 0.05),
      }}>
        <span style={{ fontSize: 14, color: muted }}>Tu pago mensual</span>
        <b style={{
          display: "block", fontFamily: "var(--font-mono)", fontSize: 42, fontWeight: 500,
          letterSpacing: "-.04em", color: accent,
        }}>{fmt(mensual)}</b>
        <span style={{ fontSize: 14, color: muted }}>
          {meses} pagos sin intereses · total {fmt(elegido.monto)}
        </span>
      </div>
    </div>
  );
}

/**
 * "$15,900" / "desde $6,800" → 15900 / 6800. Los precios son texto libre que
 * escribe la clínica; sin un número dentro, el servicio no entra al simulador.
 */
export function priceToNumber(price: string | null | undefined): number | null {
  if (!price) return null;
  const limpio = price.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const n = parseFloat(limpio);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/* ---------- estrellas ---------- */

export function StarRow({ value = 5, color, size = 15 }: { value?: number; color: string; size?: number }) {
  const llenas = Math.round(value);
  return (
    <span aria-label={`${llenas} de 5 estrellas`} style={{ color, letterSpacing: 2, fontSize: size }}>
      {"★".repeat(llenas)}{"☆".repeat(Math.max(0, 5 - llenas))}
    </span>
  );
}
