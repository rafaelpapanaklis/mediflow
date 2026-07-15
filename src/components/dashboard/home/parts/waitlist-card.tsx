// src/components/dashboard/home/parts/waitlist-card.tsx
"use client";
import { Plus } from "lucide-react";
import { HomeSection } from "../home-section";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { EmptyWaitlist } from "@/components/dashboard/empty-states";
import { formatRelative } from "@/lib/home/greet";
import type { WaitlistEntry } from "@/lib/home/types";
import { useT } from "@/i18n/i18n-provider";

interface Props {
  items: WaitlistEntry[];
  onAdd?: () => void;
}

export function WaitlistCard({ items, onAdd }: Props) {
  const t = useT();
  return (
    <HomeSection
      title={t("home.waitlist.title")}
      subtitle={
        items.length === 0
          ? t("home.waitlist.emptySubtitle")
          : t("home.waitlist.subtitle", { count: items.length })
      }
      action={
        <ButtonNew
          size="sm"
          variant="secondary"
          icon={<Plus size={14} strokeWidth={1.75} />}
          onClick={onAdd}
        >
          {t("common.add")}
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
                transition: "background var(--dur-1) var(--ease)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>
                  {it.patient.name}
                </div>
                {it.reason && (
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                    {it.reason}
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-3)",
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
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
