"use client";

import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import type { AgendaColumnDescriptor } from "@/app/dashboard/agenda/agenda-page-client";
import styles from "./agenda.module.css";

export function AgendaColumnHeader({ column }: { column: AgendaColumnDescriptor }) {
  return (
    <div className={styles.columnHeader}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {column.type === "doctor" && (
          <AvatarNew name={column.title} size="sm" />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
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
