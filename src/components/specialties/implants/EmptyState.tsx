"use client";
// Implants — vista vacía con CTA "Nuevo implante". Spec §11.

import { Anchor, Plus } from "lucide-react";

export interface EmptyStateProps {
  onNew: () => void;
}

export function EmptyState({ onNew }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="rounded-full bg-blue-50 dark:bg-blue-950/40 p-5 mb-5">
        <Anchor className="h-10 w-10 text-blue-600 dark:text-blue-400" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-1,theme(colors.gray.900))]">
        Sin implantes registrados
      </h3>
      <p className="mt-2 text-sm text-[var(--text-2,theme(colors.gray.600))] max-w-md">
        Cuando agregues el primer implante de este paciente aparecerá aquí
        con su tarjeta-timeline y todos los datos COFEPRIS.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
      >
        <Plus className="h-4 w-4" />
        Planear primer implante
      </button>
    </div>
  );
}
