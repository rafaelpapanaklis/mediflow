"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Calendar, ChevronDown } from "lucide-react";

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (iso: string) => void;
  todayISO: string; // YYYY-MM-DD en la zona horaria de la clínica
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Aritmética de fechas sobre el string YYYY-MM-DD tratándolo como fecha
// de calendario (UTC midnight) — evita el corrimiento por zona horaria.
function parts(iso: string): number[] {
  return iso.split("-").map(Number);
}
function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt);
}
function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return toISO(dt);
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
function shortDate(iso: string): string {
  const [, m, d] = parts(iso);
  return `${d} ${MONTH_ABBR[m - 1]}`;
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
 * y popover (Radix → portal, no lo recorta el overflow del modal) con saltos
 * rápidos, stepper "sumar N días/semanas/meses" e input date nativo.
 */
export function DateDropdown({ value, onChange, todayISO }: Props) {
  const [open, setOpen] = useState(false);
  const [stepN, setStepN] = useState("1");
  const [stepUnit, setStepUnit] = useState<"días" | "semanas" | "meses">("días");

  const safeValue = value || todayISO;

  const jumps: { label: string; iso: string }[] = [
    { label: "Hoy", iso: addDays(todayISO, 0) },
    { label: "Mañana", iso: addDays(todayISO, 1) },
    { label: "En 3 días", iso: addDays(todayISO, 3) },
    { label: "Próx. semana", iso: addDays(todayISO, 7) },
    { label: "En 2 sem.", iso: addDays(todayISO, 14) },
    { label: "En 1 mes", iso: addMonths(todayISO, 1) },
    { label: "En 3 meses", iso: addMonths(todayISO, 3) },
    { label: "En 6 meses", iso: addMonths(todayISO, 6) },
    { label: "En 1 año", iso: addMonths(todayISO, 12) },
  ];

  const select = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const applyStep = () => {
    const n = parseInt(stepN, 10);
    if (!Number.isFinite(n) || n === 0) return;
    const next =
      stepUnit === "meses"
        ? addMonths(safeValue, n)
        : addDays(safeValue, stepUnit === "semanas" ? n * 7 : n);
    select(next);
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
          <div style={sectionLabelStyle}>Saltos rápidos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14 }}>
            {jumps.map((j) => {
              const selected = j.iso === safeValue;
              return (
                <button key={j.label} type="button" onClick={() => select(j.iso)} style={jumpStyle(selected)}>
                  <span style={{ fontSize: 12, fontWeight: selected ? 600 : 500, color: selected ? "var(--trial-accent-calm)" : "var(--text-1)" }}>
                    {j.label}
                  </span>
                  <span style={{ fontSize: 10, color: selected ? "var(--trial-accent-calm)" : "var(--text-3)" }}>
                    {shortDate(j.iso)}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={sectionLabelStyle}>Sumar días o meses</div>
          <div style={stepRowStyle}>
            <span style={{ fontSize: 12, color: "var(--text-3)", paddingLeft: 6 }}>En</span>
            <input
              type="number"
              min={1}
              value={stepN}
              onChange={(e) => setStepN(e.target.value)}
              aria-label="Cantidad a sumar"
              style={stepInputStyle}
            />
            <select
              value={stepUnit}
              onChange={(e) => setStepUnit(e.target.value as "días" | "semanas" | "meses")}
              aria-label="Unidad"
              style={stepSelectStyle}
            >
              <option value="días">días</option>
              <option value="semanas">semanas</option>
              <option value="meses">meses</option>
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={applyStep} style={applyBtnStyle}>
              Aplicar
            </button>
          </div>

          <div style={{ ...sectionLabelStyle, marginTop: 14 }}>Fecha específica</div>
          <input
            type="date"
            value={safeValue}
            onChange={(e) => {
              if (e.target.value) select(e.target.value);
            }}
            style={nativeDateStyle}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
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

function jumpStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 1,
    padding: "8px 10px",
    border: `1px solid ${selected ? "var(--border-brand)" : "var(--border-soft)"}`,
    background: selected ? "var(--brand-soft)" : "var(--bg-elev)",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.12s",
  };
}

const popoverStyle: React.CSSProperties = {
  width: 420,
  maxWidth: "calc(100vw - 32px)",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 12,
  boxShadow: "0 16px 40px -8px rgba(15,10,30,0.30)",
  padding: 14,
  zIndex: 80,
  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 8,
};

const stepRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: 4,
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  background: "var(--bg-elev)",
};

const stepInputStyle: React.CSSProperties = {
  width: 56,
  padding: "6px 8px",
  border: "1px solid var(--border-soft)",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  textAlign: "center",
  background: "var(--bg-elev)",
  color: "var(--text-1)",
  fontFamily: "inherit",
  outline: "none",
};

const stepSelectStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid var(--border-soft)",
  borderRadius: 6,
  fontSize: 13,
  background: "var(--bg-elev)",
  color: "var(--text-1)",
  fontFamily: "inherit",
  cursor: "pointer",
  outline: "none",
};

const applyBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "var(--brand)",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const nativeDateStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  fontSize: 13,
  background: "var(--bg-elev)",
  color: "var(--text-1)",
  fontFamily: "inherit",
  outline: "none",
};
