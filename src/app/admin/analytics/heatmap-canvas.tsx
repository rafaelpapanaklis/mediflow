"use client";

// Render de heatmap de clicks sobre canvas (sin dependencias). Los puntos vienen
// normalizados: x = fracción del ancho del viewport (0..1); y = px absoluto que
// normalizamos por el docH de cada click a una altura de referencia. Densidad
// aditiva → rampa de color (azul→cian→verde→amarillo→rojo).
//
// Dos modos:
//  - Autónomo (sin width/height): dibuja a lo ancho del contenedor y a una altura de
//    referencia fija (REF_HEIGHT). Es la vista "simple"/fallback sobre fondo gris.
//  - Controlado (width y height dados): dibuja EXACTAMENTE a ese lienzo para
//    superponerse 1:1 sobre el <iframe> de la página real (mismo sistema de coords).
//    La resolución interna se acota por área (MAX_PX) y se estira por CSS → sin jank en
//    páginas muy altas; el radio del blob escala con el ancho para verse consistente.

import { useEffect, useRef } from "react";
import type { HeatPoint } from "@/lib/analytics/types";

const REF_HEIGHT = 1400; // altura de referencia del "documento" en px de canvas (modo autónomo)
const RADIUS = 28;
const MAX_PX = 3_000_000; // techo de píxeles del lienzo interno (acota getImageData en páginas largas)

let RAMP: Uint8ClampedArray | null = null;
function getRamp(): Uint8ClampedArray {
  if (RAMP) return RAMP; // la rampa es constante → calcular una sola vez
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0.0, "#1e3a8a");
  grd.addColorStop(0.3, "#06b6d4");
  grd.addColorStop(0.55, "#22c55e");
  grd.addColorStop(0.78, "#eab308");
  grd.addColorStop(1.0, "#ef4444");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 1);
  RAMP = g.getImageData(0, 0, 256, 1).data;
  return RAMP;
}

export function HeatmapCanvas({
  points,
  width,
  height,
}: {
  points: HeatPoint[];
  /** Modo controlado: ancho lógico del lienzo (= ancho de referencia del iframe). */
  width?: number;
  /** Modo controlado: alto lógico del lienzo (= alto real del contenido del iframe). */
  height?: number;
}) {
  const controlled = !!(width && height && width > 0 && height > 0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!controlled && !wrap) return;

    function draw() {
      // Tamaño lógico (espacio de coordenadas donde caen los clicks).
      const cssW = controlled ? (width as number) : Math.max(320, Math.floor(wrap!.clientWidth));
      const cssH = controlled ? (height as number) : REF_HEIGHT;
      // Resolución interna: en controlado acotamos por área para no reventar CPU/memoria
      // con páginas largas (getImageData es O(W·H)); CSS estira el lienzo a cssW×cssH.
      const q = controlled ? Math.min(1, Math.sqrt(MAX_PX / (cssW * cssH))) : 1;
      const W = Math.max(1, Math.round(cssW * q));
      const H = Math.max(1, Math.round(cssH * q));
      const radius = controlled ? Math.max(10, W * 0.024) : RADIUS;

      canvas!.width = W;
      canvas!.height = H;
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      if (!points.length) return;

      // 1) Capa de intensidad en escala de grises (alfa aditiva).
      points.forEach((p) => {
        const docH = p.docH && p.docH > 0 ? p.docH : cssH;
        const x = Math.min(1, Math.max(0, p.x)) * W;
        const y = Math.min(1, Math.max(0, p.y / docH)) * H;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
        grd.addColorStop(0, "rgba(0,0,0,0.14)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // 2) Colorizar por la rampa según la intensidad acumulada (alfa).
      const img = ctx.getImageData(0, 0, W, H);
      const data = img.data;
      const ramp = getRamp();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;
        const idx = Math.min(255, a) * 4;
        data[i] = ramp[idx];
        data[i + 1] = ramp[idx + 1];
        data[i + 2] = ramp[idx + 2];
        data[i + 3] = Math.min(235, a * 3);
      }
      ctx.putImageData(img, 0, 0);
    }

    draw();

    // Controlado: el tamaño lo fijan las props → redibuja al cambiar props/puntos (deps).
    if (controlled) return;

    let lastW = wrap!.clientWidth;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const w = wrap!.clientWidth;
      if (w === lastW) return; // sólo redibujar si cambió el ancho (evita jank)
      lastW = w;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => draw());
    });
    ro.observe(wrap!);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [points, controlled, width, height]);

  // Controlado: lienzo absoluto que cubre al padre (el <iframe>), sin cromo ni scroll.
  if (controlled) {
    return (
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: `${width}px`,
          height: `${height}px`,
          pointerEvents: "none",
        }}
      />
    );
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: "100%",
        maxHeight: 620,
        overflowY: "auto",
        borderRadius: 12,
        border: "1px solid var(--border-soft)",
        background: "linear-gradient(180deg, rgba(30,58,138,0.06), rgba(11,16,32,0.25))",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
      {!points.length && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 13 }}>
          Sin clicks registrados para esta página en el periodo.
        </div>
      )}
    </div>
  );
}

export default HeatmapCanvas;
