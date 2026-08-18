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
import { Txt } from "./edit-context";
import { dirCopia } from "@/lib/landing-address-parts";

/* ---------- comparador antes / después ---------- */

export interface BeforeAfterProps {
  antes: string | null;
  despues: string | null;
  accent: string;
  /** Etiquetas sobre la imagen. La de la derecha admite copy propio. */
  etiquetaAntes?: string;
  etiquetaDespues?: string;
  /**
   * Claves de `landingCopy` para que esas dos pastillas se editen desde el
   * lienzo. Sin ellas no son editables — es lo que pasaba antes en las tres
   * plantillas que usan esta pieza: texto en español, visible sobre la foto,
   * y sin manera de cambiarlo.
   */
  claveAntes?: string;
  valorAntes?: string | null;
  claveDespues?: string;
  valorDespues?: string | null;
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
  claveAntes, valorAntes,
  claveDespues, valorDespues,
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

      {/* Las dos pastillas se leen sobre la foto: son contenido, no adorno.
          Se editan desde el lienzo con las claves que declare la plantilla; sin
          ellas, <Txt> es el passthrough de siempre y esto no cambia nada. */}
      <Txt as="span" style={{ ...etiquetaBase, left: 14 }}
        campo={claveAntes ? dirCopia(claveAntes) : null}
        valor={valorAntes} porDefecto={etiquetaAntes} />
      <Txt as="span" style={{ ...etiquetaBase, right: 14, background: accent }}
        campo={claveDespues ? dirCopia(claveDespues) : null}
        valor={valorDespues} porDefecto={etiquetaDespues} />

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
  /**
   * Claves de `landingCopy` de los tres rótulos del simulador, para que se
   * editen desde el lienzo. Sin ellas no son editables — y son tres textos en
   * español que el paciente lee.
   */
  claves?: { tratamiento: string; plazo: string; mensual: string };
  valores?: { tratamiento: string | null; plazo: string | null; mensual: string | null };
}

/**
 * Divide el precio entre el plazo. No es una simulación financiera: son
 * meses SIN intereses, así que la cuenta es la división y nada más. Sin
 * plazos configurados o sin ningún precio numérico, devuelve null.
 */
export function MsiSimulator({ plazos, opciones, accent, surface = "light", ink, muted, line, field, claves, valores }: MsiSimulatorProps) {
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
          <Txt as="label" htmlFor="msi-trat" style={{ fontSize: 13.5, color: muted, display: "block", marginBottom: 9 }}
            campo={claves ? dirCopia(claves.tratamiento) : null}
            valor={valores?.tratamiento} porDefecto="Tratamiento" />
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

      <Txt as="div" style={{ fontSize: 13.5, color: muted, marginBottom: 9 }}
        campo={claves ? dirCopia(claves.plazo) : null}
        valor={valores?.plazo} porDefecto="Plazo" />
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
        <Txt as="span" style={{ fontSize: 14, color: muted }}
          campo={claves ? dirCopia(claves.mensual) : null}
          valor={valores?.mensual} porDefecto="Tu pago mensual" />
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
