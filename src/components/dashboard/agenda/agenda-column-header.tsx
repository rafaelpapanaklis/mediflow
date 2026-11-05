"use client";

import { doctorColorFor, doctorInitials, readableTextOn } from "@/lib/agenda/doctor-color";
import { INICIALES_SIN_DOCTOR } from "@/lib/agenda/doctor-legend";
import { useT } from "@/i18n/i18n-provider";
import type { AgendaColumnDescriptor } from "@/app/dashboard/agenda/agenda-page-client";
import styles from "./agenda.module.css";

export function AgendaColumnHeader({ column }: { column: AgendaColumnDescriptor }) {
  const t = useT();
  // ws1-t11 — la columna «Sin doctor»: color gris del tema (viene en `column.color`), «—» en el chip
  // y «N citas» en vez del % (varias «Sin doctor» a la misma hora no se estorban).
  const accent =
    column.type === "doctor" && column.doctorId
      ? doctorColorFor(column.doctorId, column.color)
      : column.color ?? null;

  return (
    <div
      className={styles.columnHeader}
      style={accent ? ({ "--mf-occ-color": accent } as React.CSSProperties) : undefined}
    >
      <div className={styles.columnHeaderRow}>
        {column.type === "doctor" && (
          <div
            className={styles.columnHeaderAvatar}
            style={{
              background: accent ?? "var(--brand)",
              // users.color es libre: negro o blanco según luminancia.
              color: readableTextOn(accent ?? ""),
            }}
            aria-hidden
          >
            {column.sinDoctor ? INICIALES_SIN_DOCTOR : doctorInitials(column.title)}
          </div>
        )}
        <div className={styles.columnHeaderText}>
          <div className={styles.columnHeaderTitle}>{column.title}</div>
          {column.subtitle && (
            <div className={styles.columnHeaderSub}>{column.subtitle}</div>
          )}
        </div>
      </div>
      {column.sinDoctor ? (
        <div className={styles.columnHeaderOccupancy}>
          <span className={styles.columnHeaderPct}>
            {t("agenda.monthView.apptCount", { count: column.citas ?? 0 })}
          </span>
        </div>
      ) : column.type !== "unified" && (
        <div className={styles.columnHeaderOccupancy}>
          <div className={styles.columnHeaderBar}>
            <div
              className={styles.columnHeaderBarFill}
              style={{ width: `${column.occupancyPct}%` }}
            />
          </div>
          <span className={styles.columnHeaderPct}>{column.occupancyPct}%</span>
        </div>
      )}
    </div>
  );
}
