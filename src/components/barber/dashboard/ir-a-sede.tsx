"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

/**
 * Lleva a una pantalla de OTRA sede (ws6-t6, 16-nov): primero cambia la sede
 * que opera la sesión (la misma cookie que el selector de arriba) y luego
 * navega en duro, para que Horarios, Barberos o Agenda abran ESA sede. Si la
 * sede ya es la que se opera, es una liga normal.
 */
export function IrASede({
  branchId,
  operatingBranchId,
  href,
  className,
  children,
}: {
  branchId: string;
  operatingBranchId: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  if (branchId === operatingBranchId) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/barber/branches/switch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId }),
          });
        } catch {
          /* si la cookie no se pudo poner, la pantalla abre la sede de siempre */
        }
        window.location.assign(href);
      }}
    >
      {children}
    </button>
  );
}
