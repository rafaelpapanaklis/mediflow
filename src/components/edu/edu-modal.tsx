"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * El modal del vertical. MÓVIL PRIMERO: en el teléfono es una hoja que sube
 * desde abajo (el pulgar llega a los botones); en escritorio se centra.
 * Todo el cambio vive en edu-theme.css.
 *
 * Lo que hace y por qué:
 *  · Escape cierra — sin esto, con teclado no hay forma de salir.
 *  · El fondo NO se desplaza mientras está abierto (si no, el dedo arrastra
 *    la página de atrás y la hoja parece pegada).
 *  · El foco entra al abrir y VUELVE al elemento que lo abrió al cerrar; sin
 *    lo segundo, quien navega con teclado aparece al principio de la página
 *    después de guardar.
 *  · aria-modal + role="dialog" + aria-labelledby: el lector de pantalla
 *    anuncia de qué es este modal, no "diálogo".
 *
 * NO hay trampa de foco completa (Tab puede salirse hacia la página de
 * atrás). Es una limitación conocida y anotada: meter una biblioteca de
 * diálogos por esto habría traído dependencias nuevas al vertical.
 */
export interface EduModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Se bloquea el cierre mientras hay una escritura en vuelo. */
  busy?: boolean;
}

export function EduModal({ title, subtitle, onClose, children, footer, busy }: EduModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  // useId y no un contador propio: React garantiza que es único y estable
  // entre renders, sin efectos secundarios en cada pintado.
  const titleId = useId();

  useEffect(() => {
    returnTo.current = (document.activeElement as HTMLElement) ?? null;
    cardRef.current?.focus();
    return () => {
      returnTo.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  return (
    <div
      className="edu-modal"
      onMouseDown={(e) => {
        // Solo la cortina cierra: un arrastre que empieza dentro de la
        // tarjeta y termina fuera no debe tirar lo que se está escribiendo.
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="edu-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="edu-modal__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="edu-modal__title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="edu-modal__sub">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="edu-iconbtn"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            <X size={17} />
          </button>
        </div>

        <div className="edu-modal__body">{children}</div>

        {footer && <div className="edu-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
