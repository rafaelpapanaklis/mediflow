"use client";

import { ChevronLeft, ChevronRight, CalendarPlus, Search } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useAgenda } from "./agenda-provider";
import { AgendaFilterPills } from "./agenda-filter-pills";
import { DateField } from "@/components/ui/date-field";
import { todayInTz, getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import type { AgendaViewMode } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const VIEW_TABS: Array<{ value: AgendaViewMode; labelKey: string }> = [
  { value: "day",   labelKey: "agenda.topbar.viewDay" },
  { value: "week",  labelKey: "agenda.topbar.viewWeek" },
  { value: "month", labelKey: "agenda.topbar.viewMonth" },
  { value: "list",  labelKey: "agenda.topbar.viewList" },
];

function shiftDay(dayISO: string, timezone: string, deltaDays: number): string {
  const utc = tzLocalToUtc(dayISO, 12, 0, timezone);
  const next = new Date(utc.getTime() + deltaDays * 86_400_000);
  const p = getTzParts(next, timezone);
  return `${p.year}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

function formatHumanDate(
  dayISO: string,
  timezone: string,
  t: ReturnType<typeof useT>,
): string {
  const today = todayInTz(timezone);
  const tomorrow = shiftDay(today, timezone, 1);
  const yesterday = shiftDay(today, timezone, -1);
  if (dayISO === today) return t("agenda.topbar.today");
  if (dayISO === tomorrow) return t("agenda.topbar.tomorrow");
  if (dayISO === yesterday) return t("agenda.topbar.yesterday");
  const utc = tzLocalToUtc(dayISO, 12, 0, timezone);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(utc)
    .replace(/\./g, "")
    .replace(/^./, (c) => c.toUpperCase());
}

export function AgendaTopbar() {
  const t = useT();
  const { state, setDay, setViewMode, setSearchQuery, prefetchView } = useAgenda();
  const { open: openNew } = useNewAppointmentDialog();

  const today = todayInTz(state.timezone);
  const isToday = state.dayISO === today;

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <span style={{
          width: 22, height: 22,
          display: "grid", placeItems: "center",
          background: "linear-gradient(135deg, var(--brand) 0%, #a855f7 100%)",
          borderRadius: 5,
          color: "#fff", fontSize: 10, fontWeight: 800,
        }}>M</span>
        <span>DaleControl</span>
      </div>

      <div className={styles.viewTabs} role="tablist" aria-label={t("agenda.topbar.viewTabsLabel")}>
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={state.viewMode === tab.value}
            className={`${styles.viewTab} ${state.viewMode === tab.value ? styles.active : ""}`}
            onClick={() => setViewMode(tab.value)}
            onMouseEnter={() => state.viewMode !== tab.value && prefetchView(tab.value)}
            onFocus={() => state.viewMode !== tab.value && prefetchView(tab.value)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className={styles.dateNav}>
        <button
          type="button"
          className={styles.dateNavBtn}
          onClick={() => setDay(shiftDay(state.dayISO, state.timezone, -1))}
          aria-label={t("agenda.topbar.prevDay")}
        >
          <ChevronLeft size={14} />
        </button>
        <span className={styles.dateLabel}>{formatHumanDate(state.dayISO, state.timezone, t)}</span>
        <button
          type="button"
          className={styles.dateNavBtn}
          onClick={() => setDay(shiftDay(state.dayISO, state.timezone, 1))}
          aria-label={t("agenda.topbar.nextDay")}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      {!isToday && (
        <button type="button" className={styles.todayBtn} onClick={() => setDay(today)}>
          {t("agenda.topbar.today")}
        </button>
      )}
      <DateField
        className={styles.datePicker}
        value={state.dayISO}
        onChange={(e) => e.target.value && setDay(e.target.value)}
      />

      <div className={styles.topbarSpacer} />

      <AgendaFilterPills />

      <div className={styles.searchWrap}>
        <Search size={11} aria-hidden className={styles.searchIcon} />
        <input
          type="search"
          className={styles.searchBox}
          placeholder={t("agenda.topbar.searchPlaceholder")}
          value={state.searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <button
        type="button"
        onClick={() => openNew({})}
        className={styles.newApptBtn}
      >
        <CalendarPlus size={13} /> {t("agenda.topbar.newAppointment")}
      </button>
    </header>
  );
}
