"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Overlay — capa SVG de anotaciones del Stage (mediciones de distancia, ángulos,
// notas clínicas, conducto dentario e implantes). Los puntos llegan NORMALIZADOS
// 0..1 respecto a la caja de imagen y se convierten a px del viewBox aquí. Los
// trazos usan vector-effect="non-scaling-stroke" para quedar nítidos a cualquier
// zoom; las etiquetas y los tiradores se contra-escalan dividiendo por el zoom `z`
// para mantener un tamaño en pantalla constante.
//
// Valores REALES: los milímetros usan la escala del plano (mmPorUnidad =
// CbctViewerProps.mmPorPixel[plane], derivada de las cabeceras DICOM por T7); los
// grados usan geometry.angleAt. Nada de FOV fijo.
//
// Reglas del repo: tsconfig NO strict (sin strictNullChecks; uniones por `type`
// string) y SIN target ES2015 → solo arrays indexados, jamás for...of/spread de
// Map/Set.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import type { Anno, AnnoPatch, Plane, Pt } from "./types";
import { TOOL_COLORS } from "./constants";
import { mmBetween, angleAt, mid, smoothPath, dist01 } from "./geometry";

/** Anotación en curso (boceto) que el Stage dibuja como fantasma sobre la imagen. */
export interface DraftAnno {
  type: "distancia" | "angulo" | "canal";
  plane: Plane;
  points: Pt[];
}

export interface OverlayProps {
  /** todas las anotaciones; el overlay filtra por `plane`. */
  annos: Anno[];
  /** boceto en curso (se pinta translúcido). */
  draft: DraftAnno | null;
  /** caja de imagen SIN escalar (px): el viewBox y el mapeo normalizado→px. */
  box: { w: number; h: number };
  /** zoom actual del Stage (para contra-escalar etiquetas/tiradores). */
  zoom: number;
  plane: Plane;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: AnnoPatch | ((a: Anno) => Anno)) => void;
  /** ref de la caja de contenido (para mapear el puntero al arrastrar tiradores). */
  contentRef: React.RefObject<HTMLDivElement>;
  /** mm que abarca el ancho normalizado completo (0→1) del plano. */
  mmPorUnidad: number;
}

/**
 * Forma laxa que aceptan los renderers internos: cubre cualquier `Anno` real y el
 * boceto con id sintético. Evita pelear con la unión discriminada (y con las
 * tuplas de `points`) en cada rama de dibujo.
 */
type RenderAnno = {
  id: string;
  type: string;
  plane: Plane;
  points?: Pt[];
  label?: string;
  p?: Pt;
  angle?: number;
  length01?: number;
  diam01?: number;
};

// ── Sub-piezas (etiqueta y tirador), ambas contra-escaladas por el zoom ──────
function Label({
  x,
  y,
  color,
  text,
  sub,
  z,
  anchor,
}: {
  x: number;
  y: number;
  color: string;
  text: string;
  sub?: string;
  z: number;
  anchor?: "start" | "end";
}) {
  const pad = 5 / z;
  const fs = 12.5 / z;
  const fsSub = 10 / z;
  const h = (sub ? 30 : 18) / z;
  const w = (Math.max(text.length, (sub || "").length) * 7.0 + 14) / z;
  const ax = anchor === "end" ? -w : 0;
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: "none" }}>
      <rect x={ax} y={-h / 2} width={w} height={h} rx={6 / z} fill="rgba(8,12,18,.85)" stroke={color} strokeWidth={1 / z} />
      <text x={ax + pad} y={(sub ? -3 : 4) / z} fill="#fff" fontSize={fs} fontWeight={700} fontFamily="inherit">
        {text}
      </text>
      {sub ? (
        <text x={ax + pad} y={10 / z} fill={color} fontSize={fsSub} fontWeight={600} fontFamily="inherit">
          {sub}
        </text>
      ) : null}
    </g>
  );
}

function Handle({
  x,
  y,
  color,
  z,
  onDown,
  big,
}: {
  x: number;
  y: number;
  color: string;
  z: number;
  onDown: (e: React.PointerEvent) => void;
  big?: boolean;
}) {
  const r = (big ? 7 : 5.5) / z;
  return (
    <circle
      cx={x}
      cy={y}
      r={r}
      fill="#0b0f16"
      stroke={color}
      strokeWidth={2 / z}
      style={{ cursor: "grab", pointerEvents: "all" }}
      onPointerDown={onDown}
    />
  );
}

