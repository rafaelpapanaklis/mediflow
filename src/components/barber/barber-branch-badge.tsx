"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { switchBranchAndReload } from "@/components/barber/team/admin-nav";
import { BARBER_BRANCH_ALL, isConsolidatedPath, sedeElegida } from "@/lib/barber/branch-cookie";

/** Valor de la última opción del selector: no es una sede, abre Sucursales. */
export const BARBER_BRANCH_MANAGE = "__administrar-sucursales";

export interface BarberBranchBadgeOption {
  id: string;
  label: string;
  isActive: boolean;
}

/**
 * Rótulo de la SEDE que se está operando, en la barra de arriba (sucursales
 * de verdad, 15-nov). Solo aparece en cadenas con más de una sede visible.
 *
 * Lo que dice es la verdad de la pantalla: la sede del contexto de sesión
 * (getBarberContext ya opera la sede elegida). «Toda la cadena» solo se
 * enseña —y solo se ofrece— en las pantallas que consolidan; en las demás,
 * con la cookie en «toda la cadena», la sesión opera la sede propia y eso es
 * lo que se lee aquí.
 *
 * Cambiar de sede escribe la misma cookie que el selector de Inicio y la
 * barra de administración, y recarga en duro (switchBranchAndReload).
 */
export function BarberBranchBadge({
  options,
  activeId,
  consolidated,
  selectedId = null,
  manageHref = null,
  labels,
}: {
  options: BarberBranchBadgeOption[];
  /** Sede que opera la sesión (ctx.barbershopId). */
  activeId: string;
  /** La cookie pide «toda la cadena» y la sesión puede consolidar. */
  consolidated: boolean;
  /** Valor crudo de la cookie del selector (sin validar). */
  selectedId?: string | null;
  /**
   * Pantalla de Sucursales, solo si la sesión puede administrarlas
   * (branches.manage): al final del selector sale «Administrar sucursales…».
   */
  manageHref?: string | null;
  labels: { branch: string; aria: string; all: string; closed: string; closedGroup?: string; manage?: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (options.length < 2) return null;

  const canShowAll = isConsolidatedPath(pathname);
  const showingAll = consolidated && canShowAll;
  // UNA sola sede para todo el panel (16-nov): la misma regla que el servidor
  // (sedeElegida). Una sede CERRADA nunca se enseña como elegida: antes, en
  // Inicio, el selector «cambiaba solo» a la cerrada que guardaba la cookie
  // mientras Agenda decía la principal.
  const elegida = sedeElegida({ requested: canShowAll ? selectedId : null, options, fallback: activeId });
  const value = showingAll ? BARBER_BRANCH_ALL : elegida === BARBER_BRANCH_ALL ? activeId : elegida;
  const abiertas = options.filter((o) => o.isActive);
  const cerradas = options.filter((o) => !o.isActive);

  return (
    <label
      className="ml-auto inline-flex min-w-0 items-center gap-1.5"
      style={{ fontSize: 12, color: "var(--text-3)" }}
      data-barber-branch-badge
    >
      <Building2 size={14} aria-hidden style={{ flexShrink: 0 }} />
      <span className="hidden sm:inline">{labels.branch}:</span>
      <select
        value={value}
        disabled={busy}
        aria-label={labels.aria}
        onChange={(e) => {
          // «Administrar sucursales…» no cambia de sede: solo lleva a la pantalla
          // (16-nov, Rafael no encontraba dónde reabrir una sede cerrada).
          if (e.target.value === BARBER_BRANCH_MANAGE) {
            if (manageHref) router.push(manageHref);
            return;
          }
          setBusy(true);
          void switchBranchAndReload(e.target.value);
        }}
        className="min-w-0 max-w-[45vw] truncate sm:max-w-[240px]"
        style={{
          height: 30,
          padding: "0 8px",
          borderRadius: 8,
          border: "1px solid var(--border-soft)",
          background: "var(--bg-elev)",
          color: "var(--text-1)",
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: "inherit",
        }}
      >
        {canShowAll ? <option value={BARBER_BRANCH_ALL}>{labels.all}</option> : null}
        {abiertas.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {/* Cerradas: aparte y sin poder elegirse (se reabren en Sucursales). */}
        {cerradas.length > 0 ? (
          <optgroup label={labels.closedGroup ?? labels.closed}>
            {cerradas.map((o) => (
              <option key={o.id} value={o.id} disabled>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {manageHref && labels.manage ? (
          <>
            <option disabled value="">
              ──────────
            </option>
            <option value={BARBER_BRANCH_MANAGE}>{labels.manage}</option>
          </>
        ) : null}
      </select>
    </label>
  );
}
