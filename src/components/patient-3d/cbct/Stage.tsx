"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Stage — UN visor (un plano) del CBCT. Implementa T5:
//   · Render del corte/volumen: placeholder PROCEDURAL (SVG, sin assets externos)
//     o el render REAL inyectado por T7 vía `renderContent` (mismo recuadro, así
//     el overlay queda alineado).
//   · Overlay SVG de anotaciones encima.
//   · Gestos ratón + TÁCTIL: arrastre = pan (2D) / rotar yaw (vol3d); rueda y
//     pellizco de 2 dedos = zoom; presionar-arrastrar-soltar para fijar puntos
//     con precisión (se ve el punto antes de soltar).
//   · Captura por herramienta (commitPoint): distancia=2pts, ángulo=3pts,
//     anotación=1pt, canal=multipunto (doble toque cierra), implante=1pt + lupa.
//   · Lupa: mantener pulsado para ampliar la zona bajo el dedo.
//
// Coordenadas SIEMPRE normalizadas 0..1 respecto a la caja de imagen → sobreviven
// a zoom/pan y a cualquier tamaño de contenedor.
//
// Reglas del repo: tsconfig NO strict (sin strictNullChecks; uniones por `type`
// string) y SIN target ES2015 → los punteros activos viven en un objeto plano
// indexado por pointerId (jamás Map/Set + spread); solo bucles for indexados.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Anno, Plane, Pt, StageProps } from "./types";
import { PLANE_MAX } from "./constants";
import { uid } from "./geometry";
import { IcCheck } from "./icons";
import { Overlay, type DraftAnno } from "./Overlay";

// ── Estado del gesto en curso (unión por `mode`) ─────────────────────────────
type Gesture =
  | { mode: "pan"; x: number; y: number; pan0: { x: number; y: number }; yaw0: number }
  | { mode: "pinch"; d0: number; z0: number; mx: number; my: number; pan0: { x: number; y: number } }
  | { mode: "place" }
  | { mode: "lupa" };

