"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (iso: string) => void;
  todayISO: string; // YYYY-MM-DD en la zona horaria de la clínica
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
// Encabezado de columnas, lunes-primero.
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

// El value/onChange viaja como string YYYY-MM-DD (día de calendario en la
// zona de la clínica). Para la grilla construimos Dates LOCALES desde las
// partes (new Date(y, m-1, d)) y serializamos con getters locales — así
// getDay()/getMonth()/getDate() son consistentes y no hay corrimiento por
// zona horaria (el bug clásico de new Date("YYYY-MM-DD") interpretado UTC).
function parts(iso: string): number[] {
  return iso.split("-").map(Number);
}
function parseLocal(iso: string): Date {
  const [y, m, d] = parts(iso);
  return new Date(y, m - 1, d);
}
function toISOLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function diffDays(aISO: string, bISO: string): number {
  const [ay, am, ad] = parts(aISO);
  const [by, bm, bd] = parts(bISO);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}
function formatLong(iso: string): string {
  const [y, m, d] = parts(iso);
  const dow = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${d} ${MONTH_ABBR[m - 1]} ${y}`;
}
function relativeLabel(iso: string, todayISO: string): string {
  const dd = diffDays(iso, todayISO);
  if (dd === 0) return "Hoy";
  if (dd === 1) return "Mañana";
  if (dd === -1) return "Ayer";
  if (dd > 0 && dd < 7) return `En ${dd} días`;
  if (dd > 0) return `En ${Math.round(dd / 7)} sem.`;
  return `Hace ${Math.abs(dd)} días`;
}

/**
 * Selector de fecha del rediseño: botón con fecha larga + etiqueta relativa,
 * y popover (Radix → portal, no lo recorta el overflow del modal) con un
 * calendario mensual completo (340px, lunes-primero, 6 semanas siempre,
 * vista de selector de año, bloqueo de fechas pasadas).
 */
export function DateDropdown({ value, onChange, todayISO }: Props) {
  const [open, setOpen] = useState(false);
  const safeValue = value || todayISO;

  const select = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" style={triggerStyle(open)}>
          <Calendar size={15} aria-hidden style={{ color: "var(--brand)", flexShrink: 0 }} />
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.3, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{formatLong(safeValue)}</span>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>{relativeLabel(safeValue, todayISO)}</span>
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            style={{ color: "var(--text-4)", flexShrink: 0, transition: "transform 0.12s", transform: open ? "rotate(180deg)" : "none" }}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle}>
          <CalendarPopover value={safeValue} todayISO={todayISO} onSelect={select} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CalendarPopover({
  value,
  todayISO,
  onSelect,
}: {
  value: string;
  todayISO: string;
  onSelect: (iso: string) => void;
}) {
  const today = parseLocal(todayISO);
  // view = primer día del mes mostrado. Arranca en el mes del value.
  const [view, setView] = useState<Date>(() => {
    const d = parseLocal(value || todayISO);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [yearOpen, setYearOpen] = useState(false);

  // 42 celdas SIEMPRE (6 semanas × 7) para evitar saltos de altura.
  const cells = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const firstDow = new Date(y, m, 1).getDay(); // 0=Dom..6=Sáb
    const lead = (firstDow + 6) % 7; // días desde el lunes
    const start = new Date(y, m, 1 - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const prevMonth = () => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1));
  const nextMonth = () => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1));
  const goToday = () => {
    setView(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelect(todayISO);
  };

  const years: number[] = [];
  for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 5; y++) years.push(y);

  return (
    <div>
      {/* Header: ← [Mes Año] → */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 10 }}>
        <button type="button" onClick={prevMonth} aria-label="Mes anterior" style={navBtnStyle} onMouseEnter={hoverBg} onMouseLeave={clearBg}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setYearOpen((o) => !o)}
          style={monthLabelStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {MONTHS_LONG[view.getMonth()]} {view.getFullYear()}
          <ChevronDown size={13} aria-hidden style={{ transition: "transform 0.12s", transform: yearOpen ? "rotate(180deg)" : "none" }} />
        </button>
        <button type="button" onClick={nextMonth} aria-label="Mes siguiente" style={navBtnStyle} onMouseEnter={hoverBg} onMouseLeave={clearBg}>
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      {yearOpen ? (
        /* Vista de selector de año: grilla 3 columnas, today.year-1 .. +5 */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "4px 0 6px" }}>
          {years.map((y) => {
            const isCur = y === view.getFullYear();
            return (
              <button
                key={y}
                type="button"
                onClick={() => { setView(new Date(y, view.getMonth(), 1)); setYearOpen(false); }}
                style={{
                  padding: "10px 0",
                  borderRadius: 8,
                  border: `1px solid ${isCur ? "var(--violet-600)" : "var(--border-soft)"}`,
                  background: isCur ? "var(--violet-600)" : "transparent",
                  color: isCur ? "#fff" : "var(--text-1)",
                  fontSize: 13,
                  fontWeight: isCur ? 600 : 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { if (!isCur) e.currentTarget.style.background = "var(--violet-50)"; }}
                onMouseLeave={(e) => { if (!isCur) e.currentTarget.style.background = "transparent"; }}
              >
                {y}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          {/* Encabezado de días (lunes-primero) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w, i) => (
              <div
                key={w + i}
                style={{ textAlign: "center", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: i >= 5 ? "var(--text-4)" : "var(--text-3)", padding: "4px 0" }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Grilla de 42 días */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              const cellISO = toISOLocal(d);
              const inMonth = d.getMonth() === view.getMonth();
              const dow = d.getDay();
              const isWeekend = dow === 0 || dow === 6;
              const isToday = cellISO === todayISO;
              const isSel = cellISO === value;
              const past = cellISO < todayISO; // comparación lexicográfica = cronológica en YYYY-MM-DD

              return (
                <button
                  key={i}
                  type="button"
                  disabled={past}
                  aria-label={cellISO}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => { if (!past) onSelect(cellISO); }}
                  style={{
                    position: "relative",
                    aspectRatio: "1 / 1",
                    border: "1px solid transparent",
                    borderRadius: 8,
                    background: isSel ? "var(--violet-600)" : "transparent",
                    color: isSel
                      ? "#fff"
                      : past
                      ? "var(--text-4)"
                      : !inMonth
                      ? "var(--text-4)"
                      : isWeekend
                      ? "var(--text-3)"
                      : "var(--text-1)",
                    opacity: past ? 0.45 : !inMonth ? 0.55 : 1,
                    fontSize: 13,
                    fontWeight: isSel || isToday ? 600 : 500,
                    cursor: past ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    boxShadow: isSel ? "0 2px 6px -2px rgba(124,58,237,.5)" : "none",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { if (!isSel && !past) e.currentTarget.style.background = "var(--violet-50)"; }}
                  onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                >
                  {d.getDate()}
                  {isToday && !isSel && (
                    <span aria-hidden style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: 99, background: "var(--violet-600)" }} />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Footer: [Hoy]  fecha seleccionada larga */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
        <button
          type="button"
          onClick={goToday}
          style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border-soft)", background: "var(--bg-elev)", color: "var(--text-1)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-elev)"; }}
        >
          Hoy
        </button>
        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{formatLong(value)}</div>
      </div>
    </div>
  );
}

function hoverBg(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "var(--bg-hover)";
}
function clearBg(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "transparent";
}

function triggerStyle(open: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    height: 44,
    padding: "0 12px",
    border: `1px solid ${open ? "var(--border-brand)" : "var(--border-soft)"}`,
    borderRadius: 10,
    background: "var(--bg-elev)",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "border-color 0.12s",
  };
}

const popoverStyle: React.CSSProperties = {
  width: 340,
  maxWidth: "calc(100vw - 32px)",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 14,
  boxShadow: "0 16px 40px -8px rgba(15,10,30,0.30)",
  padding: 14,
  zIndex: 80,
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
};

const navBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  flexShrink: 0,
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  background: "transparent",
  color: "var(--text-2)",
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "background 0.1s",
};

const monthLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  flex: 1,
  padding: "6px 10px",
  border: "1px solid transparent",
  borderRadius: 8,
  background: "transparent",
  color: "var(--text-1)",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "background 0.1s",
};
