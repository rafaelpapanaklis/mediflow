"use client";
// Calendar visual del cumplimiento de elásticos para mostrar en
// /share/p/[token]. El paciente marca los días que usó elásticos. Estado
// persistido en localStorage por token (no PII, solo fechas locales).
// El doctor luego revisa el resumen mensual o registra manualmente la
// compliance vía la action `recordElasticsCompliance`.

import { useEffect, useMemo, useState } from "react";
import { Check, Smile } from "lucide-react";

export interface OrthoElasticsCalendarProps {
  /** Token del PatientShareLink, usado como key en localStorage. */
  token: string;
  /** Mes a mostrar (default: actual). */
  initialMonth?: Date;
}

interface MonthData {
  /** ISO date strings (YYYY-MM-DD) marcados como cumplidos. */
  daysCompleted: string[];
}

const STORAGE_PREFIX = "ortho-elastics:";

export function OrthoElasticsCalendar(props: OrthoElasticsCalendarProps) {
  const [month, setMonth] = useState(() => props.initialMonth ?? new Date());
  const [data, setData] = useState<MonthData>({ daysCompleted: [] });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${props.token}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MonthData;
        if (Array.isArray(parsed.daysCompleted)) setData(parsed);
      } catch {
        /* corrupto: ignora */
      }
    }
  }, [props.token]);

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

  const persist = (next: MonthData) => {
    setData(next);
    if (hydrated) {
      window.localStorage.setItem(
        `${STORAGE_PREFIX}${props.token}`,
        JSON.stringify(next),
      );
    }
  };

  const toggleDay = (iso: string) => {
    const set = new Set(data.daysCompleted);
    if (set.has(iso)) set.delete(iso);
    else set.add(iso);
    persist({ daysCompleted: Array.from(set).sort() });
  };

  const days = useMemo(() => buildMonthDays(month), [month]);
  const completedThisMonth = data.daysCompleted.filter((d) => d.startsWith(monthKey));
  const monthDays = days.filter((d) => d.iso.startsWith(monthKey));
  const compliance = monthDays.length > 0
    ? Math.round((completedThisMonth.length / monthDays.length) * 100)
    : 0;

  const todayIso = isoOf(new Date());

  const goPrev = () => {
    const next = new Date(month);
    next.setMonth(next.getMonth() - 1);
    setMonth(next);
  };
  const goNext = () => {
    const next = new Date(month);
    next.setMonth(next.getMonth() + 1);
    setMonth(next);
  };

  return (
    <section
      style={{
        background: "var(--surface-1, #ffffff)",
        border: "1px solid var(--border, #e5e5ed)",
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
      aria-label="Calendar de cumplimiento de elásticos"
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Mis elásticos</h2>
          <small style={{ fontSize: 12, color: "var(--text-2, #6b6b78)" }}>
            Marca los días que los usaste. ¡Tu doctor lo verá en tu próxima cita!
          </small>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={goPrev} style={navBtn} aria-label="Mes anterior">
            ←
          </button>
          <strong style={{ alignSelf: "center", fontSize: 13 }}>
            {month.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
          </strong>
          <button type="button" onClick={goNext} style={navBtn} aria-label="Mes siguiente">
            →
          </button>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          fontSize: 11,
        }}
      >
        {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
          <div
            key={d}
            style={{ textAlign: "center", color: "var(--text-2, #6b6b78)", padding: 4 }}
          >
            {d}
          </div>
        ))}
        {days.map((d) => {
          const isThisMonth = d.iso.startsWith(monthKey);
          const completed = data.daysCompleted.includes(d.iso);
          const isToday = d.iso === todayIso;
          const isFuture = d.iso > todayIso;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => !isFuture && toggleDay(d.iso)}
              disabled={isFuture}
              aria-pressed={completed}
              aria-label={`Día ${d.day}${completed ? " — cumplido" : ""}`}
              style={{
                aspectRatio: "1 / 1",
                borderRadius: 6,
                border: completed
                  ? "1px solid var(--success, #10b981)"
                  : "1px solid var(--border, #e5e5ed)",
                background: completed
                  ? "var(--success, #10b981)"
                  : isToday
                    ? "var(--brand-soft, rgba(99,102,241,0.10))"
                    : "transparent",
                color: completed
                  ? "white"
                  : isThisMonth
                    ? "var(--text-1, #14101f)"
                    : "var(--text-3, #9b9aa8)",
                fontSize: 12,
                cursor: isFuture ? "not-allowed" : "pointer",
                opacity: isFuture ? 0.4 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              {d.day}
              {completed ? (
                <Check
                  size={10}
                  aria-hidden
                  style={{ position: "absolute", top: 2, right: 2 }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: 10,
          borderRadius: 8,
          background: complianceBg(compliance),
          color: complianceColor(compliance),
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
        }}
      >
        <Smile size={16} aria-hidden />
        <span>
          Cumplimiento del mes: <strong>{compliance}%</strong>
          {compliance >= 80
            ? " — ¡Excelente! Vas por buen camino."
            : compliance >= 50
              ? " — Vas bien, ¡un esfuerzo más!"
              : " — Aún puedes recuperar el mes."}
        </span>
      </div>
    </section>
  );
}

function buildMonthDays(month: Date): Array<{ iso: string; day: number }> {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const last = new Date(year, m + 1, 0);
  const dayOfWeek = (first.getDay() + 6) % 7; // lunes = 0

  const days: Array<{ iso: string; day: number }> = [];

  // Padding inicial con días del mes anterior
  for (let i = dayOfWeek; i > 0; i--) {
    const d = new Date(year, m, 1 - i);
    days.push({ iso: isoOf(d), day: d.getDate() });
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const dt = new Date(year, m, d);
    days.push({ iso: isoOf(dt), day: d });
  }

  while (days.length % 7 !== 0) {
    const lastDate = new Date(year, m, last.getDate() + (days.length - dayOfWeek - last.getDate() + 1));
    days.push({ iso: isoOf(lastDate), day: lastDate.getDate() });
  }

  return days;
}

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function complianceBg(pct: number): string {
  if (pct >= 80) return "var(--success-soft, rgba(16,185,129,0.10))";
  if (pct >= 50) return "var(--brand-soft, rgba(99,102,241,0.10))";
  return "var(--warning-soft, rgba(245,158,11,0.12))";
}
function complianceColor(pct: number): string {
  if (pct >= 80) return "var(--success, #10b981)";
  if (pct >= 50) return "var(--brand, #6366f1)";
  return "var(--warning, #d97706)";
}

const navBtn: React.CSSProperties = {
  background: "var(--surface-2, #f5f5f7)",
  border: "1px solid var(--border, #e5e5ed)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 13,
  cursor: "pointer",
};
