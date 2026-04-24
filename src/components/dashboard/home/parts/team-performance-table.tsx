// src/components/dashboard/home/parts/team-performance-table.tsx
"use client";
import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import type { HomeAdminTeamRow } from "@/lib/home/types";

type SortKey = "doctorName" | "appointments" | "completionPct" | "revenueMXN";
type SortDir = "asc" | "desc";

const mxn = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

export function TeamPerformanceTable({ rows }: { rows: HomeAdminTeamRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("revenueMXN");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv, "es-MX");
      } else {
        cmp = (av as number) - (bv as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "doctorName" ? "asc" : "desc");
    }
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table-new">
        <thead>
          <tr>
            <SortableTh
              label="Doctor"
              sortKey="doctorName"
              active={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="left"
            />
            <SortableTh
              label="Citas"
              sortKey="appointments"
              active={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
            <SortableTh
              label="% Completadas"
              sortKey="completionPct"
              active={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
            <SortableTh
              label="Ingresos"
              sortKey="revenueMXN"
              active={sortKey}
              dir={sortDir}
              onClick={toggleSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.userId}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <AvatarNew name={r.doctorName} size="sm" />
                  <span style={{ fontWeight: 500 }}>{r.doctorName}</span>
                </div>
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {r.appointments}
              </td>
              <td style={{ textAlign: "right" }}>
                <CompletionCell pct={r.completionPct} />
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {mxn.format(r.revenueMXN)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align: "left" | "right";
}) {
  const isActive = active === sortKey;
  const Icon = isActive
    ? dir === "asc"
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown;
  return (
    <th
      scope="col"
      style={{
        textAlign: align,
        cursor: "pointer",
        userSelect: "none",
      }}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "transparent",
          border: "none",
          padding: 0,
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          textTransform: "inherit",
          letterSpacing: "inherit",
          flexDirection: align === "right" ? "row-reverse" : "row",
        }}
      >
        {label}
        <Icon
          size={11}
          style={{ color: isActive ? "var(--brand)" : "var(--text-3)" }}
          aria-hidden
        />
      </button>
    </th>
  );
}

function CompletionCell({ pct }: { pct: number }) {
  let color = "var(--text-1)";
  if (pct < 75) color = "var(--trial-accent-warning)";
  if (pct < 60) color = "var(--trial-accent-danger)";
  if (pct >= 90) color = "var(--success)";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "flex-end",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 48,
          height: 5,
          borderRadius: 3,
          background: "var(--bg-elev-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            transition: "width 0.3s",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-jetbrains-mono, monospace)",
          fontSize: 12,
          fontWeight: 500,
          color,
          minWidth: 36,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}
