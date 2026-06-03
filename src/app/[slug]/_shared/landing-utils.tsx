"use client";
/* ============================================================
   Helpers compartidos para las plantillas de landing pública.
   Reimplementación en React/TS de design/helpers.jsx con los
   nombres de export EXACTOS que consumen T2–T4.
   ============================================================ */
import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/* ---------- COLOR ---------- */
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Interpolación lineal en RGB entre dos hex (amt 0→a, 1→b). */
export function mix(a: string, b: string, amt: number) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.r + (y.r - x.r) * amt, x.g + (y.g - x.g) * amt, x.b + (y.b - x.b) * amt);
}
/** Mezcla hacia blanco. */
export const tint = (hex: string, amt: number) => mix(hex, "#ffffff", amt);
/** Mezcla hacia negro. */
export const shade = (hex: string, amt: number) => mix(hex, "#000000", amt);
/** rgba() con opacidad. */
export const alpha = (hex: string, a: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
/**
 * Ajuste aditivo por canal (mismo comportamiento que usa la landing "classic":
 * themeDark = hexAdjust(theme, -35)). Positivo aclara, negativo oscurece.
 */
export function hexAdjust(hex: string, amount: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* ---------- COMPONENTES ---------- */
/** <img> con fallback a un gradiente del acento si la carga falla o no hay src. */
export function SmartImg({
  src,
  alt,
  className = "",
  style = {},
  accent = "#0f766e",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  style?: CSSProperties;
  accent?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <div
        className={className}
        role="img"
        aria-label={alt}
        style={{ ...style, background: `linear-gradient(135deg, ${tint(accent, 0.15)}, ${shade(accent, 0.25)})` }}
      />
    );
  }
  return <img src={src} alt={alt} className={className} style={style} loading="lazy" onError={() => setFailed(true)} />;
}

/** Fila de estrellas de rating (value de 0 a 5). */
export function Stars({
  value,
  size = 16,
  color = "#f5b301",
  className = "",
}: {
  value: number;
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <span className={"inline-flex items-center gap-0.5 " + className} aria-label={`${value} de 5 estrellas`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i < Math.round(value) ? color : "#d6d3d1"} aria-hidden="true">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

/** Logo "G" multicolor de Google. */
export function GoogleG({ size = 18 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

/* ---------- HOOKS / UTIL ---------- */
/** Detecta si el scroll superó un umbral (navbar transparente → sólida). */
export function useScrolled(threshold = 50) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/** Resalta la sección activa en la navbar vía IntersectionObserver. */
export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive((e.target as HTMLElement).id);
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
  return active;
}

/**
 * Wrapper de entrada por scroll. Anima SOLO `transform` (translateY) para que
 * el contenido nunca quede oculto si JS falla o no hay IntersectionObserver.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
  style = {},
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: keyof JSX.IntrinsicElements;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const Comp = Tag as any;
  return (
    <Comp
      ref={ref}
      className={className}
      style={{
        ...style,
        transform: shown ? "translateY(0)" : "translateY(24px)",
        transition: `transform .6s cubic-bezier(.2,.8,.2,1) ${delay}ms`,
        willChange: "transform",
      }}
    >
      {children}
    </Comp>
  );
}

/** Smooth scroll a un ancla con offset de navbar. */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 76, behavior: "smooth" });
}

/** Estado de índice para la galería con lightbox. */
export function useLightbox() {
  const [idx, setIdx] = useState(-1);
  return {
    idx,
    open: (i: number) => setIdx(i),
    close: () => setIdx(-1),
    set: setIdx,
  };
}

/** Visor de galería a pantalla completa. Teclado ←/→/Esc. */
export function Lightbox({ images, lb }: { images: string[]; lb: ReturnType<typeof useLightbox> }) {
  const { idx, close, set } = lb;
  useEffect(() => {
    if (idx < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") set((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") set((i) => (i - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [idx, images.length, close, set]);
  if (idx < 0) return null;
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Galería"
    >
      <button
        onClick={(e) => { e.stopPropagation(); set((i) => (i - 1 + images.length) % images.length); }}
        aria-label="Anterior"
        className="absolute left-3 sm:left-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition"
      >
        <ChevronLeft size={26} />
      </button>
      <img
        src={images[idx]}
        alt=""
        className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={(e) => { e.stopPropagation(); set((i) => (i + 1) % images.length); }}
        aria-label="Siguiente"
        className="absolute right-3 sm:right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition"
      >
        <ChevronRight size={26} />
      </button>
      <button
        onClick={close}
        aria-label="Cerrar"
        className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition"
      >
        <X size={22} />
      </button>
    </div>
  );
}
