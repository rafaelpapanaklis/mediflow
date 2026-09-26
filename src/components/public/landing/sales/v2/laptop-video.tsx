"use client";

import { useEffect, useRef, useState } from "react";

/**
 * La pantalla de la laptop: grabaciones reales del panel, SIN controles
 * (autoplay + muted + playsinline). Igual que «El panel, en vivo»: arranca
 * cuando la sección entra en pantalla, se pausa al salir (batería) y con
 * prefers-reduced-motion no se reproduce: se ve el póster (su primer frame)
 * quieto.
 *
 * Añadido 2b (Rafael): la laptop tiene que enseñar más de lo que cabe en un
 * vídeo, así que recibe VARIOS y los ALTERNA: al terminar uno empieza el
 * siguiente y, tras el último, vuelve al primero. Con uno solo, es un bucle.
 *
 * El <video> viene renderizado del servidor con el primer vídeo y su póster;
 * este archivo aporta el observador y el cambio de fuente.
 */
export interface VideoLaptop {
  src: string;
  poster: string;
}

export function LaptopVideo({ videos, label }: { videos: VideoLaptop[]; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [i, setI] = useState(0);
  const visible = useRef(false);
  const reduced = useRef(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    reduced.current = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) {
      v.removeAttribute("autoplay");
      v.pause();
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      visible.current = true;
      v.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        visible.current = entries.some((e) => e.isIntersecting);
        if (visible.current) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.2 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  // Al cambiar de fuente, si la sección se ve, sigue reproduciendo.
  useEffect(() => {
    const v = ref.current;
    if (!v || reduced.current || !visible.current) return;
    v.play().catch(() => {});
  }, [i]);

  const actual = videos[i] ?? videos[0];
  return (
    <video
      ref={ref}
      key={actual.src}
      className="dctp-laptop__video"
      src={actual.src}
      poster={actual.poster}
      muted
      loop={videos.length === 1}
      playsInline
      autoPlay
      preload={i === 0 ? "metadata" : "auto"}
      aria-label={label}
      disablePictureInPicture
      onEnded={() => { if (videos.length > 1) setI((k) => (k + 1) % videos.length); }}
    />
  );
}
