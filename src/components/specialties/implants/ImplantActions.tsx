"use client";
// Implants — botones de acciones rápidas en el footer de la tarjeta.
// Spec §6.7.

import {
  Camera,
  FileSignature,
  CreditCard,
  AlertTriangle,
  Stethoscope,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { ImplantFull } from "@/lib/types/implants";

export type ImplantActionType =
  | "radiographs"
  | "consent"
  | "passport"
  | "complication"
  | "maintenance"
  | "traceability"
  | "remove";

export interface ImplantActionsProps {
  implant: ImplantFull;
  onAction: (action: ImplantActionType) => void;
}

export function ImplantActions({ implant, onAction }: ImplantActionsProps) {
  const hasPassport = !!implant.passport;
  const hasProsthetic = !!implant.prostheticPhase;
  const isReadOnly =
    implant.currentStatus === "REMOVED" || implant.currentStatus === "FAILED";

  const baseBtn =
    "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors";
  const neutralBtn = `${baseBtn} border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-700 text-[var(--text-2,theme(colors.gray.700))] hover:bg-[var(--bg-elev,theme(colors.gray.50))] dark:hover:bg-gray-800`;
  const warningBtn = `${baseBtn} border-orange-200 dark:border-orange-900 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/40`;
  const cautionBtn = `${baseBtn} border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40`;
  const dangerBtn = `${baseBtn} border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40`;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800">
      <button type="button" className={neutralBtn} onClick={() => onAction("radiographs")}>
        <Camera className="h-3.5 w-3.5" />
        Radiografías
      </button>
      <button type="button" className={neutralBtn} onClick={() => onAction("consent")}>
        <FileSignature className="h-3.5 w-3.5" />
        Consentimiento
      </button>
      <button
        type="button"
        className={`${neutralBtn} ${hasPassport ? "" : "opacity-50 cursor-not-allowed"}`}
        disabled={!hasPassport}
        title={hasPassport ? "Descargar carnet PDF" : "Disponible al finalizar fase protésica"}
        onClick={() => hasPassport && onAction("passport")}
      >
        <CreditCard className="h-3.5 w-3.5" />
        Carnet PDF
      </button>
      {!isReadOnly && (
        <button type="button" className={warningBtn} onClick={() => onAction("complication")}>
          <AlertTriangle className="h-3.5 w-3.5" />
          Registrar complicación
        </button>
      )}
      {hasProsthetic && !isReadOnly && (
        <button type="button" className={neutralBtn} onClick={() => onAction("maintenance")}>
          <Stethoscope className="h-3.5 w-3.5" />
          Mantenimiento
        </button>
      )}
      {!isReadOnly && (
        <button
          type="button"
          className={cautionBtn}
          onClick={() => onAction("traceability")}
          title="Modificar lote / marca / fecha — requiere justificación COFEPRIS ≥20 chars"
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          Modificar trazabilidad
        </button>
      )}
      {!isReadOnly && (
        <button type="button" className={dangerBtn} onClick={() => onAction("remove")}>
          <Trash2 className="h-3.5 w-3.5" />
          Remover implante
        </button>
      )}
    </div>
  );
}
