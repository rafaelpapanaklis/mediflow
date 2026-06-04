"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Zap, Sun, Sunset, Moon } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import {
  buildOccupiedSlotSet,
} from "@/lib/agenda/overlap-client";
import {
  slotIndexToUtc,
  slotsPerDay,
  formatSlotTime,
  type ClinicTimeConfig,
} from "@/lib/agenda/time-utils";
import { buildOpenSlotSet } from "@/lib/agenda/resource-schedule";
import type {
  AgendaAppointmentDTO,
  DoctorColumnDTO,
  WeekScheduleDTO,
} from "@/lib/agenda/types";

interface Props {
  dateISO: string;
  doctorId: string;
  resourceId: string | null;
  durationMin: number;
  config: ClinicTimeConfig;
  doctors: DoctorColumnDTO[];
  value: string | null;
  onChange: (startsAtIso: string | null) => void;
  /**
   * Horario semanal del Resource seleccionado. `null` = recurso siempre
   * disponible (sin filtrar). `undefined` = aún cargando o sin recurso.
   */
  resourceSchedule?: WeekScheduleDTO | null;
  /** Agrupa los slots en Mañana / Tarde / Noche (rediseño popup Nueva cita). */
  grouped?: boolean;
}

interface FetchedDay {
  appointments: AgendaAppointmentDTO[];
  loaded: boolean;
}

