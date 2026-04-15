import type { SpecialtyGroup } from "@/lib/specialty-content";

interface Props {
  variant: SpecialtyGroup;
  className?: string;
}

/**
 * SVG decorativo de fondo para el hero de cada página de especialidad.
 * Se usa absolutamente posicionado dentro de un contenedor relative.
 * Tres variantes con paletas distintas: salud (azul/teal), estetica (violeta/pink),
 * belleza (rose/amber/teal). Todo inline, sin assets externos.
 */
export function SpecialtyHeroPattern({ variant, className = "" }: Props) {
  const palettes = {
    salud:    { primary: "#3B82F6", secondary: "#14B8A6", accent: "#6366F1" },
    estetica: { primary: "#7C3AED", secondary: "#EC4899", accent: "#A855F7" },
    belleza:  { primary: "#F43F5E", secondary: "#F59E0B", accent: "#14B8A6" },
  } as const;

  const c = palettes[variant];
  const gid = `grad-${variant}`;
  const pid = `dots-${variant}`;
  const fid = `fade-${variant}`;

  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 1440 720"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id={gid} cx="50%" cy="0%" r="80%">
          <stop offset="0%"   stopColor={c.primary}   stopOpacity="0.28" />
          <stop offset="50%"  stopColor={c.accent}    stopOpacity="0.12" />
          <stop offset="100%" stopColor="#0B0F1E"     stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${gid}-2`} cx="100%" cy="100%" r="70%">
          <stop offset="0%"   stopColor={c.secondary} stopOpacity="0.20" />
          <stop offset="60%"  stopColor={c.primary}   stopOpacity="0.05" />
          <stop offset="100%" stopColor="#0B0F1E"     stopOpacity="0" />
        </radialGradient>
        <pattern id={pid} x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill={c.accent} fillOpacity="0.18" />
        </pattern>
        <linearGradient id={fid} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stopColor="#0B0F1E" stopOpacity="0" />
          <stop offset="80%" stopColor="#0B0F1E" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0B0F1E" stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* base dark */}
      <rect width="1440" height="720" fill="#0B0F1E" />

      {/* dot grid */}
      <rect width="1440" height="720" fill={`url(#${pid})`} />

      {/* radial glows */}
      <rect width="1440" height="720" fill={`url(#${gid})`} />
      <rect width="1440" height="720" fill={`url(#${gid}-2)`} />

      {/* large soft circles */}
      <circle cx="180" cy="120" r="260" fill={c.primary} fillOpacity="0.05" />
      <circle cx="1280" cy="600" r="320" fill={c.secondary} fillOpacity="0.04" />
      <circle cx="720" cy="360" r="180" fill={c.accent} fillOpacity="0.04" />

      {/* subtle thin lines (different shape per variant) */}
      {variant === "salud" && (
        <>
          <path d="M0,520 C320,460 640,580 960,500 C1200,440 1320,520 1440,480"
                stroke={c.secondary} strokeOpacity="0.18" strokeWidth="1.2" fill="none" />
          <path d="M0,580 C320,520 640,640 960,560 C1200,500 1320,580 1440,540"
                stroke={c.primary} strokeOpacity="0.10" strokeWidth="1" fill="none" />
        </>
      )}
      {variant === "estetica" && (
        <>
          <path d="M0,420 Q360,260 720,420 T1440,420"
                stroke={c.secondary} strokeOpacity="0.20" strokeWidth="1.4" fill="none" />
          <path d="M0,500 Q360,360 720,500 T1440,500"
                stroke={c.primary} strokeOpacity="0.12" strokeWidth="1" fill="none" />
        </>
      )}
      {variant === "belleza" && (
        <>
          <path d="M0,460 C240,360 480,520 720,420 C960,320 1200,500 1440,400"
                stroke={c.secondary} strokeOpacity="0.20" strokeWidth="1.3" fill="none" />
          <path d="M0,540 C240,460 480,600 720,500 C960,400 1200,580 1440,500"
                stroke={c.accent} strokeOpacity="0.14" strokeWidth="1" fill="none" />
        </>
      )}

      {/* bottom fade for legibility */}
      <rect width="1440" height="720" fill={`url(#${fid})`} />
    </svg>
  );
}

/**
 * Bloque fallback de imagen — se usa cuando un campo unsplashAmbient/unsplashCases
 * es null. Renderiza un gradiente con el SVG pattern por encima para no dejar un
 * cuadro gris feo.
 */
export function SpecialtyImageFallback({
  variant,
  className = "",
  ariaLabel = "",
}: {
  variant: SpecialtyGroup;
  className?: string;
  ariaLabel?: string;
}) {
  const gradients = {
    salud:    "from-blue-500/30 via-teal-500/15 to-indigo-900/40",
    estetica: "from-violet-500/35 via-pink-500/15 to-violet-900/40",
    belleza:  "from-rose-500/30 via-amber-500/15 to-teal-900/40",
  } as const;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${gradients[variant]} ${className}`}
    >
      <div className="absolute inset-0 opacity-60">
        <SpecialtyHeroPattern variant={variant} />
      </div>
    </div>
  );
}
