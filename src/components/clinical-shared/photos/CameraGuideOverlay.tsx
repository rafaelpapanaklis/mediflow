"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H7:
// silueta de referencia superpuesta sobre la cámara/preview al tomar la
// serie de fotos estándar, para que todas las visitas salgan encuadradas
// igual. Componente NUEVO — no modifica PhotoUploader.tsx ni el resto de
// clinical-shared/photos, que siguen sirviendo a todas las especialidades.

export type CameraGuideShot =
  | "FRONTAL_REPOSO"
  | "FRONTAL_SONRISA"
  | "PERFIL"
  | "OCLUSAL_SUPERIOR"
  | "OCLUSAL_INFERIOR"
  | "INTRAORAL_FRONTAL"
  | "INTRAORAL_LATERAL_D"
  | "INTRAORAL_LATERAL_I";

const GUIDE_LABEL: Record<CameraGuideShot, string> = {
  FRONTAL_REPOSO: "Frente, en reposo",
  FRONTAL_SONRISA: "Frente, sonriendo",
  PERFIL: "Perfil",
  OCLUSAL_SUPERIOR: "Oclusal superior",
  OCLUSAL_INFERIOR: "Oclusal inferior",
  INTRAORAL_FRONTAL: "Intraoral frontal",
  INTRAORAL_LATERAL_D: "Intraoral lateral derecha",
  INTRAORAL_LATERAL_I: "Intraoral lateral izquierda",
};

/** Silueta SVG simple por tipo de toma — guía visual, no medición. */
function GuideSvg({ shot }: { shot: CameraGuideShot }) {
  const stroke = "rgba(255,255,255,0.65)";
  if (shot === "PERFIL") {
    return (
      <svg viewBox="0 0 200 300" className="w-full h-full">
        <path
          d="M70 40 Q60 20 90 15 Q140 15 150 60 Q155 90 140 110 Q150 130 145 150 L140 230 Q130 260 100 270 L80 270 L85 230 Q60 200 55 150 Q50 100 60 70 Z"
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeDasharray="6 4"
        />
      </svg>
    );
  }
  if (shot === "OCLUSAL_SUPERIOR" || shot === "OCLUSAL_INFERIOR") {
    return (
      <svg viewBox="0 0 200 200" className="w-full h-full">
        <ellipse cx="100" cy="100" rx="70" ry="50" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="6 4" />
      </svg>
    );
  }
  if (shot.startsWith("INTRAORAL")) {
    return (
      <svg viewBox="0 0 200 160" className="w-full h-full">
        <rect x="30" y="40" width="140" height="80" rx="16" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="6 4" />
      </svg>
    );
  }
  // FRONTAL_*
  return (
    <svg viewBox="0 0 200 260" className="w-full h-full">
      <ellipse cx="100" cy="110" rx="68" ry="90" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="6 4" />
      <line x1="100" y1="20" x2="100" y2="230" stroke={stroke} strokeWidth="1" strokeDasharray="2 4" />
      <line x1="55" y1="95" x2="145" y2="95" stroke={stroke} strokeWidth="1" strokeDasharray="2 4" />
    </svg>
  );
}

export interface CameraGuideOverlayProps {
  shot: CameraGuideShot;
  /** Se renderiza detrás de la guía (preview de cámara o imagen ya tomada). */
  children?: React.ReactNode;
  className?: string;
}

export function CameraGuideOverlay({ shot, children, className = "" }: CameraGuideOverlayProps) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-black ${className}`}>
      {children}
      <div className="absolute inset-0 pointer-events-none">
        <GuideSvg shot={shot} />
      </div>
      <div className="absolute bottom-2 left-2 right-2 text-center">
        <span className="inline-block bg-black/50 text-white text-[11px] px-2 py-0.5 rounded-full">
          {GUIDE_LABEL[shot]}
        </span>
      </div>
    </div>
  );
}

export { GUIDE_LABEL as CAMERA_GUIDE_LABELS };
