"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronLeft, ChevronRight, CalendarPlus, Search, ListChecks, ChevronDown, Check, Users, Armchair } from "lucide-react";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useAgenda } from "./agenda-provider";
import { todayInTz, getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import type { AgendaViewMode } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

/** Tabs primarios visibles (audit ajuste 5: Mes/Lista al dropdown). */
const PRIMARY_VIEW_TABS: Array<{ value: AgendaViewMode; label: string }> = [
  { value: "day",   label: "Día" },
  { value: "week",  label: "Semana" },
];

const SECONDARY_VIEW_TABS: Array<{ value: AgendaViewMode; label: string }> = [
  { value: "month", label: "Mes" },
  { value: "list",  label: "Lista" },
];

function shiftDay(dayISO: string, timezone: string, deltaDays: number): string {
  const utc = tzLocalToUtc(dayISO, 12, 0, timezone);
  const next = new Date(utc.getTime() + deltaDays * 86_400_000);
  const p = getTzParts(next, timezone);
  return `${p.year}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

function formatHumanDate(dayISO: string, timezone: string): string {
  const today = todayInTz(timezone);
  const tomorrow = shiftDay(today, timezone, 1);
  const yesterday = shiftDay(today, timezone, -1);
  if (dayISO === today) return "Hoy";
  if (dayISO === tomorrow) return "Mañana";
  if (dayISO === yesterday) return "Ayer";
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
  const { state, setDay, setViewMode, setSearchQuery, toggleWaitlist, openModal } = useAgenda();
  const { open: openNew } = useNewAppointmentDialog();
  const [moreViewsOpen, setMoreViewsOpen] = useState(false);

  const today = todayInTz(state.timezone);
  const isToday = state.dayISO === today;
  const doctorCount = state.doctors.filter((d) => d.activeInAgenda).length;
  const resourceCount = state.resources.length;
  const filtersActive =
    state.filters.doctorIds.length +
    state.filters.resourceIds.length +
    state.filters.statuses.length;

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
        <span>MediFlow</span>
      </div>

      <div className={styles.viewTabs} role="tablist" aria-label="Vista de agenda">
        {PRIMARY_VIEW_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={state.viewMode === t.value}
            className={`${styles.viewTab} ${state.viewMode === t.value ? styles.active : ""}`}
            onClick={() => setViewMode(t.value)}
          >
            {t.label}
          </button>
        ))}
        <Popover.Root open={moreViewsOpen} onOpenChange={setMoreViewsOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={`${styles.viewTab} ${SECONDARY_VIEW_TABS.some((s) => s.value === state.viewMode) ? styles.active : ""}`}
              aria-haspopup="menu"
              aria-expanded={moreViewsOpen}
            >
              {SECONDARY_VIEW_TABS.find((s) => s.value === state.viewMode)?.label ?? "Más vistas"}
              <ChevronDown size={11} aria-hidden style={{ marginLeft: 3 }} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className={styles.moreViewsPopover}
            >
              {SECONDARY_VIEW_TABS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`${styles.moreViewsItem} ${state.viewMode === t.value ? styles.active : ""}`}
                  onClick={() => {
                    setViewMode(t.value);
                    setMoreViewsOpen(false);
                  }}
                >
                  {state.viewMode === t.value && <Check size={11} aria-hidden />}
                  <span>{t.label}</span>
                </button>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className={styles.dateNav}>
        <button
          type="button"
          className={styles.dateNavBtn}
          onClick={() => setDay(shiftDay(state.dayISO, state.timezone, -1))}
          aria-label="Día anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <span className={styles.dateLabel}>{formatHumanDate(state.dayISO, state.timezone)}</span>
        <button
          type="button"
          className={styles.dateNavBtn}
          onClick={() => setDay(shiftDay(state.dayISO, state.timezone, 1))}
          aria-label="Día siguiente"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      {!isToday && (
        <button type="button" className={styles.todayBtn} onClick={() => setDay(today)}>
          Hoy
        </button>
      )}
      <input
        type="date"
        className={styles.datePicker}
        value={state.dayISO}
        onChange={(e) => e.target.value && setDay(e.target.value)}
      />

      <div className={styles.topbarSpacer} />

      <div className={styles.filtersRow}>
        <button type="button" className={styles.filterPill}>
          Doctores <span className={styles.filterPillCount}>{doctorCount}</span> ▾
        </button>
        <button type="button" className={styles.filterPill}>
          Sillones <span className={styles.filterPillCount}>{resourceCount}</span> ▾
        </button>
        <button type="button" className={styles.filterPill}>
          Estado{filtersActive > 0 ? <span className={styles.filterPillCount}>{filtersActive}</span> : null} ▾
        </button>
      </div>

      <div className={styles.searchWrap}>
        <Search size={11} aria-hidden className={styles.searchIcon} />
        <input
          type="search"
          className={styles.searchBox}
          placeholder="Buscar paciente…"
          value={state.searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <button
        type="button"
        onClick={() => toggleWaitlist()}
        className={`${styles.waitlistToggleBtn} ${state.waitlistOpen ? styles.active : ""}`}
        aria-label="Lista de espera"
        aria-pressed={state.waitlistOpen}
        title="Lista de espera"
      >
        <ListChecks size={14} />
        {state.waitlistCount > 0 && (
          <span className={styles.waitlistToggleCount}>{state.waitlistCount}</span>
        )}
      </button>

      <button
        type="button"
        onClick={() => openModal("team")}
        className={styles.iconBtn}
        aria-label="Gestionar equipo"
        title="Equipo"
      >
        <Users size={14} />
      </button>

      <button
        type="button"
        onClick={() => openModal("resources")}
        className={styles.iconBtn}
        aria-label="Gestionar sillones / salas / equipos"
        title="Recursos"
      >
        <Armchair size={14} />
      </button>

      <button
        type="button"
        onClick={() => openNew({})}
        className={styles.newApptBtn}
      >
        <CalendarPlus size={13} /> Nueva cita
      </button>
    </header>
  );
}
