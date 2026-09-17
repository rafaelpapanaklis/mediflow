"use client";

/**
 * Tendencia de ingresos (admin), con el diseño nuevo. La MISMA lógica que
 * `home/parts/revenue-trend-card.tsx`: arranca en el periodo del selector de
 * arriba (así el total es el número del KPI), pide /api/dashboard/home/revenue
 * por rango, solo pinta la última petición, y declara el error en vez de
 * dejar la serie vieja. Solo cambia la ropa.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, TrendingUp } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { rangeForPeriod, type RevenueRange } from "@/lib/home/revenue-buckets";
import type { AdminPeriod } from "@/lib/home/types";
import { Tarjeta, Vacio } from "./piezas";
import s from "./hoy.module.css";

interface PuntoSerie {
  label: string;
  value: number;
  future: boolean;
}

interface Respuesta {
  series: PuntoSerie[];
  total: number;
  count: number;
  degraded: boolean;
}

const VACIA: Respuesta = { series: [], total: 0, count: 0, degraded: false };

const RANGOS: Array<{ value: RevenueRange; labelKey: string; subtitleKey: string; unitKey: string }> = [
  { value: "hoy",    labelKey: "home.revenueTrend.rangeDay",   subtitleKey: "home.revenueTrend.subtitleDay",   unitKey: "home.revenueTrend.unitHour" },
  { value: "semana", labelKey: "home.revenueTrend.rangeWeek",  subtitleKey: "home.revenueTrend.subtitleWeek",  unitKey: "home.revenueTrend.unitDay" },
  { value: "mes",    labelKey: "home.revenueTrend.rangeMonth", subtitleKey: "home.revenueTrend.subtitleMonth", unitKey: "home.revenueTrend.unitDay" },
  { value: "anio",   labelKey: "home.revenueTrend.rangeYear",  subtitleKey: "home.revenueTrend.subtitleYear",  unitKey: "home.revenueTrend.unitMonth" },
];

// recharts pesa ~95 kB: fuera del bundle inicial, como en la home de siempre.
const GraficaIngresos = dynamic(
  () => import("@/components/dashboard/revenue-area-chart").then((m) => m.RevenueAreaChart),
  { ssr: false, loading: () => <div className={`${s.esqueleto} ${s.esqueletoGrafica}`} aria-hidden /> },
);

export function TarjetaIngresos({ period }: { period: AdminPeriod }) {
  const t = useT();
  const [rango, setRango] = useState<RevenueRange>(() => rangeForPeriod(period));
  const [datos, setDatos] = useState<Respuesta>(VACIA);
  const [cargando, setCargando] = useState(true);
  const [cargadoUnaVez, setCargadoUnaVez] = useState(false);
  const [fallo, setFallo] = useState(false);
  const peticion = useRef(0);
  const montado = useRef(true);

  const activo = RANGOS.find((r) => r.value === rango) ?? RANGOS[2];

  const cargar = useCallback(async (siguiente: RevenueRange) => {
    const id = ++peticion.current;
    setRango(siguiente);
    setCargando(true);
    try {
      const res = await fetch(`/api/dashboard/home/revenue?range=${siguiente}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Partial<Respuesta>;
      if (id === peticion.current && montado.current && Array.isArray(json.series)) {
        setDatos({
          series: json.series,
          total: Number(json.total ?? 0),
          count: Number(json.count ?? 0),
          degraded: Boolean(json.degraded),
        });
        setFallo(false);
      }
    } catch {
      if (id === peticion.current && montado.current) {
        setDatos(VACIA);
        setFallo(true);
      }
    } finally {
      if (id === peticion.current && montado.current) {
        setCargando(false);
        setCargadoUnaVez(true);
      }
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Sigue al selector de periodo (day→hoy, month→mes, year→anio; quarter no
  // tiene gráfica propia y se queda en el mes).
  useEffect(() => {
    void cargar(rangeForPeriod(period));
  }, [period, cargar]);

  const tramosPasados = useMemo(
    () => Math.max(1, datos.series.filter((p) => !p.future).length),
    [datos.series],
  );

  const roto = fallo || datos.degraded;
  const hayGrafica = !roto && datos.total > 0 && datos.series.length > 0;

  return (
    <Tarjeta
      icono={TrendingUp}
      titulo={t("home.revenueTrend.title")}
      sub={t(activo.subtitleKey)}
      accion={
        <div role="tablist" aria-label={t("home.revenueTrend.rangeAriaLabel")} className={s.segmentado}>
          {RANGOS.map((r) => {
            const esActivo = r.value === rango;
            return (
              <button
                key={r.value}
                type="button"
                role="tab"
                aria-selected={esActivo}
                className={`${s.segmento} ${esActivo ? s.segmentoActivo : ""}`}
                onClick={() => cargar(r.value)}
              >
                {t(r.labelKey)}
              </button>
            );
          })}
        </div>
      }
      lista
    >
      <div style={{ position: "relative" }}>
        <div className={s.ingresosTotal}>
          <div className={`${s.importeGrande} ${roto ? s.importeApagado : ""}`}>
            {roto ? "—" : dinero(datos.total)}
          </div>
          <div className={s.ingresosNota}>
            {roto
              ? t("home.revenueTrend.errorHint")
              : `${t("home.revenueTrend.payments", { count: datos.count })} · ${t("home.revenueTrend.avgPer", {
                  amount: dinero(Math.round(datos.total / tramosPasados)),
                  unit: t(activo.unitKey),
                })}`}
          </div>
        </div>

        <div className={s.grafica}>
          {!cargadoUnaVez ? (
            <div className={`${s.esqueleto} ${s.esqueletoGrafica}`} aria-hidden />
          ) : roto ? (
            <Vacio
              icono={AlertCircle}
              tono="peligro"
              titulo={t("home.revenueTrend.errorTitle")}
              pista={t("home.revenueTrend.errorHint")}
              alto
            />
          ) : hayGrafica ? (
            <div className={cargando ? s.graficaCargando : undefined}>
              <GraficaIngresos data={datos.series} rediseno />
            </div>
          ) : (
            <Vacio
              icono={TrendingUp}
              titulo={t("home.revenueTrend.emptyTitle")}
              pista={t("home.revenueTrend.emptyHint")}
              alto
            />
          )}
        </div>

        {cargando && cargadoUnaVez && (
          <div aria-hidden className={s.actualizando}>
            <span className={s.actualizandoTexto}>{t("home.revenueTrend.updating")}</span>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

function dinero(n: number): string {
  return `$${Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}