export function SlotGridPicker({
  dateISO,
  doctorId,
  resourceId,
  durationMin,
  config,
  value,
  onChange,
  resourceSchedule,
  grouped = false,
}: Props) {
  const t = useT();
  const [day, setDay] = useState<FetchedDay>({ appointments: [], loaded: false });
  const [loading, setLoading] = useState(false);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!doctorId) return;
    setLoading(true);
    setDay({ appointments: [], loaded: false });
    fetch(`/api/appointments?date=${dateISO}&scope=clinic`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body && Array.isArray(body.appointments)) {
          setDay({ appointments: body.appointments, loaded: true });
        } else {
          setDay({ appointments: [], loaded: true });
        }
      })
      .catch(() => setDay({ appointments: [], loaded: true }))
      .finally(() => setLoading(false));
  }, [dateISO, doctorId]);

  const total = slotsPerDay(config);
  const dayStartUtcMs = useMemo(
    () => slotIndexToUtc(0, dateISO, config).getTime(),
    [dateISO, config],
  );
  const nowMs = Date.now();
  const slotsNeeded = Math.max(1, Math.ceil(durationMin / config.slotMinutes));

  const occupiedDoctor = useMemo(
    () =>
      buildOccupiedSlotSet(
        day.appointments,
        { doctorId },
        dayStartUtcMs,
        config.slotMinutes,
        total,
      ),
    [day.appointments, doctorId, dayStartUtcMs, config.slotMinutes, total],
  );

  const occupiedResource = useMemo(
    () =>
      resourceId
        ? buildOccupiedSlotSet(
            day.appointments,
            { resourceId },
            dayStartUtcMs,
            config.slotMinutes,
            total,
          )
        : new Set<number>(),
    [day.appointments, resourceId, dayStartUtcMs, config.slotMinutes, total],
  );

  // Slots inside the resource's open windows. `null` = no filtering needed
  // (resource has no schedule or no resource selected). Empty Set = resource
  // is configured but closed that day.
  const resourceOpenSlots = useMemo<Set<number> | null>(() => {
    if (!resourceId || resourceSchedule === undefined) return null;
    return buildOpenSlotSet(resourceSchedule, dateISO, config);
  }, [resourceId, resourceSchedule, dateISO, config]);

  const isSlotFree = (idx: number): boolean => {
    const slotUtcMs = dayStartUtcMs + idx * config.slotMinutes * 60_000;
    if (slotUtcMs <= nowMs) return false;
    for (let i = 0; i < slotsNeeded; i++) {
      const target = idx + i;
      if (target >= total) return false;
      if (occupiedDoctor.has(target)) return false;
      if (occupiedResource.has(target)) return false;
      if (resourceOpenSlots && !resourceOpenSlots.has(target)) return false;
    }
    return true;
  };

  const valueIdx = useMemo(() => {
    if (!value) return -1;
    const ms = new Date(value).getTime();
    return Math.round((ms - dayStartUtcMs) / 60_000 / config.slotMinutes);
  }, [value, dayStartUtcMs, config.slotMinutes]);

  // Cuando el slot llega pre-seleccionado (click en la agenda), scrollearlo
  // a la vista — el grid tiene maxHeight + overflow y el slot podria quedar
  // abajo del fold. block:"nearest" solo desplaza el contenedor del grid.
  useEffect(() => {
    if (valueIdx < 0) return;
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [valueIdx, day.loaded]);

  const firstFreeIdx = useMemo(() => {
    for (let i = 0; i < total; i++) {
      if (isSlotFree(i)) return i;
    }
    return -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, occupiedDoctor, occupiedResource, resourceOpenSlots, slotsNeeded]);

  const jumpToFirstFree = () => {
    if (firstFreeIdx < 0) return;
    const utc = slotIndexToUtc(firstFreeIdx, dateISO, config);
    onChange(utc.toISOString());
  };

  if (!doctorId) {
    return (
      <div style={emptyHintStyle}>
        {t("appointments.slotGrid.selectProfessional")}
      </div>
    );
  }

  const hourOf = (idx: number): number => {
    const utc = slotIndexToUtc(idx, dateISO, config);
    const label = formatSlotTime(utc.toISOString(), config.timezone);
    return parseInt(label.slice(0, 2), 10);
  };

  const renderSlot = (idx: number) => {
    const free = isSlotFree(idx);
    const occupied = !free;
    const selected = idx === valueIdx;
    const slotUtc = slotIndexToUtc(idx, dateISO, config);
    const label = formatSlotTime(slotUtc.toISOString(), config.timezone);

    return (
      <button
        key={idx}
        ref={selected ? selectedRef : undefined}
        type="button"
        role="gridcell"
        aria-selected={selected}
        aria-disabled={occupied}
        disabled={occupied}
        onClick={() => onChange(slotUtc.toISOString())}
        style={{
          ...slotBtnStyle,
          background: selected
            ? "var(--brand-soft)"
            : occupied
            ? "var(--bg-elev-2)"
            : "var(--bg-elev)",
          borderColor: selected ? "var(--border-brand)" : "var(--border-soft)",
          color: selected
            ? "var(--trial-accent-calm)"
            : occupied
            ? "var(--text-4)"
            : "var(--text-1)",
          cursor: occupied ? "not-allowed" : "pointer",
          opacity: occupied ? 0.55 : 1,
          boxShadow: selected ? "0 0 0 1px var(--border-brand) inset" : "none",
        }}
        onMouseEnter={(e) => {
          if (occupied || selected) return;
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.borderColor = "var(--border-brand)";
        }}
        onMouseLeave={(e) => {
          if (occupied || selected) return;
          e.currentTarget.style.background = "var(--bg-elev)";
          e.currentTarget.style.borderColor = "var(--border-soft)";
        }}
      >
        {label}
      </button>
    );
  };

  const header = (
    <div style={headerRowStyle}>
      <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {loading ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Loader2 size={11} className="animate-spin" />
            {t("common.loading")}
          </span>
        ) : (
          t("appointments.slotGrid.durationInfo", {
            slot: config.slotMinutes,
            duration: durationMin,
          })
        )}
      </div>
      {firstFreeIdx >= 0 && firstFreeIdx !== valueIdx && (
        <button type="button" onClick={jumpToFirstFree} style={quickJumpStyle}>
          <Zap size={11} aria-hidden />
          {t("appointments.slotGrid.firstFreeSlot", {
            time: formatSlotTime(slotIndexToUtc(firstFreeIdx, dateISO, config).toISOString(), config.timezone),
          })}
        </button>
      )}
    </div>
  );

  if (grouped) {
    const manana: number[] = [];
    const tarde: number[] = [];
    const noche: number[] = [];
    for (let idx = 0; idx < total; idx++) {
      const h = hourOf(idx);
      if (h < 13) manana.push(idx);
      else if (h < 18) tarde.push(idx);
      else noche.push(idx);
    }
    const groups: { key: string; labelKey: string; Icon: typeof Sun; idxs: number[] }[] = [
      { key: "manana", labelKey: "appointments.slotGrid.morning", Icon: Sun, idxs: manana },
      { key: "tarde", labelKey: "appointments.slotGrid.afternoon", Icon: Sunset, idxs: tarde },
      { key: "noche", labelKey: "appointments.slotGrid.evening", Icon: Moon, idxs: noche },
    ];
    return (
      <div>
        {header}
        <div style={groupedContainerStyle}>
          {groups.map((g) =>
            g.idxs.length === 0 ? null : (
              <div key={g.key} style={{ marginBottom: 10 }}>
                <div style={groupHeaderStyle}>
                  <g.Icon size={11} aria-hidden />
                  {t(g.labelKey)}
                  <span style={groupCountStyle}>
                    {t("appointments.slotGrid.freeCount", {
                      count: g.idxs.filter((i) => isSlotFree(i)).length,
                    })}
                  </span>
                </div>
                <div style={groupGridStyle} role="grid" aria-label={t("appointments.slotGrid.slotsGroupAria", { group: t(g.labelKey) })}>
                  {g.idxs.map(renderSlot)}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div style={gridStyle} role="grid" aria-label={t("appointments.slotGrid.slotsAvailableAria")}>
        {Array.from({ length: total }, (_, idx) => renderSlot(idx))}
      </div>
    </div>
  );
}

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 10,
  flexWrap: "wrap",
};

const quickJumpStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  background: "var(--brand-soft)",
  color: "var(--trial-accent-calm)",
  border: "1px solid var(--border-brand)",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
  gap: 6,
  maxHeight: 280,
  overflowY: "auto",
  padding: 4,
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  background: "var(--bg)",
};

const slotBtnStyle: React.CSSProperties = {
  height: 32,
  padding: "0 6px",
  border: "1px solid",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "var(--font-mono, monospace)",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 500,
  transition: "all 0.12s",
};

const emptyHintStyle: React.CSSProperties = {
  padding: 24,
  textAlign: "center",
  fontSize: 13,
  color: "var(--text-2)",
  background: "var(--bg-elev-2)",
  border: "1px dashed var(--border-soft)",
  borderRadius: 10,
};

const groupedContainerStyle: React.CSSProperties = {
  maxHeight: 320,
  overflowY: "auto",
  padding: 12,
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  background: "var(--bg)",
};

const groupHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 6,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const groupCountStyle: React.CSSProperties = {
  fontWeight: 400,
  textTransform: "none",
  letterSpacing: 0,
  marginLeft: 4,
  color: "var(--text-4)",
};

const groupGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
  gap: 4,
};
