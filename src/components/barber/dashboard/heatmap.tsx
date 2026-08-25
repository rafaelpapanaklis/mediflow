import type { CSSProperties } from "react";
import type { ReportOccupancy } from "@/lib/barber/stats";
import { fmtHour } from "./format";

/** Lunes primero: así lee la semana una barbería. */
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Mapa de calor de visitas por hora × día de la semana. Una sola rampa
 * (caramelo) claro→oscuro; las celdas abiertas sin visitas van marcadas
 * aparte (son el hallazgo: ahí caben promociones). Cada celda lleva su
 * número y un title: el color nunca es el único canal.
 */
export function Heatmap({
  occ,
  weekdays,
  weekdaysLong,
  visitsLabel,
  closedLabel,
  deadLabel,
  lowLabel,
  highLabel,
}: {
  occ: ReportOccupancy;
  weekdays: string[];
  weekdaysLong: string[];
  visitsLabel: (n: number) => string;
  closedLabel: string;
  deadLabel: string;
  lowLabel: string;
  highLabel: string;
}) {
  const hours: number[] = [];
  for (let h = occ.hourFrom; h < occ.hourTo; h++) hours.push(h);
  const byKey = new Map(occ.cells.map((c) => [`${c.dow}:${c.hour}`, c.visits]));
  const dead = new Set(occ.deadSlots.map((d) => `${d.dow}:${d.hour}`));
  const isOpen = (dow: number, hour: number) => {
    const oh = occ.openHours[dow];
    return Boolean(oh && hour >= oh.from && hour < oh.to);
  };
  const level = (visits: number) =>
    occ.maxVisits <= 0 ? 1 : Math.min(5, Math.max(1, Math.ceil((visits / occ.maxVisits) * 5)));

  const style = { "--bdash-hours": hours.length } as CSSProperties;

  return (
    <div>
      <div className="bdash-heat-wrap">
        <div className="bdash-heat" style={style} role="table">
          <div />
          {hours.map((h) => (
            <div className="bdash-heat__hour" key={`h-${h}`} role="columnheader">
              {h}
            </div>
          ))}
          {ROW_ORDER.map((dow) => (
            <RowCells
              key={dow}
              dow={dow}
              hours={hours}
              label={weekdays[dow] ?? String(dow)}
              longLabel={weekdaysLong[dow] ?? String(dow)}
              byKey={byKey}
              dead={dead}
              isOpen={isOpen}
              level={level}
              visitsLabel={visitsLabel}
              closedLabel={closedLabel}
              deadLabel={deadLabel}
            />
          ))}
        </div>
      </div>
      <div className="bdash-heat-legend" aria-hidden>
        <span>{lowLabel}</span>
        <span className="bdash-heat-legend__ramp">
          {[1, 2, 3, 4, 5].map((l) => (
            <span key={l} className={`bdash-heat-legend__step bdash-heat__cell--l${l}`} />
          ))}
        </span>
        <span>{highLabel}</span>
        <span className="bdash-legend__key">
          <span className="bdash-heat-legend__step bdash-heat__cell--dead" /> {deadLabel}
        </span>
        <span className="bdash-legend__key">
          <span className="bdash-heat-legend__step bdash-heat__cell--closed" /> {closedLabel}
        </span>
      </div>
    </div>
  );
}

function RowCells({
  dow,
  hours,
  label,
  longLabel,
  byKey,
  dead,
  isOpen,
  level,
  visitsLabel,
  closedLabel,
  deadLabel,
}: {
  dow: number;
  hours: number[];
  label: string;
  longLabel: string;
  byKey: Map<string, number>;
  dead: Set<string>;
  isOpen: (dow: number, hour: number) => boolean;
  level: (visits: number) => number;
  visitsLabel: (n: number) => string;
  closedLabel: string;
  deadLabel: string;
}) {
  return (
    <>
      <div className="bdash-heat__label" role="rowheader">
        {label}
      </div>
      {hours.map((hour) => {
        const key = `${dow}:${hour}`;
        const visits = byKey.get(key) ?? 0;
        const isDead = dead.has(key);
        const open = isOpen(dow, hour);
        let cls = "bdash-heat__cell";
        let text = "";
        let title = `${longLabel} ${fmtHour(hour)} · `;
        if (visits > 0) {
          cls += ` bdash-heat__cell--l${level(visits)}`;
          text = String(visits);
          title += visitsLabel(visits);
        } else if (isDead) {
          cls += " bdash-heat__cell--dead";
          text = "0";
          title += deadLabel;
        } else if (!open) {
          cls += " bdash-heat__cell--closed";
          title += closedLabel;
        } else {
          title += visitsLabel(0);
        }
        return (
          <button type="button" key={key} className={cls} title={title} aria-label={title} role="cell" tabIndex={-1}>
            {text}
          </button>
        );
      })}
    </>
  );
}
