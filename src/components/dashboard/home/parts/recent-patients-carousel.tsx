// src/components/dashboard/home/parts/recent-patients-carousel.tsx
"use client";
import Link from "next/link";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { formatRelative } from "@/lib/home/greet";
import type { HomeDoctorData } from "@/lib/home/types";

type Patient = HomeDoctorData["recentPatients"][number];

export function RecentPatientsCarousel({ patients }: { patients: Patient[] }) {
  if (patients.length === 0) return null;

  return (
    <div
      role="list"
      aria-label="Pacientes recientes"
      className="scrollbar-thin"
      style={{
        display: "flex",
        gap: 10,
        overflowX: "auto",
        overflowY: "hidden",
        padding: "2px 2px 14px",
        scrollSnapType: "x proximity",
      }}
    >
      {patients.map((p) => (
        <Link
          key={p.id}
          role="listitem"
          href={`/dashboard/patients/${p.id}`}
          style={{
            flex: "0 0 140px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 12,
            padding: "14px 12px",
            textDecoration: "none",
            color: "inherit",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            scrollSnapAlign: "start",
            transition: "border-color 0.15s, background 0.15s",
            textAlign: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--border-brand)";
            e.currentTarget.style.background = "var(--bg-elev-2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-soft)";
            e.currentTarget.style.background = "var(--bg-elev)";
          }}
        >
          <AvatarNew name={p.name} size="lg" />
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
              lineHeight: 1.3,
            }}
          >
            {p.name}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-2)" }}>
            {formatRelative(p.lastVisitAt)}
          </div>
        </Link>
      ))}
    </div>
  );
}
