"use client";

import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import type { AgendaColumnDescriptor } from "@/app/dashboard/agenda/agenda-page-client";
import styles from "./agenda.module.css";

export function AgendaColumnHeader({ column }: { column: AgendaColumnDescriptor }) {
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
            style={{ background: accent ?? "var(--brand)" }}
            aria-hidden
          >
            {doctorInitials(column.title)}
          </div>
        )}
        <div className={styles.columnHeaderText}>
          <div className={styles.columnHeaderTitle}>{column.title}</div>
          {column.subtitle && (
            <div className={styles.columnHeaderSub}>{column.subtitle}</div>
          )}
        </div>
      </div>
      {column.type !== "unified" && (
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
