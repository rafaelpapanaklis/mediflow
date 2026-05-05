"use client";
// Pediatrics — Modal de comparativo evolución pre/post tratamiento. Spec: §1.13.5, §4.A.8

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface EvolutionPair {
  label: string;
  beforeUrl: string;
  beforeDate: Date;
  afterUrl?: string | null;
  afterDate?: Date | null;
}

export interface EvolutionCompareModalProps {
  open: boolean;
  onClose: () => void;
  patientName: string;
  pairs: EvolutionPair[];
}

export function EvolutionCompareModal(props: EvolutionCompareModalProps) {
  const { open, onClose, patientName, pairs } = props;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ped-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="ped-modal modal--full">
        <header className="ped-modal__header">
          <div>
            <p className="ped-modal__breadcrumb">Evolución</p>
            <h2 id={titleId} className="ped-modal__title">Comparativo pre/post — {patientName}</h2>
          </div>
          <button type="button" className="ped-modal__close" aria-label="Cerrar" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </header>
        <div className="ped-modal__body">
          {pairs.length === 0 ? (
            <p className="pedi-card__empty">No hay pares de fotos comparativas todavía.</p>
          ) : (
            <div className="ped-evolution-grid">
              {pairs.map((p, i) => (
                <article key={`${p.label}-${i}`} className="ped-evolution-pair">
                  <h3>{p.label}</h3>
                  <div className="ped-evolution-pair__columns">
                    <figure>
                      <img src={p.beforeUrl} alt={`${p.label} antes`} />
                      <figcaption>Antes · {fmt(p.beforeDate)}</figcaption>
                    </figure>
                    <figure>
                      {p.afterUrl ? (
                        <img src={p.afterUrl} alt={`${p.label} después`} />
                      ) : (
                        <div className="ped-evolution-pair__placeholder">Sin foto post</div>
                      )}
                      <figcaption>{p.afterUrl ? `Después · ${fmt(p.afterDate)}` : "—"}</figcaption>
                    </figure>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}
