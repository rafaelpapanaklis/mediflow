"use client";
// Orthodontics — card del kanban. SPEC §6.3.

import Link from "next/link";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { OrthoKanbanCard } from "@/lib/types/orthodontics";
import { OrthoStageBadge } from "../shared/OrthoStageBadge";
import { PaymentStatusBadge } from "../payments/PaymentStatusBadge";

export function OrthoPatientCard({ card }: { card: OrthoKanbanCard }) {
  return (
    <Link
      href={`/dashboard/specialties/orthodontics/${card.patientId}`}
      style={{
        display: "block",
        padding: 12,
        background: "var(--bg-elev)",
        border:
          card.paymentStatus === "SEVERE_DELAY"
            ? "1px solid #F97316"
            : "1px solid var(--border)",
        borderRadius: 8,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "var(--brand-soft, rgba(99,102,241,0.18))",
            color: "var(--brand, #6366f1)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {initials(card.patientName)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.patientName}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            Mes {card.monthInTreatment} / {card.estimatedDurationMonths}
          </div>
        </div>
      </div>

      <div
        style={{
          height: 4,
          background: "var(--bg)",
          borderRadius: 2,
          marginBottom: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${card.progressPct}%`,
            height: "100%",
            background: "var(--brand, #6366f1)",
            transition: "width 200ms ease",
          }}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        <OrthoStageBadge phaseKey={card.currentPhaseKey} />
      </div>

      {card.nextAppointmentAt ? (
        <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>
          Próx: {card.nextAppointmentAt}
          {card.doctorName ? ` · ${card.doctorName}` : ""}
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <ComplianceIcon level={card.compliance.level} />
        <PaymentStatusBadge
          status={card.paymentStatus}
          amountOverdueMxn={card.amountOverdueMxn}
          daysOverdue={card.daysOverdue}
        />
      </div>
    </Link>
  );
}

function ComplianceIcon({
  level,
}: {
  level: OrthoKanbanCard["compliance"]["level"];
}) {
  if (level === "ok") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#22C55E" }}>
        <CheckCircle2 size={12} aria-hidden /> Compliance
      </span>
    );
  }
  if (level === "warning") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#F59E0B" }}>
        <AlertTriangle size={12} aria-hidden /> Compliance
      </span>
    );
  }
  if (level === "danger") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#EF4444" }}>
        <XCircle size={12} aria-hidden /> Riesgo drop
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, color: "var(--text-3)" }}>Compliance —</span>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}
