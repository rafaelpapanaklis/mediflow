"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogo } from "../dialogo";

/**
 * Modal mínimo de la pantalla de suscripción. Se monta por portal DENTRO de
 * .barber-shell (para heredar los tokens caramelo) pero FUERA de .dcbb-root
 * (container-type atraparía el position:fixed). Escape cierra; el foco
 * entra al diálogo al abrir y vuelve al disparador al cerrar.
 */
export function BillingModal({
  open,
  titleId,
  onClose,
  children,
}: {
  open: boolean;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHost((document.querySelector(".barber-shell") as HTMLElement | null) ?? document.body);
  }, []);

  // Esc, foco inicial y foco de vuelta UNA vez por apertura (ver ../dialogo.ts).
  // El foco va al primer campo o botón; si no hay, a la caja (tabIndex -1).
  useDialogo({ panel: boxRef, onClose, abierta: open && host !== null, bloquearScroll: false });

  if (!open || !host) return null;

  return createPortal(
    <div className="dcbb-modal-backdrop" onMouseDown={onClose}>
      <div
        ref={boxRef}
        className="dcbb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    host,
  );
}
