"use client";

import { switchBranchAndReload } from "@/components/barber/team/admin-nav";

export interface BranchOption {
  id: string;
  label: string;
}

/** Valor de la cookie dcb_branch para la vista consolidada (BARBER_BRANCH_ALL en branches.ts, que es server-only). */
export const BRANCH_ALL_VALUE = "all";

/**
 * Selector de sede de Inicio. Escribe la MISMA cookie que la barra de
 * administración (dcb_branch, vía switchBranchAndReload) y recarga: así la
 * sede elegida aquí es la que verán después caja, agenda y reportes.
 */
export function BranchSelect({
  options,
  value,
  allLabel,
  ariaLabel,
}: {
  options: BranchOption[];
  /** id de la sede activa o "all" (consolidado). */
  value: string;
  allLabel: string;
  ariaLabel: string;
}) {
  return (
    <select
      className="bdash-select"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => {
        void switchBranchAndReload(e.target.value);
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
      <option value={BRANCH_ALL_VALUE}>{allLabel}</option>
    </select>
  );
}
