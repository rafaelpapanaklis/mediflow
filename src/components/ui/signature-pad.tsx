"use client";
// Captura de firma manuscrita en canvas. Pointer events: un solo camino para
// ratón, dedo y lápiz.
//
// Vivía en `patient-detail/pediatrics/modals/SignaturePad.tsx` y lo importaban
// endodoncia, periodoncia, implantes y ortodoncia desde la carpeta de
// pediatría. Al llegar el consentimiento informado —que además lo necesita en
// una página PÚBLICA, fuera del panel— se promovió aquí sin cambiarle el
// contrato: los seis callers existentes siguen pasando las mismas props.
//
// `theme` es lo único nuevo: las clases del panel (`ped-signature-pad`) pintan
// con las variables de tema de globals.css, que en la página pública del
// paciente —maquetada con colores fijos claros— podrían no corresponder. Con
// `theme="light"` el pad se dibuja con estilos propios y no depende de nada.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

export interface SignaturePadProps {
  width?: number;
  height?: number;
  onChange?: (dataUrl: string | null) => void;
  ariaLabel?: string;
  style?: CSSProperties;
  /**
   * "app" (default) = clases del panel. "light" = estilos propios claros para
   * superficies públicas sin el tema del dashboard.
   */
  theme?: "app" | "light";
  /** Texto del estado vacío. Por defecto "Firma aquí". */
  hintLabel?: string;
}

const LIGHT_WRAP: CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  background: "#fff",
  padding: 6,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const LIGHT_CANVAS: CSSProperties = {
  width: "100%",
  height: 170,
  background: "#f8fafc",
  borderRadius: 8,
  cursor: "crosshair",
  touchAction: "none",
  display: "block",
};
const LIGHT_TOOLBAR: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 12,
  color: "#64748b",
  padding: "0 6px",
};
const LIGHT_BTN: CSSProperties = {
  background: "none",
  border: "none",
  color: "#2563eb",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: 4,
};

export function SignaturePad(props: SignaturePadProps) {
  const {
    width = 600,
    height = 200,
    onChange,
    ariaLabel = "Pad de firma",
    style,
    theme = "app",
    hintLabel = "Firma aquí",
  } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  // `hasInk` va DUPLICADO en un ref a propósito: el estado alimenta el render
  // (el botón Limpiar), pero quien decide si hay algo que exportar es el
  // handler de pointerup, y ese lee el ref — que ya está actualizado dentro del
  // mismo trazo, sin depender de que React haya re-renderizado en medio.
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const light = theme === "light";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = light
      ? "#0f172a"
      : getComputedStyle(canvas).getPropertyValue("--text-1").trim() || "#111827";
  }, [light]);

  const getPos = useCallback((e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    lastPointRef.current = getPos(e);
    canvas.setPointerCapture(e.pointerId);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const p = getPos(e);
    const last = lastPointRef.current ?? p;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPointRef.current = p;
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  }

  function end() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;
    onChange(hasInkRef.current ? canvas.toDataURL("image/png") : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    setHasInk(false);
    onChange?.(null);
  }

  return (
    <div
      className={light ? undefined : "ped-signature-pad"}
      style={light ? { ...LIGHT_WRAP, ...style } : style}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className={light ? undefined : "ped-signature-pad__canvas"}
        style={light ? LIGHT_CANVAS : undefined}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div
        className={light ? undefined : "ped-signature-pad__toolbar"}
        style={light ? LIGHT_TOOLBAR : undefined}
      >
        <span>{hasInk ? "Firma capturada" : hintLabel}</span>
        <button
          type="button"
          className={light ? undefined : "pedi-btn pedi-btn--xs"}
          style={light ? LIGHT_BTN : undefined}
          onClick={clear}
          disabled={!hasInk}
        >
          Limpiar
        </button>
      </div>
    </div>
  );
}
