"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconoPanel } from "./icono-panel";
import { Tilt3D } from "./tilt-3d";
import { FUNCIONES_VIDEO, type FuncionVideo } from "./panel-vivo-data";

/**
 * EL PANEL, EN VIVO. Seis grabaciones del panel real, una por función, dentro
 * de un marco de navegador. No es un reproductor: no hay play, ni controles,
 * ni barra. La pantalla «está viva» (autoplay, muted, loop, playsinline) y al
 * tocar una tarjeta cambia de función con un fundido.
 *
 * · Arranca sola con la primera función cuando la sección entra en pantalla y
 *   se pausa al salir (batería).
 * · Mientras nadie toque nada, al terminar una vuelta pasa a la siguiente
 *   función; si el visitante elige una, se queda en la suya en bucle.
 * · Los seis <video> están montados y apilados; solo el activo se ve
 *   (opacity) y se reproduce. `preload="metadata"` + `poster` (su primer
 *   frame) para que siempre haya imagen antes de que cargue.
 * · prefers-reduced-motion: no se reproduce nada; se ve el primer frame
 *   quieto de la función elegida.
 */

const FUNDIDO_MS = 420;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function PanelVivo() {
  const raiz = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [activo, setActivo] = useState(0);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [elegido, setElegido] = useState(false);
  const ultimoT = useRef(0);

  useEffect(() => {
    setReduced(reducedMotion());
    const el = raiz.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Reproduce solo el activo, y solo mientras se ve; los demás quietos al inicio.
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === activo && visible && !reduced) {
        v.play().catch(() => {});
      } else {
        v.pause();
        if (i !== activo) {
          try { v.currentTime = 0; } catch {}
        }
      }
    });
    ultimoT.current = 0;
  }, [activo, visible, reduced]);

  const cambia = useCallback((i: number, porToque: boolean) => {
    if (porToque) setElegido(true);
    setActivo((prev) => {
      if (prev === i) return prev;
      const v = videos.current[i];
      if (v) {
        try { v.currentTime = 0; } catch {}
      }
      return i;
    });
  }, []);

  // Al dar la vuelta (currentTime retrocede con `loop`), si nadie eligió, pasa a la siguiente.
  const alAvanzar = useCallback(
    (i: number) => (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (i !== activo) return;
      const t = e.currentTarget.currentTime;
      if (t + 0.5 < ultimoT.current && !elegido) {
        cambia((i + 1) % FUNCIONES_VIDEO.length, false);
        return;
      }
      ultimoT.current = t;
    },
    [activo, elegido, cambia],
  );

  const f = FUNCIONES_VIDEO[activo];

  return (
    <div ref={raiz} className="dcv4-pv">
      {/* El marco del navegador con la pantalla del panel. SOLO el marco va en el
          escenario inclinado (Tilt3D): las tarjetas se quedan planas, porque un
          botón que se mueve bajo el puntero mientras el escenario gira puede
          perder el toque (medido: fallaban las tarjetas de los extremos). */}
      <Tilt3D max={3} className="dcv4-tilt--panel">
      <div className="dcv4-pv__frame" role="img" aria-label={`Grabación del panel: ${f.ve}`}>
        <div className="dcv4-pv__chrome" aria-hidden="true">
          <span className="dcv4-pv__dots"><i /><i /><i /></span>
          <span className="dcv4-pv__url">app.dalecontrol.com/{f.id === "hoy" ? "dashboard" : f.id === "odontograma" ? "dashboard/pacientes/arturo-reyes" : `dashboard/${f.id}`}</span>
          <span className="dcv4-pv__lock" />
        </div>
        <div className="dcv4-pv__screen" aria-hidden="true">
          {FUNCIONES_VIDEO.map((fv, i) => (
            <video
              key={fv.id}
              ref={(el) => { videos.current[i] = el; }}
              className={`dcv4-pv__video${i === activo ? " is-on" : ""}`}
              src={`/landing/videos/${fv.id}.mp4`}
              poster={`/landing/videos/${fv.id}.webp`}
              muted
              loop
              playsInline
              preload={i === 0 ? "auto" : "metadata"}
              disablePictureInPicture
              onTimeUpdate={alAvanzar(i)}
              tabIndex={-1}
              style={{ transitionDuration: `${FUNDIDO_MS}ms` }}
            />
          ))}
        </div>
      </div>
      </Tilt3D>

      {/* Las tarjetas: una por función. La activa va resaltada, sin barra ni iconos de reproducción. */}
      <div className="dcv4-pv__cards" role="tablist" aria-label="Funciones del panel">
        {FUNCIONES_VIDEO.map((fv, i) => (
          <Tarjeta key={fv.id} f={fv} activa={i === activo} onPick={() => cambia(i, true)} />
        ))}
      </div>
    </div>
  );
}

function Tarjeta({ f, activa, onPick }: { f: FuncionVideo; activa: boolean; onPick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={activa} className={`dcv4-pv__card${activa ? " is-on" : ""}`} onClick={onPick}>
      {f.etiqueta && <span className="dcv4-pv__tag">{f.etiqueta}</span>}
      <span className="dcv4-pv__ico"><IconoPanel nombre={f.icono} size={22} /></span>
      <span className="dcv4-pv__name">{f.nombre}</span>
      <span className="dcv4-pv__line">{f.linea}</span>
    </button>
  );
}
