/**
 * Iconografía del oficio, dibujada a mano para esta landing: tijeras,
 * navaja, máquina, peine, brocha, silla y libreta. Monolínea, trazo 1.7,
 * `currentColor`, viewBox 24 — conviven con lucide sin desentonar, pero
 * son objetos de barbería y no pictogramas genéricos.
 *
 * Todas son decorativas (aria-hidden): el texto de al lado dice lo que son.
 */
import type { SVGProps } from "react";

type IconProps = { size?: number; className?: string };

function base(size: number, className?: string): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
    focusable: "false",
  };
}

/** Tijeras de barbero: anillas a la izquierda, hojas largas cruzadas. */
export function OficioTijeras({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="5" cy="6.5" r="2.6" />
      <circle cx="5" cy="17.5" r="2.6" />
      <path d="M7.2 8.1 11 12l10.2-5.7" />
      <path d="M7.2 15.9 11 12l10.2 5.7" />
      <path d="M11 12h.01" strokeWidth="2.4" />
    </svg>
  );
}

/** Navaja abierta: mango abajo a la izquierda, hoja hacia arriba. */
export function OficioNavaja({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M2.6 18.2 9.6 11.2l3 3-7 7-3-3z" />
      <path d="M10.9 12.4 18.6 4.7c.9-.9 2.3-.9 3.1 0l-.5 2.7-8.3 8.3z" />
      <path d="M16.6 6.7l.9.9" />
    </svg>
  );
}

/** Máquina de corte: cuerpo con dientes arriba. */
export function OficioMaquina({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="7" y="7.5" width="10" height="14" rx="3" />
      <path d="M6 7.5h12" />
      <path d="M7.5 5h9" />
      <path d="M9 2.5v2.5M12 2.5v2.5M15 2.5v2.5" />
      <path d="M12 12v5" />
    </svg>
  );
}

/** Peine: lomo arriba y púas hacia abajo. */
export function OficioPeine({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3.5 5.5h17a1 1 0 0 1 1 1V9h-19V6.5a1 1 0 0 1 1-1z" />
      <path d="M5 9v9.5M8 9v9.5M11 9v9.5M14 9v9.5M17 9v9.5M20 9v9.5" />
    </svg>
  );
}

/** Brocha de afeitar: campana de cerdas y mango torneado. */
export function OficioBrocha({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8.8 12.6C6.5 11.9 5 9.8 5 7.3 5 5 8.1 2.8 12 2.8s7 2.2 7 4.5c0 2.5-1.5 4.6-3.8 5.3" />
      <path d="M8.8 12.6h6.4l1 8.6H7.8z" />
      <path d="M9.6 7.2c.4 1.7 1.2 2.7 2.4 3.4" />
    </svg>
  );
}

/** Silla de barbero: respaldo, asiento, pedestal y base. */
export function OficioSilla({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7.5 3.5h9A1.5 1.5 0 0 1 18 5v6.5H6V5a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M4.5 11.5h15a1 1 0 0 1 1 1v2.2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2.2a1 1 0 0 1 1-1z" />
      <path d="M12 15.7V19M7.5 21.5h9M9 19h6" />
      <path d="M9.5 7h5" />
    </svg>
  );
}

/** Libreta de espiral con las citas a mano. */
export function OficioLibreta({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6.5 3.5h10A1.5 1.5 0 0 1 18 5v14a1.5 1.5 0 0 1-1.5 1.5h-10z" />
      <path d="M4.5 7h3.5M4.5 11h3.5M4.5 15h3.5" />
      <path d="M10.5 8.5h4.5M10.5 12h3M10.5 15.5h4" />
    </svg>
  );
}

/** La barra de herramientas del hero: cinco objetos, en orden de estación. */
export function OficioRail({ size = 24 }: { size?: number }) {
  return (
    <>
      <span>
        <OficioTijeras size={size} />
      </span>
      <i />
      <span>
        <OficioNavaja size={size} />
      </span>
      <i />
      <span>
        <OficioMaquina size={size} />
      </span>
      <i />
      <span>
        <OficioPeine size={size} />
      </span>
      <i />
      <span>
        <OficioBrocha size={size} />
      </span>
    </>
  );
}
