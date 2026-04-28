// src/components/dashboard/home/parts/waitlist-card.tsx
"use client";
import { Plus } from "lucide-react";
import { HomeSection } from "../home-section";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { EmptyWaitlist } from "@/components/dashboard/empty-states";
import { formatRelative } from "@/lib/home/greet";
import type { WaitlistEntry } from "@/lib/home/types";

interface Props {
  items: WaitlistEntry[];
  onAdd?: () => void;
}

export function WaitlistCard({ items, onAdd }: Props) {
  return (
    <HomeSection
      title="Lista de espera"
      subtitle={
        items.length === 0
          ? "Sin pacientes en espera"
          : `${items.length} paciente${items.length === 1 ? "" : "s"} esperando un hueco`
      }
      action={
        <ButtonNew
          size="sm"
          variant="secondary"
          icon={<Plus size={12} />}
          onClick={onAdd}
        >
          Agregar
        </ButtonNew>
      }
      noPad
    >
      {items.length === 0 ? (
        <EmptyWaitlist size="sm" onAdd={onAdd} />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((it) => (
            <li
              key={it.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "11px 18px",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
                  {it.patient.name}
                </div>
                {it.reason && (
                  <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
                    {it.reason}
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-3)",
                  flexShrink: 0,
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                }}
              >
                {formatRelative(it.since)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}
