"use client";

// ============================================================================
// Progreso REAL de subida — compartido por el paso 5 (Mapear, vista previa) y el
// panel "Importando…". Dos fases honestas:
//   · "uploading"  → barra determinada con el % real de subida (xhr.upload) + ETA.
//   · "processing" → spinner indeterminado mientras el servidor parsea/inserta
//                    (una sola respuesta, SIN progreso por fila → no se inventa %).
// Accesible: la barra es role="progressbar" con aria-valuenow/min/max.
// ============================================================================
import { Loader2 } from "lucide-react";
import type { TFunction } from "@/i18n/t";

export type UploadPhase = "uploading" | "processing";

export interface UploadProgressState {
  phase: UploadPhase;
  /** % de subida (0..100). */
  pct: number;
  /** Segundos restantes estimados; null si aún no es fiable. */
  eta: number | null;
  /** Contexto opcional (p. ej. "Pacientes · 1 de 3"); vacío en la vista previa. */
  label?: string;
}

interface Props {
  t: TFunction;
  prog: UploadProgressState | null;
  /** "inline" = paso 5 (compacto); "panel" = pantalla Importando (más aire). */
  variant?: "inline" | "panel";
}

/** ETA en segundos → "~Xs" o "~Xm Ys" (neutro es/en). */
function formatEta(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `~${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `~${m}m` : `~${m}m ${rem}s`;
}

export function UploadProgress({ t, prog, variant = "inline" }: Props) {
  const phase: UploadPhase = prog?.phase ?? "uploading";
  const pct = prog ? Math.min(100, Math.max(0, Math.round(prog.pct))) : 0;
  const spinSize = variant === "panel" ? 40 : 22;

  // -- Procesando (indeterminado) --------------------------------------------
  if (phase === "processing") {
    return (
      <div className={`imp-upprog imp-upprog--${variant} imp-upprog--proc`} role="status" aria-live="polite">
        <Loader2 className="animate-spin imp-spin" size={spinSize} aria-hidden />
        <span className="imp-upprog__proc">{t("shell.importClinic.upload.processing")}</span>
        {prog?.label ? <span className="imp-upprog__ctx">{prog.label}</span> : null}
      </div>
    );
  }

  // -- Subiendo (barra real) --------------------------------------------------
  const etaText = prog?.eta != null ? t("shell.importClinic.upload.eta", { time: formatEta(prog.eta) }) : "";
  return (
    <div className={`imp-upprog imp-upprog--${variant}`}>
      <div className="imp-upprog__line">{t("shell.importClinic.upload.uploading", { pct })}</div>
      {prog?.label ? <div className="imp-upprog__ctx">{prog.label}</div> : null}
      <div
        className="imp-progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("shell.importClinic.upload.aria")}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="imp-progress-meta">
        {/* NBSP cuando aún no hay ETA: mantiene estable la altura de la fila. */}
        <span>{etaText || " "}</span>
        <span className="mono">{pct}%</span>
      </div>
    </div>
  );
}
