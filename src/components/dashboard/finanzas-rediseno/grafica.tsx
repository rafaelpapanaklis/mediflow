"use client";

/**
 * «Ingresos vs Gastos» con el diseño nuevo. La MISMA serie que pinta la
 * gráfica de siempre (`finanzas-client.tsx`): un punto por día con
 * `ingresos` y `gastos`, tal cual llega de /api/finanzas. Solo cambia la ropa.
 *
 * Una gráfica de recharts NO se re-viste con CSS: los colores de las series,
 * los ejes, la rejilla y el gradiente van en props de JS. Por eso aquí NO hay
 * ni un hex: los colores se LEEN de los tokens del menú (`--m2-*`, que la raíz
 * del rediseño monta) y de los semánticos del panel (`--danger`) con
 * `getComputedStyle`, en el propio nodo de la gráfica. Si mañana cambia el
 * violeta del menú, esta gráfica cambia con él. Y como el tema se cambia
 * poniendo o quitando `.dark` en <html> (theme-toggle.tsx), un observador de
 * esa clase vuelve a leerlos: sin reloj, sin polling.
 */

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { fmtMXN } from "@/lib/format";
import { etiquetaDinero, marcasEje } from "./escala";

export interface PuntoFinanzas {
  fecha: string;
  ingresos: number;
  gastos: number;
}

interface Colores {
  ingresos: string;
  gastos: string;
  texto: string;
  rejilla: string;
  fondo: string;
}

// Fechas YYYY-MM-DD parseadas a mediodía local para evitar el corrimiento de
// un día por zona horaria (México). Mismas funciones que la gráfica de siempre.
const asLocalDay = (s: string) => new Date(s.slice(0, 10) + "T12:00:00");
const fmtDayShort = (s: string) => asLocalDay(s).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
const fmtDayLong = (s: string) => asLocalDay(s).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });

function leerColores(nodo: HTMLElement): Colores | null {
  const estilo = getComputedStyle(nodo);
  const leer = (nombre: string) => estilo.getPropertyValue(nombre).trim();
  const colores: Colores = {
    ingresos: leer("--m2-activo"),
    gastos: leer("--danger"),
    texto: leer("--m2-texto-3"),
    rejilla: leer("--m2-borde"),
    fondo: leer("--m2-tarjeta"),
  };
  // Sin tokens (fuera de la raíz del rediseño) no se pinta nada: mejor un
  // hueco que una gráfica con colores inventados.
  return Object.values(colores).every(Boolean) ? colores : null;
}

export function GraficaFinanzas({ serie, alto = 280 }: { serie: PuntoFinanzas[]; alto?: number }) {
  const caja = useRef<HTMLDivElement>(null);
  const [colores, setColores] = useState<Colores | null>(null);

  // Un id por instancia: dos gráficas en la misma página compartirían el
  // gradiente y la segunda heredaría el del primer <defs>.
  const sufijo = useId().replace(/[^a-zA-Z0-9]/g, "");
  const idIngresos = `finIngresos-${sufijo}`;
  const idGastos = `finGastos-${sufijo}`;

  useLayoutEffect(() => {
    const nodo = caja.current;
    if (!nodo) return;
    const actualizar = () => setColores(leerColores(nodo));
    actualizar();
    const observador = new MutationObserver(actualizar);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observador.disconnect();
  }, []);

  // Escala del eje de dinero: marcas redondas que cubren el máximo de las dos
  // series, con etiquetas que nombran exactamente ese valor (ver escala.ts).
  const maximo = useMemo(
    () => serie.reduce((m, p) => Math.max(m, p.ingresos || 0, p.gastos || 0), 0),
    [serie],
  );
  const marcas = useMemo(() => marcasEje(maximo), [maximo]);
  const tope = marcas[marcas.length - 1] || 1;

  // Con un solo día (periodo «Hoy») una línea no se ve: se pinta el punto.
  const unSoloPunto = serie.length < 2;

  return (
    <div ref={caja} style={{ width: "100%", height: alto }}>
      {colores && (
        <ResponsiveContainer>
          <AreaChart data={serie} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={idIngresos} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colores.ingresos} stopOpacity={0.26} />
                <stop offset="55%" stopColor={colores.ingresos} stopOpacity={0.08} />
                <stop offset="100%" stopColor={colores.ingresos} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={idGastos} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colores.gastos} stopOpacity={0.18} />
                <stop offset="55%" stopColor={colores.gastos} stopOpacity={0.05} />
                <stop offset="100%" stopColor={colores.gastos} stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* Solo líneas horizontales: la rejilla vertical competía con la
                serie y en 30 días del mes se volvía un rayado. */}
            <CartesianGrid vertical={false} stroke={colores.rejilla} strokeDasharray="2 6" />
            <XAxis
              dataKey="fecha"
              stroke={colores.texto}
              tick={{ fontSize: 10.5, fill: colores.texto }}
              tickFormatter={(v: string) => fmtDayShort(String(v))}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
              tickMargin={8}
            />
            <YAxis
              stroke={colores.texto}
              tick={{ fontSize: 10.5, fill: colores.texto }}
              axisLine={false}
              tickLine={false}
              width={54}
              ticks={marcas}
              domain={[0, tope]}
              tickMargin={4}
              tickFormatter={(v: number) => etiquetaDinero(v)}
            />
            <Tooltip
              contentStyle={{
                background: "var(--m2-tarjeta)",
                border: "1px solid var(--m2-tarjeta-borde)",
                borderRadius: 10,
                fontSize: 12,
                color: "var(--m2-texto)",
                boxShadow: "0 8px 20px -8px rgba(15, 10, 30, 0.25)",
                padding: "8px 10px",
                fontVariantNumeric: "tabular-nums",
              }}
              labelStyle={{ color: "var(--m2-texto-3)", fontSize: 11, marginBottom: 2 }}
              itemStyle={{ fontWeight: 600, padding: 0 }}
              cursor={{ stroke: colores.ingresos, strokeOpacity: 0.35, strokeDasharray: "3 3" }}
              labelFormatter={(l: unknown) => fmtDayLong(String(l))}
              formatter={(v: unknown, name: unknown) => [
                fmtMXN(Number(v) || 0),
                name === "ingresos" ? "Ingresos" : "Gastos",
              ]}
            />
            <Area
              type="monotone"
              dataKey="ingresos"
              name="ingresos"
              stroke={colores.ingresos}
              strokeWidth={2.25}
              fill={`url(#${idIngresos})`}
              dot={unSoloPunto ? { r: 4, fill: colores.ingresos, stroke: colores.fondo, strokeWidth: 2 } : false}
              activeDot={{ r: 4.5, fill: colores.ingresos, stroke: colores.fondo, strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="gastos"
              name="gastos"
              stroke={colores.gastos}
              strokeWidth={2}
              fill={`url(#${idGastos})`}
              dot={unSoloPunto ? { r: 4, fill: colores.gastos, stroke: colores.fondo, strokeWidth: 2 } : false}
              activeDot={{ r: 4.5, fill: colores.gastos, stroke: colores.fondo, strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
