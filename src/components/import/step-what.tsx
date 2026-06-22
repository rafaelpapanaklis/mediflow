"use client";

// Paso 3 · Qué importar — checkboxes con badges Recomendado / Fácil / Avanzado.
import { Users, CircleDollarSign, CalendarDays, Layers, FileText, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { DATA_TYPES, type DataType } from "./import-client";

const ICONS: Record<DataType["icon"], LucideIcon> = {
  users: Users,
  money: CircleDollarSign,
  calendar: CalendarDays,
  stack: Layers,
  file: FileText,
};

function Badge({ t, kind }: { t: TFunction; kind: DataType["badge"] }) {
  if (kind === "rec") return <span className="badge-new badge-new--brand">{t("shell.importClinic.step3.badgeRec")}</span>;
  if (kind === "easy") return <span className="badge-new badge-new--success"><span className="badge-new__dot" />{t("shell.importClinic.step3.badgeEasy")}</span>;
  return <span className="badge-new badge-new--warning">{t("shell.importClinic.step3.badgeAdv")}</span>;
}

interface Props {
  t: TFunction;
  selected: Set<string>;
  onToggle: (id: string) => void;
}

export function StepWhat({ t, selected, onToggle }: Props) {
  return (
    <div>
      <h2 className="imp-title">{t("shell.importClinic.step3.title")}</h2>
      <p className="imp-sub">{t("shell.importClinic.step3.sub")}</p>

      <div className="imp-opt-list">
        {DATA_TYPES.map((d) => {
          const Icon = ICONS[d.icon];
          const isOn = selected.has(d.id);
          const inputId = `imp-opt-${d.id}`;
          return (
            <label key={d.id} className={`imp-opt${isOn ? " is-on" : ""}`} htmlFor={inputId}>
              <span className="imp-opt__box" aria-hidden><Check size={14} /></span>
              <span className="imp-opt__ic" aria-hidden><Icon size={20} /></span>
              <span className="imp-opt__info">
                <span className="imp-opt__nm">
                  {t(`shell.importClinic.step3.${d.labelKey}`)} <Badge t={t} kind={d.badge} />
                </span>
                <span className="imp-opt__meta">{t(`shell.importClinic.step3.${d.descKey}`)}</span>
              </span>
              <input
                id={inputId}
                type="checkbox"
                checked={isOn}
                onChange={() => onToggle(d.id)}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