export function Overlay({ annos, draft, box, zoom, plane, selectedId, onSelect, onUpdate, contentRef, mmPorUnidad }: OverlayProps) {
  const z = zoom;
  const W = box.w;
  const H = box.h;
  const toPx = (p: Pt) => ({ x: p.x * W, y: p.y * H });
  const list = annos.filter((a) => a.plane === plane);

  // ── Arrastre de tiradores (punta/cuerpo del implante, puntos de líneas) ────
  const dragRef = useRef<{ id: string; kind: string; idx: number } | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const ptFromEvent = (e: PointerEvent): Pt => {
    const el = contentRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const startDrag = (id: string, kind: string, idx: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(id);
    dragRef.current = { id, kind, idx };
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch (_) {
      /* noop */
    }
  };
  // Listeners de ventana una sola vez; el callback fresco vive en onUpdateRef.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = ptFromEvent(e);
      onUpdateRef.current(d.id, (a) => {
        if (a.type === "implante") {
          if (d.kind === "move") return { ...a, p };
          if (d.kind === "tip") {
            // El tirador 'tip' se DIBUJA en (ctr + half·sin(ang), ctr + half·cos(ang)) con
            // half = length01·H/2 (ver renderImplant). Invertimos ESA MISMA fórmula para que el
            // tirador quede bajo el dedo: ang = atan2(Δx, Δy). Antes se negaba Δy [atan2(Δx,-Δy)],
            // lo que invertía el eje vertical → el tirador "saltaba" al lado opuesto al arrastrar
            // arriba/abajo. length01 = 2·dist01 porque el tip está a media longitud (half) del
            // centro. Normalizamos el ángulo a [0,360) para no devolver negativos.
            const ang = (Math.atan2(p.x - a.p.x, p.y - a.p.y) * 180) / Math.PI;
            const angNorm = ((ang % 360) + 360) % 360;
            const len = dist01(p, a.p) * 2;
            return { ...a, angle: angNorm, length01: Math.max(0.05, Math.min(0.6, len)) };
          }
          return a;
        }
        if (a.points) {
          const pts = a.points.slice();
          pts[d.idx] = p;
          return { ...a, points: pts } as Anno;
        }
        return a;
      });
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // ── Renderers por tipo ─────────────────────────────────────────────────────
  const renderDistance = (a: RenderAnno, ghost: boolean) => {
    const p1 = toPx(a.points[0]);
    const p2 = toPx(a.points[1]);
    const m = mid(p1, p2);
    const mm = mmBetween(a.points[0], a.points[1], mmPorUnidad).toFixed(1);
    const c = TOOL_COLORS.distancia;
    const sel = a.id === selectedId;
    const tick = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI + 90;
    return (
      <g key={a.id} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={c} strokeWidth={sel ? 2.4 : 1.8} vectorEffect="non-scaling-stroke" opacity={ghost ? 0.6 : 1} />
        {[p1, p2].map((p, i) => (
          <line key={"t" + i} x1={p.x - 9 / z} y1={p.y} x2={p.x + 9 / z} y2={p.y} stroke={c} strokeWidth={1.4} vectorEffect="non-scaling-stroke" transform={`rotate(${tick} ${p.x} ${p.y})`} />
        ))}
        {!ghost && a.points.map((p, i) => (
          <Handle key={"h" + i} x={toPx(p).x} y={toPx(p).y} color={c} z={z} onDown={startDrag(a.id, "pt", i)} />
        ))}
        <Label x={m.x} y={m.y - 14 / z} color={c} text={`${mm} mm`} z={z} />
      </g>
    );
  };

  const renderAngle = (a: RenderAnno, ghost: boolean) => {
    const pts = a.points.map(toPx);
    const c = TOOL_COLORS.angulo;
    const sel = a.id === selectedId;
    const deg = a.points.length >= 3 ? angleAt(a.points[0], a.points[1], a.points[2]).toFixed(0) : null;
    const v = pts[1];
    let arc = null;
    if (pts.length >= 3 && v) {
      const r = 26 / z;
      const a1 = Math.atan2(pts[0].y - v.y, pts[0].x - v.x);
      const a2 = Math.atan2(pts[2].y - v.y, pts[2].x - v.x);
      const large = ((a2 - a1 + 2 * Math.PI) % (2 * Math.PI)) > Math.PI ? 0 : 1;
      arc = (
        <path
          d={`M ${v.x + r * Math.cos(a1)} ${v.y + r * Math.sin(a1)} A ${r} ${r} 0 0 ${large} ${v.x + r * Math.cos(a2)} ${v.y + r * Math.sin(a2)}`}
          fill="none"
          stroke={c}
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    return (
      <g key={a.id} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}>
        {pts.length >= 2 ? (
          <polyline points={pts.slice(0, 3).map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={c} strokeWidth={sel ? 2.4 : 1.8} vectorEffect="non-scaling-stroke" opacity={ghost ? 0.6 : 1} />
        ) : null}
        {arc}
        {!ghost && a.points.map((p, i) => (
          <Handle key={"h" + i} x={toPx(p).x} y={toPx(p).y} color={c} z={z} onDown={startDrag(a.id, "pt", i)} />
        ))}
        {deg ? <Label x={v.x + 18 / z} y={v.y} color={c} text={`${deg}°`} z={z} /> : null}
      </g>
    );
  };

  const renderNote = (a: RenderAnno) => {
    const p = toPx(a.points[0]);
    const c = TOOL_COLORS.anotacion;
    const sel = a.id === selectedId;
    return (
      <g key={a.id} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}>
        <line x1={p.x} y1={p.y} x2={p.x + 22 / z} y2={p.y - 22 / z} stroke={c} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <circle cx={p.x} cy={p.y} r={(sel ? 5 : 4) / z} fill={c} stroke="#0b0f16" strokeWidth={1.5 / z} />
        <Label x={p.x + 22 / z} y={p.y - 26 / z} color={c} text={a.label || "Nota"} z={z} />
        {sel ? <Handle x={p.x} y={p.y} color={c} z={z} onDown={startDrag(a.id, "pt", 0)} /> : null}
      </g>
    );
  };

  const renderCanal = (a: RenderAnno, ghost: boolean) => {
    const pts = a.points.map(toPx);
    const c = TOOL_COLORS.canal;
    const sel = a.id === selectedId;
    const d = smoothPath(pts);
    return (
      <g key={a.id} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}>
        <path d={d} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth={6.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke={c} strokeWidth={sel ? 4 : 3} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={ghost ? 0.7 : 1} />
        {!ghost && a.points.map((p, i) => (
          <Handle key={"h" + i} x={toPx(p).x} y={toPx(p).y} color={c} z={z} onDown={startDrag(a.id, "pt", i)} />
        ))}
        {pts[0] ? <Label x={pts[0].x} y={pts[0].y - 16 / z} color={c} text={a.label || "Conducto"} z={z} /> : null}
      </g>
    );
  };

  const renderImplant = (a: RenderAnno) => {
    const ctr = toPx(a.p);
    const c = TOOL_COLORS.implante;
    const sel = a.id === selectedId;
    const L = (a.length01 || 0.18) * H;
    const Wd = (a.diam01 || 0.035) * H;
    const half = L / 2;
    const w = Wd / 2;
    const ang = a.angle || 0;
    const threads = [];
    const step = Math.max(7, Wd * 0.5);
    for (let t = -half + 8; t < half - 3; t += step) {
      threads.push(<line key={t} x1={-w} y1={t} x2={w} y2={t - 3} stroke="rgba(4,20,14,.5)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />);
    }
    const rad = (ang * Math.PI) / 180;
    const tipHandle = { x: ctr.x + half * Math.sin(rad), y: ctr.y + half * Math.cos(rad) };
    return (
      <g key={a.id} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}>
        <g transform={`translate(${ctr.x} ${ctr.y}) rotate(${ang})`} style={{ cursor: "move" }} onPointerDown={startDrag(a.id, "move", 0)}>
          <rect x={-w} y={-half} width={w * 2} height={L} rx={w * 0.7} fill={sel ? "rgba(52,211,153,.32)" : "rgba(52,211,153,.22)"} stroke={c} strokeWidth={sel ? 2.2 : 1.8} vectorEffect="non-scaling-stroke" />
          <path d={`M ${-w} ${half - w * 1.1} L 0 ${half + w * 0.9} L ${w} ${half - w * 1.1}`} fill="rgba(52,211,153,.22)" stroke={c} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <rect x={-w * 1.5} y={-half - w * 1.1} width={w * 3} height={w * 1.4} rx={2 / z} fill="rgba(52,211,153,.3)" stroke={c} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {threads}
          <line x1={0} y1={-half} x2={0} y2={half} stroke={c} strokeWidth={0.8} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.7} />
        </g>
        <Label x={ctr.x + (w + 10 / z)} y={ctr.y} color={c} text={`Ø${((a.diam01 || 0.035) * mmPorUnidad).toFixed(1)}`} sub={`${((a.length01 || 0.18) * mmPorUnidad).toFixed(1)} mm`} z={z} />
        {sel ? <Handle x={tipHandle.x} y={tipHandle.y} color={c} z={z} big onDown={startDrag(a.id, "tip", 0)} /> : null}
        {sel ? <Handle x={ctr.x} y={ctr.y} color="#fff" z={z} onDown={startDrag(a.id, "move", 0)} /> : null}
      </g>
    );
  };

  const renderAny = (a: RenderAnno, ghost: boolean) => {
    try {
      if (!a) return null;
      if (a.type === "implante") {
        if (!a.p || typeof a.p.x !== "number") return null;
        return renderImplant(a);
      }
      if (!a.points || a.points.length === 0) return null;
      if (a.type === "distancia") return a.points.length >= 2 ? renderDistance(a, ghost) : null;
      if (a.type === "angulo") return renderAngle(a, ghost);
      if (a.type === "anotacion") return renderNote(a);
      if (a.type === "canal") return renderCanal(a, ghost);
      return null;
    } catch (err) {
      if (typeof console !== "undefined") console.warn("overlay render skip", a && a.type, err);
      return null;
    }
  };

  if (!W || !H) return null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        // En el VOLUMEN 3D el giro/zoom los maneja OrbitControls sobre el lienzo
        // WebGL de abajo → el overlay NO debe capturar el puntero o TAPA el giro.
        // (En los cortes 2D sí captura, para seleccionar/arrastrar anotaciones.)
        pointerEvents: plane === "vol3d" ? "none" : undefined,
      }}
    >
      {list.map((a) => renderAny(a as RenderAnno, false))}
      {draft && draft.points.length > 0 ? renderAny({ ...draft, id: "__draft" } as RenderAnno, true) : null}
    </svg>
  );
}

export default Overlay;
