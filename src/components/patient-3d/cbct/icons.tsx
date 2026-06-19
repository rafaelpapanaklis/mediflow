// Set de iconos SVG del visor CBCT rediseñado. Portado de
// _design_odontograma/DaleControl-Visor-CBCT/visor/jsx/icons.jsx (window.* → ESM).
// Stroke-based, heredan currentColor, viewBox 24x24. Sin "use client": son SVG
// puros sin hooks; se renderizan dentro de componentes cliente.

import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { sw?: number };
/** Tipo de un icono del set (componente que acepta IconProps). */
export type CbctIcon = (props?: IconProps) => JSX.Element;

type IProps = IconProps & { fill?: string; children?: ReactNode };

// Envoltorio común: aplica el estilo stroke por defecto y permite override de
// strokeWidth vía `sw`. Cuando `fill` está presente, usa relleno y quita stroke.
function I({ fill, children, sw = 1.8, ...p }: IProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill={fill || "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      {children}
    </svg>
  );
}

// ── Herramientas ─────────────────────────────────────────────────────────────
export const IcCursor: CbctIcon = (p) => (
  <I {...p}><path d="M5 3l5.5 16 2.2-6.4L19 10.5 5 3z" /></I>
);
export const IcPan: CbctIcon = (p) => (
  <I {...p}>
    <path d="M12 3v8M12 21v-4M3 12h8M21 12h-4M12 11a2 2 0 100 4 2 2 0 000-4z" strokeWidth={1.6} />
    <path d="M9 5l3-2 3 2M19 9l2 3-2 3M15 19l-3 2-3-2M5 15l-2-3 2-3" />
  </I>
);
export const IcRuler: CbctIcon = (p) => (
  <I {...p}>
    <path d="M14.5 3.5l6 6L9.5 20.5l-6-6L14.5 3.5z" />
    <path d="M8 9l1.7 1.7M11 6.5l1.7 1.7M5.5 11.5l1.7 1.7" strokeWidth={1.5} />
  </I>
);
export const IcAngle: CbctIcon = (p) => (
  <I {...p}>
    <path d="M4 20h16M4 20L18 6" />
    <path d="M9 20a8 8 0 014.8-7.3" strokeWidth={1.4} />
  </I>
);
export const IcNote: CbctIcon = (p) => (
  <I {...p}><path d="M3 5.5A2.5 2.5 0 015.5 3h13A2.5 2.5 0 0121 5.5v8A2.5 2.5 0 0118.5 16H9l-5 4 1-4H5.5A2.5 2.5 0 013 13.5v-8z" /></I>
);
export const IcNerve: CbctIcon = (p) => (
  <I {...p}>
    <path d="M4 17c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3" />
    <path d="M4 11c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3" />
  </I>
);
export const IcImplant: CbctIcon = (p) => (
  <I {...p}>
    <path d="M9 3h6l-1 3H10L9 3z" />
    <path d="M10 6h4l-.5 4h-3L10 6z" />
    <path d="M11.5 10l.5 9 .5-9" />
    <path d="M10.5 11.5h3M10.7 13.5h2.6M11 15.5h2" strokeWidth={1.3} />
  </I>
);
export const IcLoupe: CbctIcon = (p) => (
  <I {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.3-4.3M11 8v6M8 11h6" strokeWidth={1.5} />
  </I>
);
export const IcCompare: CbctIcon = (p) => (
  <I {...p}>
    <rect x="3" y="5" width="7.5" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="7.5" height="14" rx="1.2" />
  </I>
);
export const IcCamera: CbctIcon = (p) => (
  <I {...p}>
    <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-9z" />
    <circle cx="12" cy="13" r="3.2" />
  </I>
);
export const IcUndo: CbctIcon = (p) => (
  <I {...p}><path d="M9 7H5V3M5 7a8 8 0 11-2 5" /></I>
);
export const IcTrash: CbctIcon = (p) => (
  <I {...p}><path d="M4 7h16M9 7V4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5V7M6 7l1 12.5A1.5 1.5 0 008.5 21h7a1.5 1.5 0 001.5-1.5L18 7" /></I>
);

// ── UI ───────────────────────────────────────────────────────────────────────
export const IcClose: CbctIcon = (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>;
export const IcChevR: CbctIcon = (p) => <I {...p}><path d="M9 5l7 7-7 7" /></I>;
export const IcChevL: CbctIcon = (p) => <I {...p}><path d="M15 5l-7 7 7 7" /></I>;
export const IcChevD: CbctIcon = (p) => <I {...p}><path d="M5 9l7 7 7-7" /></I>;
export const IcLayers: CbctIcon = (p) => (
  <I {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5M3 16.5l9 5 9-5" strokeWidth={1.4} />
  </I>
);
export const IcCoronal: CbctIcon = (p) => (
  <I {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M12 4v16" strokeWidth={1.3} />
  </I>
);
export const IcSagital: CbctIcon = (p) => (
  <I {...p}><rect x="7" y="3" width="10" height="18" rx="2" /></I>
);
export const IcCube: CbctIcon = (p) => (
  <I {...p}>
    <path d="M12 2.5l8 4.5v9l-8 4.5-8-4.5v-9l8-4.5z" />
    <path d="M12 11.5l8-4.5M12 11.5v9M12 11.5L4 7" strokeWidth={1.3} />
  </I>
);
export const IcReset: CbctIcon = (p) => <I {...p}><path d="M4 4v5h5M4 9a8 8 0 11-1 5" /></I>;
export const IcZoomIn: CbctIcon = (p) => (
  <I {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.3-4.3M10.5 7.5v6M7.5 10.5h6" />
  </I>
);
export const IcZoomOut: CbctIcon = (p) => (
  <I {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.3-4.3M7.5 10.5h6" />
  </I>
);
export const IcBone: CbctIcon = (p) => (
  <I {...p}><path d="M7 17a2 2 0 11-2.6 2.6A2 2 0 014 17a2 2 0 010-2l9-9a2 2 0 012-3 2 2 0 012.6 2.6A2 2 0 0120 7a2 2 0 010 2l-9 9a2 2 0 01-3 2z" strokeWidth={1.4} /></I>
);
export const IcSun: CbctIcon = (p) => (
  <I {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" strokeWidth={1.4} />
  </I>
);
export const IcContrast: CbctIcon = (p) => (
  <I {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor" stroke="none" />
  </I>
);
export const IcCheck: CbctIcon = (p) => <I {...p}><path d="M5 12.5l4.5 4.5L19 7" /></I>;
export const IcDownload: CbctIcon = (p) => (
  <I {...p}><path d="M12 3v12M7 11l5 5 5-5M4 20h16" strokeWidth={1.6} /></I>
);
export const IcPlay: CbctIcon = (p) => (
  <I {...p} fill="currentColor"><path d="M7 4.5v15l12-7.5-12-7.5z" /></I>
);
export const IcGrid: CbctIcon = (p) => (
  <I {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
  </I>
);
export const IcExpand: CbctIcon = (p) => (
  <I {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></I>
);
export const IcTooth: CbctIcon = (p) => (
  <I {...p}><path d="M6 3.5c2 0 2.5 1.2 6 1.2S16 3.5 18 3.5c2.5 0 3.5 2.5 2.8 6.5-.5 3-1 5-1.6 7.5-.4 1.6-1 3-2 3s-1.2-1.5-1.6-3.5C15.2 13 14.8 12 12 12s-3.2 1-3.6 5c-.4 2-.6 3.5-1.6 3.5s-1.6-1.4-2-3C4.2 15 3.7 13 3.2 10 2.5 6 3.5 3.5 6 3.5z" /></I>
);
