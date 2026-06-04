"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { useAgenda } from "./agenda-provider";
import { todayInTz, getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";

function shiftDay(dayISO: string, timezone: string, deltaDays: number): string {
  const utc = tzLocalToUtc(dayISO, 12, 0, timezone);
  const next = new Date(utc.getTime() + deltaDays * 86_400_000);
  const p = getTzParts(next, timezone);
  return `${p.year}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

function formatHumanDate(dayISO: string, timezone: string, t: TFunction): string {
  const today = todayInTz(timezone);
  const tomorrow = shiftDay(today, timezone, 1);
  const yesterday = shiftDay(today, timezone, -1);

  if (dayISO === today) return t("agenda.dayNav.today");
  if (dayISO === tomorrow) return t("agenda.dayNav.tomorrow");
  if (dayISO === yesterday) return t("agenda.dayNav.yesterday");

  const utc = tzLocalToUtc(dayISO, 12, 0, timezone);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(utc)
    .replace(/\./g, "")
    .replace(/^./, (c) => c.toUpperCase());
}

export function AgendaDayNav() {
  const t = useT();
  const { state, setDay } = useAgenda();
  const today = todayInTz(state.timezone);
  const isToday = state.dayISO === today;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={() => setDay(shiftDay(state.dayISO, state.timezone, -1))}
        aria-label={t("agenda.dayNav.prevDay")}
        style={navBtnStyle}
      >
        <ChevronLeft size={14} />
      </button>
      <div
        style={{
          minWidth: 110,
          textAlign: "center",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-1)",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
        }}
      >
        {formatHumanDate(state.dayISO, state.timezone, t)}
      </div>
      <button
        type="button"
        onClick={() => setDay(shiftDay(state.dayISO, state.timezone, 1))}
        aria-label={t("agenda.dayNav.nextDay")}
        style={navBtnStyle}
      >
        <ChevronRight size={14} />
      </button>
      {!isToday && (
        <ButtonNew
          variant="ghost"
          size="sm"
          onClick={() => setDay(today)}
          style={{ marginLeft: 4 }}
        >
          {t("agenda.dayNav.today")}
        </ButtonNew>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 7,
  color: "var(--text-2)",
  cursor: "pointer",
  transition: "all 0.12s",
};
