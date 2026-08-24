"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Modal del dinero barber sobre .modal-overlay/.modal de globals.css. Se
 * renderiza en la RAÍZ del componente cliente (fuera de cualquier caja con
 * container-type: un contenedor atrapa position:fixed). Cierra con Esc y
 * clic en el fondo.
 */
export function BarberModal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  closeLabel = "Cerrar",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal barber-shell ${wide ? "modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__header">
          <div className="modal__title">{title}</div>
          <button type="button" className="icon-btn-new" onClick={onClose} aria-label={closeLabel}>
            <X size={14} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
