"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { eduMoney } from "@/lib/edu/dinero-core";
import type { EduDirSerie } from "@/lib/edu/direccion-core";

/**
 * UNA de las tres gráficas del Inicio de dirección.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA LIBRERÍA ES recharts, LA MISMA QUE YA USA EL REPO. No entra una
 * dependencia nueva por esta pantalla: recharts ya está en package.json y
 * lo usan /admin/analytics, /dashboard/finanzas y media docena de sitios
 * más del dental. La forma de cargarlo también está copiada de allí
 * (src/components/dashboard/home/parts/revenue-trend-card.tsx): quien la
 * pinta la trae con `next/dynamic` y `ssr: false`, porque recharts pesa
 * ~95 kB y el Inicio lo abren también un alumno y un docente, que no ven
 * ninguna gráfica.
 *
 * 🔴 BARRAS Y NO UNA LÍNEA. Cada punto es UN DÍA, y una línea entre dos
 * días insinúa que hubo algo entre medias: media tarde del martes con
 * "1.4 pacientes". Las barras dicen lo que son, cuentas de días sueltos.
 *
 * 🔴 UN SOLO COLOR, EL DE LA MARCA, EN LAS TRES. En este vertical el color
 * NUNCA adorna: está reservado para el semáforo (rojo = alguien tiene que
 * actuar, ámbar = vigilar). Tres gráficas de tres colores enseñarían a
 * leer el color como decoración justo en la pantalla donde luego hay que
 * creerle a un rojo.
 *
 * 🔴 TODOS LOS DÍAS, TAMBIÉN LOS DE CERO — los pone direccion-core.ts. El
 * eje X en cambio no los ETIQUETA todos: a 30 días las fechas se pisan, y
 * una etiqueta ilegible es peor que ninguna. Se rotula una de cada N y el
 * globo del ratón siempre dice la fecha completa.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduInicioGrafica({ serie }: { serie: EduDirSerie }) {
  const esDinero = serie.unidad === "dinero";
  const hayNegativos = serie.puntos.some((p) => p.value < 0);

  // Una etiqueta cada ~8 columnas como mucho. `interval` de recharts es
  // "cuántas se saltan entre una y otra", así que va menos uno.
  const cada = Math.max(1, Math.ceil(serie.puntos.length / 8));
  const interval = cada - 1;

  /**
   * El eje Y: corto a propósito. "$12k" se lee; "$12,340.00" no cabe en
   * 46 px y recharts lo recorta a la mitad.
   *
   * El signo va DELANTE del peso ("-$550" y no "$-550"): es como se
   * escribe una cantidad negativa, y en una columna de números el símbolo
   * pegado al dígito se confunde con un guion de separación.
   */
  const ejeY = (v: number): string => {
    if (!esDinero) return String(v);
    const pesos = v / 100;
    const abs = Math.abs(pesos);
    const signo = pesos < 0 ? "-" : "";
    if (abs >= 100_000) return `${signo}$${Math.round(abs / 1000)}k`;
    if (abs >= 1000) return `${signo}$${(abs / 1000).toFixed(1)}k`;
    return `${signo}$${Math.round(abs)}`;
  };

  return (
    <div className="edu-ini-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie.puntos} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
          {/* Rejilla horizontal y punteada: está para poder comparar dos
              barras de lejos, no para verse. */}
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--edu-line)" />
          <XAxis
            dataKey="label"
            interval={interval}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "var(--edu-text-3)" }}
            minTickGap={2}
          />
          <YAxis
            width={esDinero ? 46 : 30}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "var(--edu-text-3)" }}
            tickFormatter={ejeY}
          />
          {/* Solo cuando hace falta: un día puede salir NEGATIVO si se
              devolvió más de lo que entró, y sin la línea del cero no se
              ve de qué lado está cada barra. */}
          {hayNegativos && <ReferenceLine y={0} stroke="var(--edu-line-strong)" />}
          <Tooltip
            cursor={{ fill: "var(--edu-hover)" }}
            contentStyle={{
              background: "var(--edu-surface)",
              border: "1px solid var(--edu-line)",
              borderRadius: 10,
              fontSize: 12.5,
              color: "var(--edu-text-1)",
              boxShadow: "var(--edu-shadow-2)",
            }}
            labelStyle={{ color: "var(--edu-text-2)", fontWeight: 650, marginBottom: 2 }}
            // La fecha COMPLETA, no la abreviada del eje: es el sitio donde
            // se comprueba de qué día se está hablando.
            labelFormatter={(_label: string, payload) =>
              (payload?.[0]?.payload as { largo?: string } | undefined)?.largo ?? String(_label)
            }
            formatter={(v: number) => [
              esDinero ? eduMoney(v) : String(v),
              serie.titulo,
            ]}
          />
          <Bar
            dataKey="value"
            fill="var(--edu-500)"
            // Extremos redondeados de 4 px arriba y cuadrados abajo: la
            // barra queda pegada a su línea base, que es lo que se compara.
            radius={[4, 4, 0, 0]}
            maxBarSize={38}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
