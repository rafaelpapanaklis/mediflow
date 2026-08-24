"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setHost((document.querySelector(".barber-shell") as HTMLElement | null) ?? document.body);
  }, []);

  // Escape cierra (se re-suscribe si cambia onClose, sin tocar el foco).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Foco: entra al diálogo al abrir y vuelve al disparador SOLO al cerrar.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => boxRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      restoreRef.current?.focus?.();
    };
  }, [open]);

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
