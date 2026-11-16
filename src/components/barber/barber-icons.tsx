/**
 * Iconos de línea del vertical BARBER — un solo archivo, un solo trazo.
 *
 * Vienen de la propuesta C del rediseño (15-nov-2026, el menú que eligió
 * Rafael): rejilla de 24, trazo 2 con puntas y esquinas CORTADAS
 * (butt + miter). Los del oficio (poste, tijeras, navaja, silla, botella…)
 * se dibujaron para barbería; los de interfaz siguen el mismo trazo para
 * que convivan. Sin librería: SVG en línea, color = currentColor.
 *
 * Uso: <BarberIcon name="silla" size={16} />. Decorativo siempre
 * (aria-hidden): el nombre accesible lo pone el texto o el aria-label del
 * botón que lo contiene.
 */
import type { ReactNode } from "react";

const F = { fill: "currentColor", stroke: "none" } as const;

const PATHS = {
  // ── Del oficio ──────────────────────────────────────────────────────
  poste: (
    <>
      <rect x="7.5" y="2" width="9" height="3.5" {...F} />
      <rect x="7.5" y="18.5" width="9" height="3.5" {...F} />
      <path d="M9 5.5v13M15 5.5v13M9 12.5l6-4.5M9 17.5l6-4.5" />
    </>
  ),
  tijeras: (
    <>
      <circle cx="6.5" cy="18" r="3" />
      <circle cx="17.5" cy="18" r="3" />
      <path d="M8.4 15.6 19 2.5M15.6 15.6 5 2.5" />
    </>
  ),
  navaja: (
    <>
      <path d="M3 3.5h13.5l3.5 3.5V10H3z" />
      <path d="M19.5 10.5 8 20.5" strokeWidth={4.2} />
    </>
  ),
  silla: (
    <>
      <path d="M7 3v9.5h9.5" />
      <path d="M10 8h6" />
      <path d="M11.5 12.5V19" />
      <rect x="6" y="19" width="11" height="3" {...F} />
      <path d="M16.5 12.5v4h4.5" />
    </>
  ),
  botella: (
    <>
      <rect x="9.5" y="2" width="5" height="4" {...F} />
      <path d="M10 6v2.5L7 12v9.5h10V12l-3-3.5V6" />
      <path d="M10 15h4" />
    </>
  ),
  // ── Del menú ────────────────────────────────────────────────────────
  agenda: (
    <>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 2v5M16 2v5" />
      <rect x="7" y="13" width="4" height="4" {...F} />
    </>
  ),
  bandeja: (
    <>
      <path d="M3 13 6 4h12l3 9v7.5H3z" />
      <path d="M3 13h5.5l1.2 3h4.6l1.2-3H21" />
    </>
  ),
  clientes: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20.5v-2c0-2.6 2.6-4.2 6.5-4.2s6.5 1.6 6.5 4.2v2" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.8 14.8c1.7.7 2.7 1.9 2.7 3.7v2" />
    </>
  ),
  caja: (
    <>
      <rect x="7.5" y="2.5" width="9" height="5" />
      <path d="M4 21.5V12l2-4.5h12l2 4.5v9.5z" />
      <path d="M4 16h16M10.5 18.8h3" />
    </>
  ),
  porciento: (
    <>
      <path d="M19 4.5 5 19.5" />
      <circle cx="7" cy="7" r="2.7" />
      <circle cx="17" cy="17" r="2.7" />
    </>
  ),
  corona: <path d="M3 7.5 7.6 12 12 4.5 16.4 12 21 7.5 19 19.5H5z" />,
  barras: (
    <>
      <path d="M2.5 21.5h19" />
      <rect x="5" y="11" width="3.5" height="8" {...F} />
      <rect x="10.3" y="5" width="3.5" height="14" {...F} />
      <rect x="15.6" y="14" width="3.5" height="5" {...F} />
    </>
  ),
  ventana: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M3 9h18M6.5 6.5h1M9.5 6.5h1" />
    </>
  ),
  globo: (
    <>
      <path d="M3.5 4h17v12H11l-5 4.5V16H3.5z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  // Dos globos que se responden: la bandeja de Mensajes (WhatsApp, que es
  // el canal, lleva el globo solo).
  charla: (
    <>
      <path d="M2.5 3.5h13v9H8l-4 3.5v-3.5H2.5z" />
      <path d="M15.5 8h6v9.5H19.5V21L16 17.5H9.5v-5" />
    </>
  ),
  megafono: (
    <>
      <path d="M4 9.5v5h4l9 5V4.5l-9 5z" />
      <path d="M20.5 9.5v5M7.5 14.5V20h3" />
    </>
  ),
  tarjeta: (
    <>
      <rect x="2.5" y="5" width="19" height="14" />
      <path d="M2.5 10h19" />
      <path d="M6 15h4" />
    </>
  ),
  ajustes: (
    <>
      <path d="M3 7h18M3 17h18" />
      <rect x="13.5" y="4" width="4" height="6" {...F} />
      <rect x="6.5" y="14" width="4" height="6" {...F} />
    </>
  ),
  socios: (
    <>
      <circle cx="8.8" cy="12" r="5.8" />
      <circle cx="15.2" cy="12" r="5.8" />
    </>
  ),
  salvavidas: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M5.6 5.6 9.5 9.5M14.5 14.5l3.9 3.9M18.4 5.6 14.5 9.5M9.5 14.5l-3.9 3.9" />
    </>
  ),
  salir: (
    <>
      <path d="M10 4H4v16h6" />
      <path d="M9 12h12M17 7.5l4.5 4.5-4.5 4.5" />
    </>
  ),
  // ── De interfaz ─────────────────────────────────────────────────────
  equis: <path d="M5 5l14 14M19 5 5 19" />,
  rayas: <path d="M3 6.5h18M3 12h18M3 17.5h18" />,
  flecha: <path d="M3.5 12h17M14 5.5l6.5 6.5-6.5 6.5" />,
  palomita: <path d="M4 12.5l5.2 5.2L20 6.5" />,
  horario: (
    <>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 2v5M16 2v5M12 12.5v3.2l2.4 1.4" />
    </>
  ),
  cartera: (
    <>
      <path d="M3 6h15v3h3v11H3z" />
      <path d="M3 9h15" />
      <rect x="15" y="13" width="3" height="3" {...F} />
    </>
  ),
  sube: <path d="M12 20.5v-17M5.5 10 12 3.5l6.5 6.5" />,
  baja: <path d="M12 3.5v17M5.5 14l6.5 6.5 6.5-6.5" />,
  lapiz: (
    <>
      <path d="M4 20l1-4.6L16 4.4 19.6 8 8.6 19z" />
      <path d="M13.4 7 17 10.6" />
    </>
  ),
  // ── De la bandeja de Mensajes ──────────────────────────────────────
  lupa: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3 21 21" />
    </>
  ),
  atras: <path d="M20.5 12h-17M10 5.5 3.5 12l6.5 6.5" />,
  enviar: (
    <>
      <path d="M3 3.5 21.5 12 3 20.5 5.5 12z" />
      <path d="M5.5 12H12" />
    </>
  ),
  archivo: (
    <>
      <rect x="2.5" y="4" width="19" height="5" />
      <path d="M4.5 9v11h15V9M10 13h4" />
    </>
  ),
  clip: <path d="M8.5 12V6.5a3.5 3.5 0 0 1 7 0V17a2 2 0 0 1-4 0V8.5" />,
  foto: (
    <>
      <rect x="3" y="6" width="18" height="14" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M8.5 6 10 3.5h4L15.5 6" />
    </>
  ),
  micro: (
    <>
      <path d="M9 3h6v10H9z" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  dobles: <path d="M1.5 12.5l5 5L17 7M11.5 16.5l1 1L23 7" />,
  reloj: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  alerta: (
    <>
      <path d="M12 3 22 20.5H2z" />
      <path d="M12 9.5v5M12 16.5v2.2" />
    </>
  ),
  robot: (
    <>
      <rect x="4" y="8" width="16" height="12" />
      <path d="M12 3.5V8M2 13v3M22 13v3M9 16.5h6" />
      <rect x="8" y="11.5" width="2.5" height="2.5" {...F} />
      <rect x="13.5" y="11.5" width="2.5" height="2.5" {...F} />
    </>
  ),
  // Credencial (Equipo): la cuenta con la que alguien entra al panel.
  credencial: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <circle cx="9" cy="11" r="2" />
      <path d="M5.5 17c.6-1.8 1.9-2.7 3.5-2.7s2.9.9 3.5 2.7M15 10h3.5M15 14h3.5" />
    </>
  ),
  persona: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21v-1.5c0-3.3 3.4-5.5 7.5-5.5s7.5 2.2 7.5 5.5V21" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type BarberIconName = keyof typeof PATHS;

export function BarberIcon({
  name,
  size = 18,
  className,
}: {
  name: BarberIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * Icono de cada entrada del menú, por la CLAVE de la entrada (no por el
 * `icon` de BARBER_NAV_ITEMS: WhatsApp y Campañas comparten ahí
 * "message-circle" y aquí cada una lleva el suyo). Lo que no esté en el
 * mapa cae al poste, que nunca es un hueco.
 */
export const BARBER_NAV_ICON: Record<string, BarberIconName> = {
  inicio: "poste",
  agenda: "agenda",
  fila: "silla",
  solicitudes: "bandeja",
  clientes: "clientes",
  mensajes: "charla",
  servicios: "tijeras",
  barberos: "navaja",
  equipo: "credencial",
  caja: "caja",
  comisiones: "porciento",
  membresias: "corona",
  productos: "botella",
  reportes: "barras",
  "mi-web": "ventana",
  whatsapp: "globo",
  campanas: "megafono",
  suscripcion: "tarjeta",
  configuracion: "ajustes",
  afiliados: "socios",
  soporte: "salvavidas",
};
