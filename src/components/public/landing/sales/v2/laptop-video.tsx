"use client";

import { useEffect, useRef } from "react";

/**
 * La pantalla de la laptop: una grabación real del panel en bucle, SIN
 * controles (autoplay + muted + loop + playsinline). Igual que «El panel, en
 * vivo»: arranca cuando la sección entra en pantalla, se pausa al salir
 * (batería) y con prefers-reduced-motion no se reproduce: se ve el póster
 * (su primer frame) quieto.
 *
 * El <video> viene renderizado del servidor con su póster; este archivo solo
 * aporta el observador.
 */
export function LaptopVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      v.removeAttribute("autoplay");
      v.pause();
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      v.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.2 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      className="dctp-laptop__video"
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      aria-label={label}
      disablePictureInPicture
    />
  );
}
