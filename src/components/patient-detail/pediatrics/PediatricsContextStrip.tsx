"use client";
// Pediatrics — strip horizontal sticky con métricas clave + acciones rápidas. Spec: §1.4, §4.A.4

import { Plus, TrendingDown, TrendingUp } from "lucide-react";
import type { CambraCategory } from "@/lib/pediatrics/cambra";
import type { DentitionType } from "@/lib/pediatrics/dentition";

export interface PediatricsContextStripProps {
  ageFormatted: string;
  dentition: DentitionType;
  latestFranklValues: Array<{ value: number; date: Date }>;
  latestCambraCategory: CambraCategory | null;
  nextAppointmentLabel?: string;
  onCaptureFrankl: () => void;
  onCaptureCambra: () => void;
}

export function PediatricsContextStrip(props: PediatricsContextStripProps) {
  const { ageFormatted, dentition, latestFranklValues, latestCambraCategory, nextAppointmentLabel } = props;

  const last2 = latestFranklValues.slice(-2);
  const trend = last2.length === 2
    ? last2[1]!.value - last2[0]!.value > 0 ? "up"
    : last2[1]!.value - last2[0]!.value < 0 ? "down" : "flat"
    : "flat";

  return (
    <div className="pedi-context-strip">
      <div className="pedi-context-strip__block">
        <span className="pedi-context-strip__label">Edad</span>
        <span className="pedi-context-strip__value pedi-context-strip__mono">{ageFormatted}</span>
      </div>
      <div className="pedi-context-strip__block">
        <span className="pedi-context-strip__label">Dentición</span>
        <span className="pedi-context-strip__value pedi-context-strip__cap">{dentition}</span>
      </div>
      <div className="pedi-context-strip__block">
        <span className="pedi-context-strip__label">Frankl últimas</span>
        <span className="pedi-context-strip__value">
          {last2.length === 0 ? "—" : (
            <>
              {last2.map((f, i) => (
                <span key={i} className={`frankl-pill frankl-pill--${f.value} pedi-context-strip__pill`}>{f.value}</span>
              ))}
              {trend === "up" ? <TrendingUp size={12} className="pedi-context-strip__trend pedi-context-strip__trend--up" aria-label="Mejorando" /> : null}
              {trend === "down" ? <TrendingDown size={12} className="pedi-context-strip__trend pedi-context-strip__trend--down" aria-label="Regresión" /> : null}
            </>
          )}
        </span>
      </div>
      <div className="pedi-context-strip__block">
        <span className="pedi-context-strip__label">CAMBRA</span>
        <span className="pedi-context-strip__value">
          {latestCambraCategory ? (
            <span className={`cambra-chip cambra-chip--${latestCambraCategory}`}>
              <span className="cambra-chip__dot" aria-hidden />
              {latestCambraCategory.charAt(0).toUpperCase() + latestCambraCategory.slice(1)}
            </span>
          ) : "—"}
        </span>
      </div>
      <div className="pedi-context-strip__block">
        <span className="pedi-context-strip__label">Próxima</span>
        <span className="pedi-context-strip__value">{nextAppointmentLabel ?? "—"}</span>
      </div>

      <div className="pedi-context-strip__actions">
        <button type="button" className="pedi-btn" onClick={props.onCaptureFrankl}>
          <Plus size={14} aria-hidden /> Frankl
        </button>
        <button type="button" className="pedi-btn" onClick={props.onCaptureCambra}>
          <Plus size={14} aria-hidden /> CAMBRA
        </button>
      </div>
    </div>
  );
}
