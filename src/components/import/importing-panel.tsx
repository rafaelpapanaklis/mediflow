"use client";

// Pantalla "Importando" — barra de progreso animada (simulada por el wizard).
import { Loader2 } from "lucide-react";
import type { TFunction } from "@/i18n/t";

interface Props {
  t: TFunction;
  pct: number;
  label: string;
}

export function ImportingPanel({ t, pct, label }: Props) {
  return (
    <div className="imp-importing" role="status" aria-live="polite">
      <Loader2 className="animate-spin imp-spin" size={48} aria-hidden />
      <h3 className="imp-title" style={{ textAlign: "center" }}>{t("shell.importClinic.importing.title")}</h3>
      <p className="imp-sub" style={{ textAlign: "center", marginBottom: 0 }}>{t("shell.importClinic.importing.dontClose")}</p>
      <div className="imp-progress">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="imp-progress-meta">
        <span>{label}</span>
        <span className="mono">{Math.round(pct)}%</span>
      </div>
    </div>
  );
}
