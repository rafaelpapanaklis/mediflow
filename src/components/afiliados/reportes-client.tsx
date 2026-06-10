"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";

/**
 * Cliente de /afiliados/reportes — dos tarjetas (idioma visual de inicio):
 *  1. "Exportar a Excel": tipo (referidos | comisiones) + rango de fechas →
 *     /api/afiliados/reportes/export
 *  2. "Estado de cuenta (PDF)": mes → /api/afiliados/reportes/estado-cuenta
 * Validación suave en cliente (from ≤ to, rango ≤ 366 días) que deshabilita
 * el botón y muestra un hint. La validación dura vive en el endpoint.
 */

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

function toInputDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Estilos compartidos (inputs dark estilo referral-links.tsx) ──────────

const fieldStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: 10,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-2)",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
  colorScheme: "dark", // picker nativo en dark
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-3)",
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-3)",
  margin: 0,
  lineHeight: 1.45,
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 40,
  padding: "0 16px",
  borderRadius: 10,
  border: "1px solid var(--border-brand)",
  background: "var(--brand-soft)",
  color: "var(--violet-400)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all .15s",
  alignSelf: "flex-start",
};

function CardHeader({
  icon: Icon,
  title,
  sub,
}: {
  icon: React.ComponentType<{ size?: number | string }>;
  title: string;
  sub: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          background: "var(--brand-soft)",
          border: "1px solid var(--border-brand)",
          color: "var(--violet-400)",
        }}
      >
        <Icon size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
      </div>
    </div>
  );
}

export function ReportesClient() {
  const [type, setType] = useState<"referidos" | "comisiones">("referidos");
  const [from, setFrom] = useState<string>(() => toInputDate(new Date(Date.now() - 30 * DAY_MS)));
  const [to, setTo] = useState<string>(() => toInputDate(new Date()));
  const [month, setMonth] = useState<string>(currentMonthInput);

  // Validación suave: misma regla que el endpoint (from ≤ to, ≤ 366 días).
  const rangeHint = useMemo(() => {
    if (!from || !to) return "Selecciona las dos fechas para poder descargar.";
    const f = new Date(`${from}T00:00:00Z`);
    const t = new Date(`${to}T00:00:00Z`);
    if (isNaN(f.getTime()) || isNaN(t.getTime())) return "Revisa las fechas: alguna no es válida.";
    if (f.getTime() > t.getTime()) return "La fecha “Desde” no puede ser posterior a “Hasta”.";
    const days = Math.round((t.getTime() - f.getTime()) / DAY_MS) + 1;
    if (days > MAX_RANGE_DAYS) return `El rango máximo es de ${MAX_RANGE_DAYS} días; acorta el periodo.`;
    return null;
  }, [from, to]);

  const excelDisabled = rangeHint !== null;
  const pdfDisabled = !/^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  function downloadExcel() {
    if (excelDisabled) return;
    window.location.href = `/api/afiliados/reportes/export?type=${type}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  function downloadPdf() {
    if (pdfDisabled) return;
    window.location.href = `/api/afiliados/reportes/estado-cuenta?month=${encodeURIComponent(month)}`;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
        gap: 14,
      }}
    >
      {/* ── Exportar a Excel ── */}
      <CardNew>
        <CardHeader
          icon={FileSpreadsheet}
          title="Exportar a Excel"
          sub="Elige qué quieres exportar y el rango de fechas; descargas un .xlsx al instante."
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={labelStyle}>Tipo de reporte</span>
            <div role="radiogroup" aria-label="Tipo de reporte" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["referidos", "comisiones"] as const).map((t) => {
                const active = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setType(t)}
                    style={{
                      height: 34,
                      padding: "0 14px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "var(--border-brand)" : "var(--border-soft)"}`,
                      background: active ? "var(--brand-soft)" : "var(--bg-elev-2)",
                      color: active ? "var(--violet-400)" : "var(--text-2)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all .15s",
                    }}
                  >
                    {t === "referidos" ? "Referidos" : "Comisiones"}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="reporte-desde" style={labelStyle}>
                Desde
              </label>
              <input
                id="reporte-desde"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                style={fieldStyle}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="reporte-hasta" style={labelStyle}>
                Hasta
              </label>
              <input
                id="reporte-hasta"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                style={fieldStyle}
              />
            </div>
          </div>

          {rangeHint && (
            <p style={{ ...hintStyle, color: "var(--warning, #fbbf24)" }}>{rangeHint}</p>
          )}
          <p style={hintStyle}>
            Incluye solo tus referidos; los datos de cada clínica se limitan a nombre y estado.
          </p>

          <button
            type="button"
            onClick={downloadExcel}
            disabled={excelDisabled}
            style={{
              ...primaryBtn,
              opacity: excelDisabled ? 0.5 : 1,
              cursor: excelDisabled ? "not-allowed" : "pointer",
            }}
          >
            <Download size={15} />
            Descargar Excel
          </button>
        </div>
      </CardNew>

      {/* ── Estado de cuenta (PDF) ── */}
      <CardNew>
        <CardHeader
          icon={FileText}
          title="Estado de cuenta (PDF)"
          sub="Desglose mensual de tus comisiones: monto, estado y total del mes."
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 240 }}>
            <label htmlFor="reporte-mes" style={labelStyle}>
              Mes
            </label>
            <input
              id="reporte-mes"
              type="month"
              value={month}
              max={currentMonthInput()}
              onChange={(e) => setMonth(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <p style={hintStyle}>
            Elige el mes y descarga tu estado de cuenta listo para guardar o compartir con tu contador.
          </p>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={pdfDisabled}
            style={{
              ...primaryBtn,
              opacity: pdfDisabled ? 0.5 : 1,
              cursor: pdfDisabled ? "not-allowed" : "pointer",
            }}
          >
            <Download size={15} />
            Descargar PDF
          </button>
        </div>
      </CardNew>
    </div>
  );
}
