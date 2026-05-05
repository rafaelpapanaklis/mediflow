"use client";
// Endodontics — CanalMap (sección 2, centro). Carga SVG estático, colorea
// conductos según calidad de obturación y emite onCanalClick. Spec §6.5

import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import type { CanalSvgArchetype, RootCanalRow } from "@/lib/types/endodontics";
import {
  QUALITY_COLORS,
  canonicalNameToSvgId,
  labelCanalCanonicalName,
  labelQuality,
} from "@/lib/helpers/canalAnatomy";

export interface CanalMapProps {
  toothFdi: number;
  archetype: CanalSvgArchetype;
  canals: RootCanalRow[];
  hasActiveTreatment: boolean;
  onCanalClick: (canalId: string) => void;
  onStartTreatment: () => void;
  onContinueTreatment?: () => void;
}

export function CanalMap(props: CanalMapProps) {
  const { archetype, canals, hasActiveTreatment } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Carga el SVG por fetch (archivo estático, mismo origen).
  useEffect(() => {
    let cancelled = false;
    setSvgMarkup(null);
    setError(null);
    fetch(`/specialties/endodontics/anatomy/${archetype}.svg`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        if (!cancelled) setSvgMarkup(text);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar la anatomía del diente.");
      });
    return () => { cancelled = true; };
  }, [archetype]);

  // Colorea cada <g id="canal-X"> según calidad y registra data-canal-id
  // para event delegation. Tooltip vía mouseenter/mouseleave.
  useEffect(() => {
    if (!containerRef.current || !svgMarkup) return;
    const root = containerRef.current.querySelector("svg");
    if (!root) return;

    for (const canal of canals) {
      const id = canonicalNameToSvgId(canal.canonicalName);
      const node = root.querySelector<SVGGElement>(`#${cssEscape(id)}`);
      if (!node) continue;
      const colorKey = (canal.obturationQuality ?? "none") as keyof typeof QUALITY_COLORS;
      const color = QUALITY_COLORS[colorKey] ?? QUALITY_COLORS.none;
      // currentColor del <g> propaga al stroke de los <path> internos.
      node.style.color = color;
      node.querySelectorAll("path, circle").forEach((p) => {
        (p as SVGElement).setAttribute("data-canal-id", canal.id);
      });
      node.style.cursor = "pointer";
    }
  }, [svgMarkup, canals]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as Element).closest("[data-canal-id]") as Element | null;
    if (!target) return;
    const canalId = target.getAttribute("data-canal-id");
    if (canalId) props.onCanalClick(canalId);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as Element).closest("[data-canal-id]") as Element | null;
    if (!target) {
      setTooltip(null);
      return;
    }
    const canalId = target.getAttribute("data-canal-id");
    const canal = canals.find((c) => c.id === canalId);
    if (!canal) return;
    const taper = String(Number(canal.masterApicalFileTaper) * 100).padStart(2, "0");
    const text = [
      labelCanalCanonicalName(canal.canonicalName),
      `LT ${Number(canal.workingLengthMm).toFixed(1)} mm`,
      `Lima ${canal.masterApicalFileIso}/.${taper}`,
      labelQuality(canal.obturationQuality),
    ].join(" · ");
    const rect = (containerRef.current as HTMLDivElement).getBoundingClientRect();
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text });
  }

  return (
    <section className="endo-section endo-canal-map" aria-labelledby="endo-canal-title">
      <header className="endo-canal-map__header">
        <div>
          <p className="endo-section__eyebrow">Mapa canalicular</p>
          <h2 id="endo-canal-title" className="endo-section__title">
            Anatomía del diente {props.toothFdi}
          </h2>
          <p className="endo-section__sub">
            {canals.length === 0
              ? "Sin conductos registrados todavía."
              : `${canals.length} ${canals.length === 1 ? "conducto" : "conductos"} registrados.`}
          </p>
        </div>
        <div className="endo-canal-map__actions">
          {hasActiveTreatment ? (
            <button
              type="button"
              className="pedi-btn pedi-btn--brand"
              onClick={props.onContinueTreatment}
            >
              <RotateCcw size={14} aria-hidden /> Continuar tratamiento
            </button>
          ) : (
            <button
              type="button"
              className="pedi-btn pedi-btn--brand"
              onClick={props.onStartTreatment}
            >
              <Play size={14} aria-hidden /> Iniciar tratamiento
            </button>
          )}
        </div>
      </header>

      <div
        ref={containerRef}
        className="endo-canal-map__viewport"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {error ? (
          <p className="endo-section__placeholder">{error}</p>
        ) : svgMarkup ? (
          <div
            className="endo-canal-map__svg"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <p className="endo-section__placeholder">Cargando anatomía…</p>
        )}
        {tooltip && (
          <div
            role="tooltip"
            className="endo-canal-map__tooltip"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            {tooltip.text}
          </div>
        )}
      </div>

      <ul className="endo-canal-map__legend" aria-label="Leyenda de calidad de obturación">
        <li><span className="endo-canal-map__sw" style={{ background: QUALITY_COLORS.HOMOGENEA }} aria-hidden /> Homogénea</li>
        <li><span className="endo-canal-map__sw" style={{ background: QUALITY_COLORS.ADECUADA }} aria-hidden /> Adecuada</li>
        <li><span className="endo-canal-map__sw" style={{ background: QUALITY_COLORS.CON_HUECOS }} aria-hidden /> Con huecos</li>
        <li><span className="endo-canal-map__sw" style={{ background: QUALITY_COLORS.SOBREOBTURADA }} aria-hidden /> Sobreobturada</li>
        <li><span className="endo-canal-map__sw" style={{ background: QUALITY_COLORS.SUBOBTURADA }} aria-hidden /> Subobturada</li>
        <li><span className="endo-canal-map__sw" style={{ background: QUALITY_COLORS.none }} aria-hidden /> Sin obturar</li>
      </ul>
    </section>
  );
}

/** Escapa un string para usarlo en un selector CSS. */
function cssEscape(s: string): string {
  if (typeof window !== "undefined" && typeof CSS !== "undefined" && CSS.escape) {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
