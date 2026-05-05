"use client";
// Orthodontics — board del kanban. 6 columnas + filtros. SPEC §6.2.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { OrthoKanbanCard } from "@/lib/types/orthodontics";
import type { OrthoPhaseKey } from "@prisma/client";
import { PHASE_ORDER } from "@/lib/orthodontics/phase-machine";
import { groupCardsByPhase } from "@/lib/orthodontics/kanban-helpers";
import { OrthoKanbanColumn } from "./OrthoKanbanColumn";
import { PaymentDelayWidget } from "./PaymentDelayWidget";

type ComplianceFilter = "all" | "ok" | "warning" | "danger";
type PaymentFilter = "all" | "ON_TIME" | "LIGHT_DELAY" | "SEVERE_DELAY";

export function OrthoKanbanBoard({ cards }: { cards: OrthoKanbanCard[] }) {
  const [query, setQuery] = useState("");
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (query && !c.patientName.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      if (complianceFilter !== "all" && c.compliance.level !== complianceFilter) {
        return false;
      }
      if (paymentFilter !== "all" && c.paymentStatus !== paymentFilter) {
        return false;
      }
      return true;
    });
  }, [cards, query, complianceFilter, paymentFilter]);

  const grouped = useMemo(() => groupCardsByPhase(filtered), [filtered]);

  const summary = useMemo(() => {
    const onTime = cards.filter((c) => c.paymentStatus === "ON_TIME").length;
    const light = cards.filter((c) => c.paymentStatus === "LIGHT_DELAY").length;
    const severe = cards.filter((c) => c.paymentStatus === "SEVERE_DELAY").length;
    const totalOverdue = cards.reduce((sum, c) => sum + (c.amountOverdueMxn ?? 0), 0);
    return {
      totalActivePlans: cards.length,
      onTimeCount: onTime,
      lightDelayCount: light,
      severeDelayCount: severe,
      totalOverdueMxn: totalOverdue,
    };
  }, [cards]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <PaymentDelayWidget summary={summary} />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "10px 12px",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search
            size={14}
            aria-hidden
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-3)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre…"
            style={{
              width: "100%",
              padding: "6px 10px 6px 30px",
              background: "var(--bg)",
              color: "var(--text-1)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 12,
            }}
          />
        </div>

        <select
          value={complianceFilter}
          onChange={(e) => setComplianceFilter(e.target.value as ComplianceFilter)}
          style={selectStyle}
        >
          <option value="all">Compliance: todos</option>
          <option value="ok">Compliance ✓</option>
          <option value="warning">Compliance ⚠</option>
          <option value="danger">Compliance ✗ (drop)</option>
        </select>

        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
          style={selectStyle}
        >
          <option value="all">Pagos: todos</option>
          <option value="ON_TIME">Al corriente</option>
          <option value="LIGHT_DELAY">Atraso leve</option>
          <option value="SEVERE_DELAY">Atraso severo</option>
        </select>

        <span style={{ alignSelf: "center", fontSize: 11, color: "var(--text-3)" }}>
          {filtered.length} de {cards.length}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {PHASE_ORDER.map((phaseKey) => {
          const group = grouped.get(phaseKey)!;
          return (
            <OrthoKanbanColumn
              key={phaseKey}
              phaseKey={phaseKey as OrthoPhaseKey}
              cards={group.cards}
              totalCount={group.totalCount}
              truncatedCount={group.truncatedCount}
            />
          );
        })}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  background: "var(--bg)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
};
