"use client";

/**
 * La gráfica grande del Dashboard: INGRESOS (área, eje derecho, $) y ALTAS
 * (barras, eje izquierdo, clínicas nuevas) con conmutador Semana / Mes / Año.
 *
 * Recibe las tres series YA calculadas por el servidor
 * (`@/lib/admin/serie-negocio`: semana / mes / año EN CURSO del calendario de
 * Mérida, datos reales de subscription_invoices y Clinic.createdAt): aquí sólo
 * se elige cuál pintar. Los totales de la leyenda son del mismo periodo.
 * recharts ya estaba en el repo; no se añade ninguna dependencia.
 */
import { useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ETIQUETA_RANGO, TRAMO_RANGO, type PuntoNegocio, type Rango } from "@/lib/admin/serie-negocio";
import { formatCurrency } from "@/lib/utils";

const RANGOS: Rango[] = ["semana", "mes", "anio"];

const TOOLTIP_STYLE = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--text-1)",
  fontVariantNumeric: "tabular-nums",
  boxShadow: "var(--shadow-2)",
} as const;

export function GraficaNegocio({ series, inicial = "mes" }: {
  series: Record<Rango, PuntoNegocio[]>;
  inicial?: Rango;
}) {
  const [rango, setRango] = useState<Rango>(inicial);
  // Los tramos que aún no llegan van a null: recharts no pinta ni punto ni
  // barra y la línea termina en el periodo actual, sin desplomarse a $0.
  // Los totales salen de la serie tal cual (los futuros valen 0).
  const datos = series[rango].map((p) => (p.futuro
    ? { ...p, ingresos: null as number | null, altas: null as number | null, pagos: null as number | null }
    : p));
  const totalIngresos = series[rango].reduce((s, p) => s + p.ingresos, 0);
  const totalAltas = series[rango].reduce((s, p) => s + p.altas, 0);
  // En el mes (28–31 tramos) el eje muestra un día de cada cuatro para que no se pise.
  const intervalo = rango === "mes" ? 3 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div className="ad-leyenda">
          <span><i style={{ background: "var(--brand)" }} /> Ingresos · <strong className="ad-num" style={{ color: "var(--text-1)" }}>{formatCurrency(totalIngresos)}</strong></span>
          <span><i style={{ background: "var(--info)" }} /> Altas · <strong className="ad-num" style={{ color: "var(--text-1)" }}>{totalAltas}</strong></span>
          <span className="ad-suave">{TRAMO_RANGO[rango]}</span>
        </div>
        <div className="ad-conmutador" role="group" aria-label="Rango de la gráfica">
          {RANGOS.map((r) => (
            <button key={r} type="button" aria-pressed={rango === r} onClick={() => setRango(r)}>
              {ETIQUETA_RANGO[r]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={datos} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="ad-ingresos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-3)" }} axisLine={false} tickLine={false} interval={intervalo} />
            <YAxis yAxisId="altas" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--text-3)" }} axisLine={false} tickLine={false} width={28} />
            <YAxis
              yAxisId="ingresos" orientation="right" tick={{ fontSize: 11, fill: "var(--text-3)" }} axisLine={false} tickLine={false} width={56}
              tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "var(--brand-softer, transparent)" }}
              formatter={(v: number, nombre: string) => [nombre === "Ingresos" ? formatCurrency(v) : v, nombre]}
            />
            <Bar yAxisId="altas" dataKey="altas" name="Altas" fill="var(--info)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            {/* Línea recta entre puntos y un punto por tramo: cada día (o mes) es
                una cifra real, y la curva suave inventaba dinero entre dos días. */}
            <Area yAxisId="ingresos" type="linear" dataKey="ingresos" name="Ingresos" stroke="var(--brand)" strokeWidth={2} fill="url(#ad-ingresos)"
              connectNulls={false} dot={rango === "mes" ? false : { r: 3, fill: "var(--brand)", strokeWidth: 0 }} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
