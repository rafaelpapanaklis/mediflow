"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Note, PanelCard } from "@/components/afiliados/ui/panel-ui";

/**
 * Cliente de /afiliados/reportes — dos tarjetas:
 *  1. "Exportar a Excel": tipo (referidos | comisiones) + rango de fechas →
 *     /api/afiliados/reportes/export
 *  2. "Estado de cuenta (PDF)": mes → /api/afiliados/reportes/estado-cuenta
 * Validación suave en cliente (from ≤ to, rango ≤ 366 días) que deshabilita
 * el botón y muestra un aviso. La validación dura vive en el endpoint.
 *
 * Estilo: clases `dcafp-*` de src/app/afiliados/panel.css. Los campos usan
 * `dcafp-input` (44px táctiles) en vez de estilos inline propios, así que un
 * cambio de radio o de borde en el panel llega solo hasta aquí.
 */

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

const REPORT_TYPES = [
  { value: "referidos", label: "Referidos" },
  { value: "comisiones", label: "Comisiones" },
] as const;

type ReportType = (typeof REPORT_TYPES)[number]["value"];

function toInputDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ReportesClient() {
  const [type, setType] = useState<ReportType>("referidos");
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
    <div className="dcafp-grid2">
      {/* ── Exportar a Excel ── */}
      <PanelCard
        title="Exportar a Excel"
        sub="Elige qué quieres exportar y el rango de fechas; descargas un .xlsx al instante."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div>
            <span className="dcafp-label" id="reporte-tipo-label">
              Tipo de reporte
            </span>
            <div
              role="radiogroup"
              aria-labelledby="reporte-tipo-label"
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              {REPORT_TYPES.map((t) => {
                const active = type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setType(t.value)}
                    className={`dcafp-btn${active ? " dcafp-btn--outline" : ""}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label htmlFor="reporte-desde" className="dcafp-label">
                Desde
              </label>
              <input
                id="reporte-desde"
                type="date"
                className="dcafp-input"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <label htmlFor="reporte-hasta" className="dcafp-label">
                Hasta
              </label>
              <input
                id="reporte-hasta"
                type="date"
                className="dcafp-input"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          {rangeHint && <Note tone="warn">{rangeHint}</Note>}

          <p className="dcafp-hint">
            Incluye solo tus referidos; los datos de cada clínica se limitan a nombre y estado.
          </p>

          <button
            type="button"
            onClick={downloadExcel}
            disabled={excelDisabled}
            className="dcafp-btn dcafp-btn--primary"
            style={{ alignSelf: "flex-start" }}
          >
            <Download size={15} />
            Descargar Excel
          </button>
        </div>
      </PanelCard>

      {/* ── Estado de cuenta (PDF) ── */}
      <PanelCard
        title="Estado de cuenta (PDF)"
        sub="Desglose mensual de tus comisiones: monto, estado y total del mes."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ maxWidth: 240, minWidth: 0 }}>
            <label htmlFor="reporte-mes" className="dcafp-label">
              Mes
            </label>
            <input
              id="reporte-mes"
              type="month"
              className="dcafp-input"
              value={month}
              max={currentMonthInput()}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>

          {pdfDisabled && <Note tone="warn">Elige un mes válido para poder descargar.</Note>}

          <p className="dcafp-hint">
            Elige el mes y descarga tu estado de cuenta listo para guardar o compartir con tu contador.
          </p>

          <button
            type="button"
            onClick={downloadPdf}
            disabled={pdfDisabled}
            className="dcafp-btn dcafp-btn--primary"
            style={{ alignSelf: "flex-start" }}
          >
            <Download size={15} />
            Descargar PDF
          </button>
        </div>
      </PanelCard>
    </div>
  );
}
