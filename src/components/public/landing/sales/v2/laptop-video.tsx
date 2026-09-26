"use client";

import { useEffect, useRef, useState } from "react";

/**
 * La pantalla de la laptop: grabaciones reales del panel, SIN controles
 * (muted + playsinline, sin play ni barra). Igual que «El panel, en vivo»:
 * arranca cuando la sección entra en pantalla, se pausa al salir (batería) y
 * con prefers-reduced-motion no se reproduce: se ve el póster quieto.
 *
 * Ajuste 3 (Rafael: «se pone negro después de un rato y no repite»). Antes
 * había UN <video> que se desmontaba y volvía a montar con otro `src` al
 * terminar: entre el final de uno y el primer cuadro del siguiente la pantalla
 * se quedaba en negro, y si el elemento nuevo no arrancaba solo, ahí se
 * quedaba. Ahora es como el panel en vivo de t1: TODOS los vídeos están
 * montados y apilados desde el principio (`preload="auto"`), solo el activo
 * se ve (opacity) y al terminar se enciende el siguiente —que ya está cargado
 * y en su primer cuadro— con un fundido; tras el último vuelve al primero.
 * Nunca hay un cuadro negro: debajo siempre está el póster del activo.
 */
export interface VideoLaptop {
  src: string;
  poster: string;
}

const FUNDIDO_MS = 350;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LaptopVideo({ videos, label }: { videos: VideoLaptop[]; label: string }) {
  const raiz = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const [activo, setActivo] = useState(0);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(reducedMotion());
    const el = raiz.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Reproduce solo el activo, y solo mientras se ve; los demás quietos en su
  // primer cuadro, listos para entrar sin hueco.
  useEffect(() => {
    refs.current.forEach((v, i) => {
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
  }, [activo, visible, reduced]);

  const siguiente = () => {
    if (videos.length < 2) return;
    setActivo((k) => (k + 1) % videos.length);
  };

  return (
    <div ref={raiz} className="dctp-laptop__videos" role="img" aria-label={label}>
      {videos.map((v, i) => (
        <video
          key={v.src}
          ref={(el) => { refs.current[i] = el; }}
          className={`dctp-laptop__video${i === activo ? " is-on" : ""}`}
          style={{ transitionDuration: `${FUNDIDO_MS}ms` }}
          src={v.src}
          poster={v.poster}
          muted
          playsInline
          preload="auto"
          loop={videos.length === 1}
          disablePictureInPicture
          onEnded={siguiente}
          // Si un vídeo no puede reproducirse (red, códec), no se queda ahí: pasa al siguiente.
          onError={siguiente}
        />
      ))}
    </div>
  );
}
