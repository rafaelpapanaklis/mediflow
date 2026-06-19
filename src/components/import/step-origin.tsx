"use client";

// Paso 1 · Origen — grid de sistemas seleccionables + banner de migración asistida.
import { Sparkles, Check } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { type Origin, originGlyph } from "./import-client";

interface Props {
  t: TFunction;
  origins: Origin[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAssisted: () => void;
}

export function StepOrigin({ t, origins, selected, onSelect, onAssisted }: Props) {
  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.step1.title")}</h2>
      <p className="imp-sub">{t("shell.importClinic.step1.sub")}</p>

      <div className="imp-src-grid" role="group" aria-label={t("shell.importClinic.step1.title")}>
        {origins.map((o) => {
          const isOn = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              className="imp-src-card"
              aria-pressed={isOn}
              onClick={() => onSelect(o.id)}
            >
              <span className="imp-src-card__check" aria-hidden>
                <Check size={13} />
              </span>
              <span className="imp-logo" style={{ background: o.color }} aria-hidden>
                {originGlyph(o)}
              </span>
              <span className="imp-src-card__nm">{o.name}</span>
              <span className="imp-src-card__meta">
                {o.hasProfile
                  ? t("shell.importClinic.step1.metaProfile")
                  : t("shell.importClinic.step1.metaManual")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="imp-callout">
        <span className="imp-callout__ic" aria-hidden><Sparkles size={21} /></span>
        <div className="imp-callout__txt">
          <b>{t("shell.importClinic.step1.assistedTitle")}</b>
          <p>{t("shell.importClinic.step1.assistedDesc")}</p>
        </div>
        <button type="button" className="btn-new btn-new--secondary" onClick={onAssisted}>
          {t("shell.importClinic.assistedCta")}
        </button>
      </div>
    </div>
  );
}
