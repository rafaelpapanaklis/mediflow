"use client";

import { useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";

export interface RevenuePoint {
  label: string;
  value: number;
  /**
   * El tramo todavía no ocurre. Un tramo futuro SIN dinero se dibuja como
   * hueco (la línea corta en "hoy" en vez de desplomarse a $0 el resto del
   * mes); uno CON dinero sí se pinta —un cobro fechado a futuro existe y
   * esconderlo es justo el bug que dejaba la gráfica plana mientras el KPI
   * mostraba $1,224.
   */
  future?: boolean;
}

interface Props {
  data: RevenuePoint[];
  height?: number;
  /**
   * ¿Se pinta dentro del rediseño de «Hoy»? (hallazgo 14: el tooltip, los
   * ejes y el trazo salían con los tokens de siempre dentro de la pantalla
   * nueva). Encendido, TODO color se lee de los `--m2-*` del menú que la
   * raíz de «Hoy» ya monta, con la letra heredada de ahí. Sin la prop, o en
   * false, cada valor es el literal de siempre: la home sin bandera no
   * cambia un byte.
   */
  rediseno?: boolean;
}

/** Los colores de la gráfica en cada uno de los dos caminos. */
const COLORES = {
  clasico: {
    tinta: "var(--brand)",
    rejilla: "var(--border-soft)",
    eje: "var(--text-4)",
    fondo: "var(--bg-elev)",
    borde: "var(--border-soft)",
    texto: "var(--text-1)",
    texto3: "var(--text-3)",
    sombra: "var(--shadow-2)",
  },
  rediseno: {
    tinta: "var(--m2-activo)",
    rejilla: "var(--m2-borde)",
    eje: "var(--m2-texto-3)",
    fondo: "var(--m2-tarjeta)",
    borde: "var(--m2-tarjeta-borde)",
    texto: "var(--m2-texto)",
    texto3: "var(--m2-texto-3)",
    sombra: "var(--m2-sombra)",
  },
} as const;

export function RevenueAreaChart({ data, height = 260, rediseno = false }: Props) {
  // Un id por instancia: dos gráficas en la misma página compartían el
  // gradiente "mfRevenueFill" y la segunda heredaba el del primer <defs>.
  const gradientId = `mfRevenueFill-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const c = rediseno ? COLORES.rediseno : COLORES.clasico;
  // El relleno del área: con la bandera, un segundo gradiente que lee el
  // violeta del menú (un `var()` en `stop-color` funciona igual que el
  // `var(--brand)` que ya lleva el trazo); sin ella, el de siempre, tal cual.
  const rellenoId = rediseno ? `${gradientId}-m2` : gradientId;

  const rows = data.map((p) => ({
    label: p.label,
    value: p.future && !p.value ? null : p.value,
  }));

  // Último tramo ya ocurrido: ahí va el punto de "hoy".
  let lastRealIdx = -1;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].future === false) { lastRealIdx = i; break; }
  }
  const marker =
    lastRealIdx >= 0 && rows[lastRealIdx].value !== null
      ? { x: rows[lastRealIdx].label, y: rows[lastRealIdx].value as number }
      : null;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              {/* Hex literal, no var(): --brand vale #7c3aed en ambos temas y
                  stop-color es el único atributo de presentación que no está
                  probado en este panel. */}
              <stop offset="0%"   stopColor="#7c3aed" stopOpacity={0.28} />
              <stop offset="55%"  stopColor="#7c3aed" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
            </linearGradient>
            {rediseno && (
              <linearGradient id={rellenoId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={c.tinta} stopOpacity={0.28} />
                <stop offset="55%"  stopColor={c.tinta} stopOpacity={0.08} />
                <stop offset="100%" stopColor={c.tinta} stopOpacity={0} />
              </linearGradient>
            )}
          </defs>
          {/* Sólo líneas horizontales: la rejilla vertical competía con la
              serie y en 30 días del mes se volvía un rayado. */}
          <CartesianGrid vertical={false} stroke={c.rejilla} strokeDasharray="2 6" />
          <XAxis
            dataKey="label"
            stroke={c.eje}
            tick={{ fontSize: 10.5, fill: c.eje }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={18}
            tickMargin={8}
          />
          <YAxis
            stroke={c.eje}
            tick={{ fontSize: 10.5, fill: c.eje }}
            axisLine={false}
            tickLine={false}
            width={46}
            tickCount={4}
            tickMargin={4}
            tickFormatter={formatAxisMoney}
          />
          <Tooltip
            contentStyle={rediseno ? {
              background: c.fondo,
              border: `1px solid ${c.borde}`,
              borderRadius: 10,
              fontSize: 12,
              color: c.texto,
              boxShadow: c.sombra,
              padding: "8px 10px",
              fontFamily: "inherit",
              fontVariantNumeric: "tabular-nums",
            } : {
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              fontSize: 12,
              color: "var(--text-1)",
              boxShadow: "var(--shadow-2)",
              padding: "8px 10px",
            }}
            labelStyle={{ color: c.texto3, fontSize: 11, marginBottom: 2 }}
            itemStyle={{ color: c.texto, fontWeight: 600 }}
            cursor={{ stroke: c.tinta, strokeOpacity: 0.35, strokeDasharray: "3 3" }}
            formatter={(v: number) => [`$${Number(v).toLocaleString("es-MX")}`, "Ingresos"]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={c.tinta}
            strokeWidth={2.25}
            fill={`url(#${rellenoId})`}
            connectNulls={false}
            dot={false}
            activeDot={{
              r: 4.5,
              fill: c.tinta,
              stroke: c.fondo,
              strokeWidth: 2,
            }}
          />
          {marker && (
            <ReferenceDot
              x={marker.x}
              y={marker.y}
              r={3.5}
              fill={c.tinta}
              stroke={c.fondo}
              strokeWidth={2}
              isFront
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatAxisMoney(v: number): string {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(n)}`;
}
