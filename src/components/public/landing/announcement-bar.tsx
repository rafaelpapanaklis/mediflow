"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

// Barra de anuncio Dovetail: única superficie con relleno azul cornflower.
// Texto OSCURO (#0a0a0a) sobre #6798ff para cumplir contraste AA (~7.5:1);
// el blanco sobre cornflower no pasaría AA. Descartable (client).
export function AnnouncementBar() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div className="lp-announce" role="region" aria-label="Anuncio">
      <Link href="#precios" className="lp-announce__msg">
        <span className="lp-announce__tag">NUEVO</span>
        Radiografías con análisis por IA para clínicas dentales
        <span aria-hidden="true">→</span>
      </Link>
      <button
        type="button"
        className="lp-announce__close"
        aria-label="Cerrar anuncio"
        onClick={() => setOpen(false)}
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      <style>{`
        .lp-announce {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 9px 44px;
          background: #6798ff;
          color: #0a0a0a;
          text-align: center;
        }
        .lp-announce__msg {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: #0a0a0a;
          text-decoration: none;
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: 14px;
          font-weight: 500;
          letter-spacing: -0.012em;
        }
        .lp-announce__msg:hover { text-decoration: underline; }
        .lp-announce__tag {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 0.08em;
          padding: 2px 7px;
          border-radius: 4px;
          background: rgba(10,10,10,0.16);
          color: #0a0a0a;
        }
        .lp-announce__close {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          display: grid;
          place-items: center;
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: #0a0a0a;
          cursor: pointer;
        }
        .lp-announce__close:hover { background: rgba(10,10,10,0.12); }
        .landing-theme .lp-announce__close:focus-visible { outline: 2px solid #0a0a0a; outline-offset: 1px; }
        @media (max-width: 560px) {
          .lp-announce__msg { font-size: 12.5px; }
          .lp-announce { padding: 8px 40px; }
        }
      `}</style>
    </div>
  );
}
