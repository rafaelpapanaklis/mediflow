"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import {
  buildOccupiedSlotSet,
} from "@/lib/agenda/overlap-client";
import {
  slotIndexToUtc,
  slotsPerDay,
  formatSlotTime,
  type ClinicTimeConfig,
} from "@/lib/agenda/time-utils";
import type {
  AgendaAppointmentDTO,
  DoctorColumnDTO,
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
}: Props) {
  const [day, setDay] = useState<FetchedDay>({ appointments: [], loaded: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!doctorId) return;
    setLoading(true);
    setDay({ appointments: [], loaded: false });
    fetch(`/api/appointments?date=${dateISO}`, { credentials: "include" })
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

  const isSlotFree = (idx: number): boolean => {
    for (let i = 0; i < slotsNeeded; i++) {
      const target = idx + i;
      if (target >= total) return false;
      if (occupiedDoctor.has(target)) return false;
      if (occupiedResource.has(target)) return false;
    }
    return true;
  };

  const valueIdx = useMemo(() => {
    if (!value) return -1;
    const ms = new Date(value).getTime();
    return Math.round((ms - dayStartUtcMs) / 60_000 / config.slotMinutes);
  }, [value, dayStartUtcMs, config.slotMinutes]);

  const firstFreeIdx = useMemo(() => {
    for (let i = 0; i < total; i++) {
      if (isSlotFree(i)) return i;
    }
    return -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, occupiedDoctor, occupiedResource, slotsNeeded]);

  const jumpToFirstFree = () => {
    if (firstFreeIdx < 0) return;
    const utc = slotIndexToUtc(firstFreeIdx, dateISO, config);
    onChange(utc.toISOString());
  };

  if (!doctorId) {
    return (
      <div style={emptyHintStyle}>
        Selecciona un profesional para ver los horarios disponibles.
      </div>
    );
  }

  return (
    <div>
      <div style={headerRowStyle}>
        <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {loading ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Loader2 size={11} className="animate-spin" />
              Cargando...
            </span>
          ) : (
            `${config.slotMinutes} min · ${durationMin} min de duración`
          )}
        </div>
        {firstFreeIdx >= 0 && firstFreeIdx !== valueIdx && (
          <button
            type="button"
            onClick={jumpToFirstFree}
            style={quickJumpStyle}
          >
            <Zap size={11} aria-hidden />
            Primer slot libre: {formatSlotTime(slotIndexToUtc(firstFreeIdx, dateISO, config).toISOString(), config.timezone)}
          </button>
        )}
      </div>

      <div style={gridStyle} role="grid" aria-label="Slots disponibles">
        {Array.from({ length: total }).map((_, idx) => {
          const free = isSlotFree(idx);
          const occupied = !free;
          const selected = idx === valueIdx;
          const slotUtc = slotIndexToUtc(idx, dateISO, config);
          const label = formatSlotTime(slotUtc.toISOString(), config.timezone);

          return (
            <button
              key={idx}
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
                borderColor: selected
                  ? "var(--border-brand)"
                  : "var(--border-soft)",
                color: selected
                  ? "var(--trial-accent-calm)"
                  : occupied
                  ? "var(--text-4)"
                  : "var(--text-1)",
                cursor: occupied ? "not-allowed" : "pointer",
                opacity: occupied ? 0.55 : 1,
                boxShadow: selected
                  ? "0 0 0 1px var(--border-brand) inset"
                  : "none",
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
        })}
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
  fontFamily: "var(--font-jetbrains-mono, monospace)",
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
