"use client";

// Escenario del heatmap: renderiza la PÁGINA REAL seleccionada dentro de un <iframe>
// (mismo origen) y superpone el mapa de calor EXACTAMENTE encima, para que los clicks
// se lean sobre el layout real (estilo Clarity).
//
// Alineación de coordenadas:
//  - El iframe se renderiza a un ANCHO DE REFERENCIA fijo = mediana de points[].vw
//    (fallback 1280). Es el ancho representativo donde se capturaron los clicks, así el
//    layout del iframe coincide con dónde cayeron.
//  - El canvas (modo controlado) se dibuja al MISMO ancho (refW) y al alto real del
//    contenido del iframe (frameH). x·refW y (y/docH)·frameH → caen sobre los elementos.
//  - Todo el escenario (iframe + canvas) se escala junto con CSS transform:scale para
//    caber en el ancho del panel, conservando proporción → siguen alineados.
//
// El iframe NO ensucia la analítica: el tracker no arranca dentro de un iframe (guard
// self!==top en tracker-core). Aun así va con pointer-events:none y sandbox mínimo
// (same-origin + scripts, para que las páginas del panel hidraten).

import { useEffect, useMemo, useRef, useState } from "react";
import { HeatmapCanvas } from "./heatmap-canvas";
import type { HeatPoint } from "@/lib/analytics/types";

function median(nums: number[]): number {
  const arr = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

type Status = "loading" | "ok" | "failed";

export function HeatmapStage({ points, path }: { points: HeatPoint[]; path: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [origin, setOrigin] = useState("");
  const [panelW, setPanelW] = useState(0);
  const [frameH, setFrameH] = useState(0);
  const [status, setStatus] = useState<Status>("loading");

  // Ancho de referencia = mediana de los vw de los clicks (donde de verdad se capturaron).
  const refW = useMemo(() => clamp(median(points.map((p) => p.vw)) || 1280, 320, 2560), [points]);
  const src = origin ? origin + path : "";

  // origin sólo en cliente.
  useEffect(() => {
    try {
      setOrigin(window.location.origin);
    } catch {
      setOrigin("");
    }
  }, []);

  // Ancho del panel (factor de escala del escenario).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => setPanelW(vp.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [status]); // re-observa si el viewport se remonta al salir de "failed"

  // Reset al cambiar de página/fuente + timeout duro → fallback si nunca carga.
  useEffect(() => {
    if (!src) return;
    setStatus("loading");
    setFrameH(0);
    const t = setTimeout(() => setStatus((s) => (s === "loading" ? "failed" : s)), 8000);
    return () => clearTimeout(t);
  }, [src]);

  // Mide el alto del contenido del iframe (mismo origen) y observa cambios (hidratación,
  // imágenes que cargan tarde). Si el acceso lanza → cross-origin/bloqueado → fallback.
  useEffect(() => {
    if (!src) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let timer = 0;
    let tries = 0;
    let settled = false;

    const measure = () => {
      if (cancelled) return;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        setStatus("failed"); // cross-origin / enmarcado bloqueado
        return;
      }
      if (!doc) {
        retry();
        return;
      }
      const h = Math.max(
        doc.body ? doc.body.scrollHeight : 0,
        doc.documentElement ? doc.documentElement.scrollHeight : 0,
        doc.documentElement ? doc.documentElement.offsetHeight : 0,
      );
      if (h < 40) {
        retry(); // aún hidratando / en blanco → reintenta
        return;
      }
      setFrameH((prev) => (Math.abs(prev - h) > 2 ? h : prev));
      setStatus("ok");
      if (!settled) {
        settled = true;
        try {
          if (doc.documentElement) {
            ro = new ResizeObserver(() => measure());
            ro.observe(doc.documentElement);
          }
        } catch {
          /* ignore */
        }
      }
    };

    const retry = () => {
      if (cancelled || settled) return;
      tries += 1;
      if (tries > 16) return; // deja que el timeout global marque failed
      timer = window.setTimeout(measure, 250);
    };

    const onLoad = () => measure();
    iframe.addEventListener("load", onLoad);
    // Por si ya está cargado antes de montar el listener (cache).
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") measure();
    } catch {
      /* ignore */
    }

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
      if (ro) ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [src]);

  const scale = panelW > 0 && refW > 0 ? panelW / refW : 1;
  const stageH = frameH > 0 ? frameH : Math.round(refW * 1.15); // placeholder mientras carga
  const scaledH = Math.round(stageH * scale);

  // ── Fallback: iframe no cargó / bloqueado / en blanco. Nunca rompe la pestaña. ──
  if (status === "failed") {
    return (
      <div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border-soft)",
            background: "rgba(148,163,184,0.10)",
            fontSize: 13,
            color: "var(--text-2)",
          }}
        >
          <span>No se pudo cargar la vista de la página; se muestra el mapa sobre fondo simple.</span>
          {src && (
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-soft)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-1)",
                textDecoration: "none",
              }}
            >
              Abrir página en pestaña nueva ↗
            </a>
          )}
        </div>
        <HeatmapCanvas points={points} />
      </div>
    );
  }

  // ── Escenario: iframe de fondo + overlay alineado, escalado a lo ancho del panel. ──
  return (
    <div
      ref={viewportRef}
      style={{
        position: "relative",
        width: "100%",
        overflow: "hidden",
        borderRadius: 12,
        border: "1px solid var(--border-soft)",
        background: "linear-gradient(180deg, rgba(30,58,138,0.06), rgba(11,16,32,0.25))",
        height: status === "ok" && scaledH ? scaledH : 460,
        transition: "height .25s ease",
      }}
    >
      {src && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            opacity: status === "ok" ? 1 : 0,
            transition: "opacity .25s ease",
          }}
        >
          <div
            style={{
              position: "relative",
              flex: "none",
              width: refW,
              height: stageH,
              transform: `scale(${scale})`,
              transformOrigin: "top center",
            }}
          >
            <iframe
              key={src}
              ref={iframeRef}
              src={src}
              title="Vista de la página"
              sandbox="allow-same-origin allow-scripts"
              scrolling="no"
              loading="lazy"
              style={{
                display: "block",
                width: refW,
                height: stageH,
                border: 0,
                background: "#fff",
                pointerEvents: "none",
              }}
            />
            {status === "ok" && frameH > 0 && <HeatmapCanvas points={points} width={refW} height={frameH} />}
          </div>
        </div>
      )}

      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--text-3)",
            fontSize: 13,
          }}
        >
          Cargando vista de la página…
        </div>
      )}
    </div>
  );
}

export default HeatmapStage;