// ── Medición del contenedor (caja del Stage) ─────────────────────────────────
function useSize(ref: React.RefObject<HTMLDivElement>) {
  const [s, setS] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setS((p) => (p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    const t = setTimeout(measure, 60);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [ref]);
  return s;
}

// ── Placeholder procedural del corte (lo reemplaza T7 con `renderContent`) ────
// SVG determinista (sin assets ni canvas): silueta de tejido + anillo cortical +
// arcada dental + senos + grano. La ventana HU se aplica con el `filter` CSS, así
// los sliders de brillo/contraste se ven en vivo. En vol3d rota con el yaw.
function PlaceholderSlice({ plane, sliceIndex, yaw, filter }: { plane: Plane; sliceIndex: number; yaw: number; filter: string }) {
  const raw = useId();
  const gid = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  const is3d = plane === "vol3d";
  const rot = is3d ? (yaw % 360) * 0.25 : 0;
  const seed = Math.abs(sliceIndex % 97);
  const rx = plane === "sagital" ? 30 : plane === "coronal" ? 32 : 34;
  const ry = plane === "coronal" ? 27 : plane === "sagital" ? 25 : 23;
  const teeth = [];
  for (let i = 0; i < 16; i++) {
    const x = 32 + (36 * i) / 15;
    const dxc = (x - 50) / 18;
    const y = 41 + dxc * dxc * 4.5;
    teeth.push(<rect key={i} x={x - 1} y={y - 1.8} width={2} height={3.2} rx={0.6} fill="#e9edf2" opacity={0.9} />);
  }
  return (
    <svg
      viewBox="0 0 100 64"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", filter, background: "#06080c" }}
    >
      <defs>
        <radialGradient id={`tis-${gid}`} cx="50%" cy="46%" r="62%">
          <stop offset="0%" stopColor="#5b636e" />
          <stop offset="55%" stopColor="#2c333d" />
          <stop offset="100%" stopColor="#0a0d12" />
        </radialGradient>
        <radialGradient id={`bone-${gid}`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="76%" stopColor="rgba(0,0,0,0)" />
          <stop offset="85%" stopColor="#cfd5dc" />
          <stop offset="100%" stopColor="#828b96" />
        </radialGradient>
        <filter id={`grain-${gid}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" />
        </filter>
      </defs>
      <rect x="0" y="0" width="100" height="64" fill="#06080c" />
      <g transform={`rotate(${rot} 50 32)`}>
        <ellipse cx="50" cy="33" rx={rx} ry={ry} fill={`url(#tis-${gid})`} />
        <ellipse cx="50" cy="33" rx={rx} ry={ry} fill={`url(#bone-${gid})`} />
        {!is3d ? <g>{teeth}</g> : null}
        <ellipse cx="44.5" cy="29" rx="3" ry="4" fill="#070a0e" opacity="0.85" />
        <ellipse cx="55.5" cy="29" rx="3" ry="4" fill="#070a0e" opacity="0.85" />
        {is3d ? <ellipse cx="50" cy="34" rx="9" ry="13" fill="rgba(0,0,0,.25)" /> : null}
        <rect x="49.4" y="26" width="1.2" height="7" rx="0.5" fill="#aab2bd" opacity="0.5" />
      </g>
      <rect x="0" y="0" width="100" height="64" filter={`url(#grain-${gid})`} opacity="0.5" />
    </svg>
  );
}

export function Stage(props: StageProps) {
  const {
    plane,
    view,
    setView,
    tool,
    annos,
    selectedId,
    onSelect,
    addAnno,
    updateAnno,
    hu,
    vol,
    sliceIndex,
    planeLabel,
    mmPorPixel,
    compact,
    focused,
    onFocus,
    renderContent,
    planeMax,
    nextAnnoLabel,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stage = useSize(stageRef);

  const [pending, setPending] = useState<Pt[]>([]); // puntos ya fijados del boceto en curso
  const [cursor, setCursor] = useState<Pt | null>(null); // puntero normalizado en vivo (preview)
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null); // px de la lupa activa

  const pointers = useRef<{ [id: number]: { x: number; y: number } }>({});
  const gesture = useRef<Gesture | null>(null);
  const tapRef = useRef<{ down: { x: number; y: number } | null; moved: boolean }>({ down: null, moved: false });
  const lastTap = useRef(0);
  const wheelFn = useRef<(e: WheelEvent) => void>(() => {});

  const is3d = plane === "vol3d";

  // ── Caja de contenido: rellena el Stage con un pequeño margen ──────────────
  const fit = useMemo(() => {
    const pad = compact ? 1 : 0.985;
    const cw = stage.w * pad;
    const ch = stage.h * pad;
    return { cw, ch, ox: (stage.w - cw) / 2, oy: (stage.h - ch) / 2 };
  }, [stage.w, stage.h, compact]);

  // ── Ventana HU (brillo/contraste) + ajuste de volumen → filtro CSS ─────────
  const huFilter = useMemo(() => {
    const b = 0.45 + (hu.brillo / 100) * 1.25;
    const c = 0.55 + (hu.contraste / 100) * 1.5;
    let f = `brightness(${b.toFixed(2)}) contrast(${c.toFixed(2)})`;
    if (is3d && vol.mode === "mip") f += " invert(1) hue-rotate(180deg) brightness(1.1)";
    if (is3d) f += ` brightness(${(0.7 + (vol.umbral / 100) * 0.7).toFixed(2)})`;
    return f;
  }, [hu, vol, is3d]);

  const contentStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: fit.cw,
    height: fit.ch,
    transform: `translate(${fit.ox + view.panX}px, ${fit.oy + view.panY}px) scale(${view.zoom})`,
    transformOrigin: "0 0",
    willChange: "transform",
  };

  // contenido del recuadro (render real de T7 o placeholder). Se invoca también
  // dentro de la lupa, por eso debe ser puro.
  const renderInner = () => {
    if (renderContent) return renderContent({ plane, sliceIndex, view, hu, vol });
    return <PlaceholderSlice plane={plane} sliceIndex={sliceIndex} yaw={view.yaw} filter={huFilter} />;
  };

  // ── Helpers de coordenadas ─────────────────────────────────────────────────
  const norm = (e: { clientX: number; clientY: number }): Pt => {
    const el = contentRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const stageXY = (e: { clientX: number; clientY: number }) => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const ptList = () => {
    const out: { x: number; y: number }[] = [];
    const ks = Object.keys(pointers.current);
    for (let i = 0; i < ks.length; i++) out.push(pointers.current[Number(ks[i])]);
    return out;
  };
  const ptCount = () => Object.keys(pointers.current).length;

  const zoomAround = (factor: number, sx: number, sy: number) => {
    setView((v) => {
      const nz = Math.max(0.4, Math.min(6, v.zoom * factor));
      const k = nz / v.zoom;
      const cx = fit.ox + v.panX;
      const cy = fit.oy + v.panY;
      const npanX = sx - (sx - cx) * k - fit.ox;
      const npanY = sy - (sy - cy) * k - fit.oy;
      return { ...v, zoom: nz, panX: npanX, panY: npanY };
    });
  };

  // ── Captura de puntos por herramienta ──────────────────────────────────────
  const commitPoint = (p: Pt) => {
    if (tool === "anotacion") {
      // FIX6: etiqueta de un contador monótono (no se reusa al borrar). Fallback al
      // conteo transitorio si Stage se usa suelto (sin nextAnnoLabel).
      const label = nextAnnoLabel
        ? nextAnnoLabel()
        : "Nota " + (annos.filter((a) => a.type === "anotacion").length + 1);
      addAnno({ id: uid(), type: "anotacion", plane, points: [p], label });
      return;
    }
    if (tool === "implante") {
      const a: Anno = { id: uid(), type: "implante", plane, p, angle: 0, length01: 0.16, diam01: 0.04 };
      addAnno(a);
      onSelect(a.id);
      return;
    }
    if (tool === "canal") {
      const now = Date.now();
      if (now - lastTap.current < 320 && pending.length >= 2) {
        addAnno({ id: uid(), type: "canal", plane, points: pending.slice(), label: "Conducto dentario" });
        setPending([]);
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      setPending((prev) => prev.concat([p]));
      return;
    }
    // distancia / ángulo
    const need = tool === "distancia" ? 2 : tool === "angulo" ? 3 : 1;
    const next = pending.concat([p]);
    if (next.length >= need) {
      if (tool === "distancia") addAnno({ id: uid(), type: "distancia", plane, points: [next[0], next[1]] });
      else if (tool === "angulo") addAnno({ id: uid(), type: "angulo", plane, points: [next[0], next[1], next[2]] });
      setPending([]);
    } else {
      setPending(next);
    }
  };

  const finishCanal = () => {
    if (pending.length >= 2) addAnno({ id: uid(), type: "canal", plane, points: pending.slice(), label: "Conducto dentario" });
    setPending([]);
  };

  // ── Punteros ───────────────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    onFocus && onFocus();
    // En el VOLUMEN 3D con "Navegar", el giro/zoom los maneja OrbitControls (sobre
    // el lienzo WebGL). Si el Stage captura el puntero aquí, el evento nunca llega
    // al control 3D y el modelo NO rota → en ese caso no interceptamos.
    if (is3d && tool === "cursor") return;
    try {
      stageRef.current && stageRef.current.setPointerCapture(e.pointerId);
    } catch (_) {
      /* noop */
    }
    pointers.current[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (ptCount() === 2) {
      const pl = ptList();
      const a = pl[0];
      const b = pl[1];
      gesture.current = {
        mode: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        z0: view.zoom,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        pan0: { x: view.panX, y: view.panY },
      };
      setCursor(null);
      return;
    }
    tapRef.current = { down: { x: e.clientX, y: e.clientY }, moved: false };
    if (tool === "cursor") {
      gesture.current = { mode: "pan", x: e.clientX, y: e.clientY, pan0: { x: view.panX, y: view.panY }, yaw0: view.yaw || 0 };
    } else if (tool === "lupa") {
      gesture.current = { mode: "lupa" };
      setLoupe(stageXY(e));
    } else {
      setCursor(norm(e));
      gesture.current = { mode: "place" };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current[e.pointerId]) pointers.current[e.pointerId] = { x: e.clientX, y: e.clientY };
    const g = gesture.current;
    if (tapRef.current.down) {
      const dx = e.clientX - tapRef.current.down.x;
      const dy = e.clientY - tapRef.current.down.y;
      if (Math.hypot(dx, dy) > 5) tapRef.current.moved = true;
    }
    if (!g) return;
    if (g.mode === "pinch" && ptCount() >= 2) {
      const pl = ptList();
      const a = pl[0];
      const b = pl[1];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Capturamos los primitivos del gesto YA estrechado: no dependemos de que el
      // estrechamiento de la unión sobreviva dentro del closure de setView.
      const z0 = g.z0;
      const d0 = g.d0;
      const gmx = g.mx;
      const gmy = g.my;
      const gpx = g.pan0.x;
      const gpy = g.pan0.y;
      setView((v) => {
        const nz = Math.max(0.4, Math.min(6, z0 * (d / d0)));
        const k = nz / z0;
        const sx = gmx - r.left;
        const sy = gmy - r.top;
        const cx = fit.ox + gpx;
        const cy = fit.oy + gpy;
        let npanX = sx - (sx - cx) * k - fit.ox;
        let npanY = sy - (sy - cy) * k - fit.oy;
        npanX += mx - gmx;
        npanY += my - gmy;
        return { ...v, zoom: nz, panX: npanX, panY: npanY };
      });
    } else if (g.mode === "pan") {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      const yaw0 = g.yaw0;
      const ppx = g.pan0.x;
      const ppy = g.pan0.y;
      if (is3d) setView((v) => ({ ...v, yaw: yaw0 + dx * 0.4 }));
      else setView((v) => ({ ...v, panX: ppx + dx, panY: ppy + dy }));
    } else if (g.mode === "place") {
      setCursor(norm(e));
    } else if (g.mode === "lupa") {
      setLoupe(stageXY(e));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    delete pointers.current[e.pointerId];
    const g = gesture.current;
    if (g && g.mode === "place") {
      if (!tapRef.current.moved) commitPoint(norm(e));
      else commitPoint(cursor || norm(e));
    }
    if (g && g.mode === "lupa") setLoupe(null);
    if (ptCount() < 2 && g && g.mode === "pinch") gesture.current = null;
    if (ptCount() === 0) {
      gesture.current = null;
      setCursor(null);
    }
    tapRef.current.down = null;
  };

  // Rueda = zoom. Listener nativo NO pasivo (React hace onWheel pasivo y no deja
  // preventDefault → la página haría scroll/zoom). Se registra una vez.
  wheelFn.current = (e: WheelEvent) => {
    e.preventDefault();
    const p = stageXY(e);
    zoomAround(e.deltaY < 0 ? 1.12 : 0.89, p.x, p.y);
  };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelFn.current(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Boceto en curso (fantasma) ─────────────────────────────────────────────
  const draft: DraftAnno | null = useMemo(() => {
    if (!cursor && pending.length === 0) return null;
    if (tool === "distancia" || tool === "angulo" || tool === "canal") {
      const pts = cursor ? pending.concat([cursor]) : pending;
      if (pts.length < 1) return null;
      return { type: tool === "canal" ? "canal" : tool, plane, points: pts };
    }
    return null;
  }, [cursor, pending, tool, plane]);

  const cursorCss = tool === "cursor" ? (gesture.current && gesture.current.mode === "pan" ? "grabbing" : "grab") : tool === "lupa" ? "zoom-in" : "crosshair";

  return (
    <div
      ref={stageRef}
      className={"vc-stage" + (focused ? " focused" : "") + (compact ? " compact" : "")}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: compact ? 0 : 260,
        overflow: "hidden",
        borderRadius: 12,
        border: focused ? "1px solid var(--accent, #2a6fdb)" : "1px solid #1e2733",
        background: "radial-gradient(120% 120% at 50% 28%, #11161f 0%, #080b10 72%)",
        cursor: cursorCss,
        touchAction: "none",
        userSelect: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={contentRef} data-vc-content="" style={contentStyle}>
        {renderInner()}
        <Overlay
          annos={annos}
          draft={draft}
          box={{ w: fit.cw, h: fit.ch }}
          zoom={view.zoom}
          plane={plane}
          selectedId={selectedId}
          onSelect={onSelect}
          onUpdate={updateAnno}
          contentRef={contentRef}
          mmPorUnidad={mmPorPixel[plane]}
        />
      </div>

      {/* etiqueta del plano */}
      <div
        className="vc-stage-tag"
        style={{ position: "absolute", left: 10, top: 10, display: "flex", gap: 8, alignItems: "center", padding: "4px 9px", borderRadius: 8, background: "rgba(8,12,18,.7)", border: "1px solid #1b2430", pointerEvents: "none" }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#dbe3ee" }}>{planeLabel || plane}</span>
        {!is3d ? <span style={{ fontSize: 11, color: "#7d8aa0" }}>{sliceIndex} / {planeMax || PLANE_MAX[plane]}</span> : null}
        {is3d ? <span style={{ fontSize: 11, color: "#7d8aa0" }}>{vol.mode === "mip" ? "MIP" : "Sólido"}</span> : null}
      </div>

      {/* lectura de zoom */}
      {!compact ? (
        <div className="vc-stage-zoom" style={{ position: "absolute", right: 10, top: 10, fontSize: 11, color: "#9aa7bd", background: "rgba(8,12,18,.7)", borderRadius: 8, padding: "3px 8px", pointerEvents: "none" }}>
          {Math.round(view.zoom * 100)}%
        </div>
      ) : null}

      {/* cerrar el trazado del canal */}
      {tool === "canal" && pending.length > 0 ? (
        <button
          type="button"
          className="vc-finish"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={finishCanal}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 14,
            transform: "translateX(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minHeight: 48,
            padding: "0 16px",
            borderRadius: 10,
            border: "1px solid var(--accent,#2a6fdb)",
            background: "var(--accent,#2a6fdb)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            zIndex: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          }}
        >
          <IcCheck /> Finalizar trazado ({pending.length})
        </button>
      ) : null}

      {/* lupa: duplica el contenido (placeholder o render de T7) magnificado */}
      {loupe
        ? (() => {
            const r = 132;
            const mag = 2.3;
            const cr = contentRef.current ? contentRef.current.getBoundingClientRect() : null;
            const sr = stageRef.current ? stageRef.current.getBoundingClientRect() : null;
            if (!cr || !sr) return null;
            const offX = cr.left - sr.left;
            const offY = cr.top - sr.top;
            const fx = loupe.x - offX;
            const fy = loupe.y - offY;
            const innerW = cr.width * mag;
            const innerH = cr.height * mag;
            const tx = -fx * mag + r / 2;
            const ty = -fy * mag + r / 2;
            return (
              <div
                className="vc-loupe"
                style={{
                  position: "absolute",
                  left: loupe.x - r / 2,
                  top: loupe.y - r / 2,
                  width: r,
                  height: r,
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "2px solid rgba(255,255,255,.85)",
                  boxShadow: "0 8px 30px rgba(0,0,0,.55)",
                  pointerEvents: "none",
                  zIndex: 7,
                  background: "#06080c",
                }}
              >
                <div style={{ position: "absolute", left: 0, top: 0, width: innerW, height: innerH, transform: `translate(${tx}px, ${ty}px)` }}>{renderInner()}</div>
                <div style={{ position: "absolute", left: r / 2 - 0.5, top: 8, bottom: 8, width: 1, background: "rgba(255,255,255,.5)" }} />
                <div style={{ position: "absolute", top: r / 2 - 0.5, left: 8, right: 8, height: 1, background: "rgba(255,255,255,.5)" }} />
              </div>
            );
          })()
        : null}
    </div>
  );
}

export default Stage;
