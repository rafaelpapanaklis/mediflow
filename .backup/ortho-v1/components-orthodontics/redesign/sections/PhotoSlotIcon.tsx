// SVG placeholder por tipo — silueta digitalizada minimal violet.
// Replica los 10 íconos del mockup (`docs/.../sections-E-I.jsx` líneas 18-51).

export type PhotoSlotKind =
  | "face-front"
  | "face-smile"
  | "face-side"
  | "teeth-front"
  | "teeth-overbite"
  | "teeth-right"
  | "teeth-left"
  | "teeth-overjet"
  | "occlusal-lower"
  | "occlusal-upper";

const STROKE = "#7c3aed";
const FILL = "#ede9fe";

export function PhotoSlotIcon({ kind }: { kind: PhotoSlotKind }) {
  switch (kind) {
    case "face-front":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <ellipse cx="30" cy="28" rx="14" ry="18" fill={FILL} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="24" cy="26" r="1.4" fill={STROKE} />
          <circle cx="36" cy="26" r="1.4" fill={STROKE} />
          <path d="M27 36 Q30 38 33 36" stroke={STROKE} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M22 50 Q30 56 38 50" stroke={STROKE} strokeWidth="1.5" fill="none" />
        </svg>
      );
    case "face-smile":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <ellipse cx="30" cy="28" rx="14" ry="18" fill={FILL} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="24" cy="26" r="1.4" fill={STROKE} />
          <circle cx="36" cy="26" r="1.4" fill={STROKE} />
          <path d="M22 35 Q30 43 38 35 L36 38 Q30 40 24 38 Z" fill="white" stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M22 50 Q30 56 38 50" stroke={STROKE} strokeWidth="1.5" fill="none" />
        </svg>
      );
    case "face-side":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M38 12 Q44 18 44 28 Q44 36 40 38 L42 42 L40 44 Q40 50 36 52 L20 52 Q18 38 20 28 Q22 14 32 11 Z" fill={FILL} stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="36" cy="28" r="1.3" fill={STROKE} />
          <path d="M40 38 Q42 42 38 44" stroke={STROKE} strokeWidth="1" fill="none" />
        </svg>
      );
    case "teeth-front":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M8 22 Q30 16 52 22 L50 38 Q30 42 10 38 Z" fill="#fdf2f8" stroke={STROKE} strokeWidth="1.5" />
          <line x1="20" y1="22" x2="20" y2="40" stroke={STROKE} strokeWidth="1" />
          <line x1="26" y1="20" x2="26" y2="41" stroke={STROKE} strokeWidth="1" />
          <line x1="30" y1="19" x2="30" y2="42" stroke={STROKE} strokeWidth="1" />
          <line x1="34" y1="20" x2="34" y2="41" stroke={STROKE} strokeWidth="1" />
          <line x1="40" y1="22" x2="40" y2="40" stroke={STROKE} strokeWidth="1" />
          <path d="M8 22 Q30 28 52 22" stroke="#ec4899" strokeWidth="1.2" fill="none" opacity="0.5" />
        </svg>
      );
    case "teeth-overbite":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M10 18 Q30 14 50 18 L48 28 Q30 30 12 28 Z" fill="white" stroke={STROKE} strokeWidth="1.5" />
          <path d="M12 32 Q30 36 48 32 L46 44 Q30 46 14 44 Z" fill={FILL} stroke={STROKE} strokeWidth="1.5" />
          <line x1="20" y1="18" x2="20" y2="29" stroke={STROKE} strokeWidth="0.8" />
          <line x1="30" y1="16" x2="30" y2="29" stroke={STROKE} strokeWidth="0.8" />
          <line x1="40" y1="18" x2="40" y2="29" stroke={STROKE} strokeWidth="0.8" />
        </svg>
      );
    case "teeth-right":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M10 22 L46 18 L50 30 L46 42 L10 38 Z" fill={FILL} stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="18" y1="22" x2="18" y2="38" stroke={STROKE} strokeWidth="1" />
          <line x1="26" y1="21" x2="26" y2="39" stroke={STROKE} strokeWidth="1" />
          <line x1="34" y1="20" x2="34" y2="40" stroke={STROKE} strokeWidth="1" />
          <line x1="42" y1="19" x2="42" y2="41" stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case "teeth-left":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M50 22 L14 18 L10 30 L14 42 L50 38 Z" fill={FILL} stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="42" y1="22" x2="42" y2="38" stroke={STROKE} strokeWidth="1" />
          <line x1="34" y1="21" x2="34" y2="39" stroke={STROKE} strokeWidth="1" />
          <line x1="26" y1="20" x2="26" y2="40" stroke={STROKE} strokeWidth="1" />
          <line x1="18" y1="19" x2="18" y2="41" stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case "teeth-overjet":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M10 22 L36 22 L40 30 L36 38 L10 38 Z" fill="white" stroke={STROKE} strokeWidth="1.5" />
          <path d="M48 28 L42 30 L48 32" fill="none" stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="36" y1="28" x2="48" y2="28" stroke="#ec4899" strokeWidth="1" strokeDasharray="2,2" />
          <line x1="36" y1="32" x2="48" y2="32" stroke="#ec4899" strokeWidth="1" strokeDasharray="2,2" />
        </svg>
      );
    case "occlusal-lower":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M30 12 Q12 14 10 32 Q12 48 30 50 Q48 48 50 32 Q48 14 30 12 Z" fill={FILL} stroke={STROKE} strokeWidth="1.5" />
          <path d="M30 18 Q18 20 16 32 Q18 42 30 44 Q42 42 44 32 Q42 20 30 18 Z" fill="white" stroke={STROKE} strokeWidth="1" />
          <circle cx="22" cy="20" r="1.5" fill={STROKE} />
          <circle cx="38" cy="20" r="1.5" fill={STROKE} />
          <circle cx="16" cy="32" r="1.5" fill={STROKE} />
          <circle cx="44" cy="32" r="1.5" fill={STROKE} />
          <circle cx="22" cy="44" r="1.5" fill={STROKE} />
          <circle cx="38" cy="44" r="1.5" fill={STROKE} />
        </svg>
      );
    case "occlusal-upper":
      return (
        <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden>
          <path d="M30 50 Q12 48 10 28 Q12 12 30 10 Q48 12 50 28 Q48 48 30 50 Z" fill={FILL} stroke={STROKE} strokeWidth="1.5" />
          <path d="M30 44 Q18 42 16 28 Q18 18 30 16 Q42 18 44 28 Q42 42 30 44 Z" fill="white" stroke={STROKE} strokeWidth="1" />
          <circle cx="22" cy="40" r="1.5" fill={STROKE} />
          <circle cx="38" cy="40" r="1.5" fill={STROKE} />
          <circle cx="16" cy="28" r="1.5" fill={STROKE} />
          <circle cx="44" cy="28" r="1.5" fill={STROKE} />
          <circle cx="22" cy="16" r="1.5" fill={STROKE} />
          <circle cx="38" cy="16" r="1.5" fill={STROKE} />
        </svg>
      );
  }
}

/** Definición canónica de los 10 slots fotográficos en orden de captura. */
export const PHOTO_SLOTS: ReadonlyArray<{
  id: string;
  label: string;
  group: "extraoral" | "intraoral";
  icon: PhotoSlotKind;
}> = [
  { id: "normal", label: "Normal", group: "extraoral", icon: "face-front" },
  { id: "sonrisa", label: "Sonrisa", group: "extraoral", icon: "face-smile" },
  { id: "lateral", label: "Lateral", group: "extraoral", icon: "face-side" },
  { id: "frontal", label: "Frontal", group: "intraoral", icon: "teeth-front" },
  { id: "sobremordida", label: "Sobremordida", group: "intraoral", icon: "teeth-overbite" },
  { id: "lat_der", label: "Lateral derecha", group: "intraoral", icon: "teeth-right" },
  { id: "lat_izq", label: "Lateral izquierda", group: "intraoral", icon: "teeth-left" },
  { id: "resalte", label: "Resalte", group: "intraoral", icon: "teeth-overjet" },
  { id: "oclusal_inf", label: "Oclusal Inferior", group: "intraoral", icon: "occlusal-lower" },
  { id: "oclusal_sup", label: "Oclusal Superior", group: "intraoral", icon: "occlusal-upper" },
];
