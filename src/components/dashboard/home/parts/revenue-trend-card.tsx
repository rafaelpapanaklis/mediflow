"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { TrendingUp, AlertCircle } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { rangeForPeriod, type RevenueRange } from "@/lib/home/revenue-buckets";
import type { AdminPeriod } from "@/lib/home/types";
import { HomeSection } from "../home-section";

interface SeriesPoint {
  label: string;
  value: number;
  future: boolean;
}

interface RevenuePayload {
  series: SeriesPoint[];
  total: number;
  count: number;
  degraded: boolean;
}

const EMPTY: RevenuePayload = { series: [], total: 0, count: 0, degraded: false };

const RANGES: Array<{
  value: RevenueRange;
  labelKey: string;
  subtitleKey: string;
  unitKey: string;
}> = [
  { value: "hoy",    labelKey: "home.revenueTrend.rangeDay",   subtitleKey: "home.revenueTrend.subtitleDay",   unitKey: "home.revenueTrend.unitHour" },
  { value: "semana", labelKey: "home.revenueTrend.rangeWeek",  subtitleKey: "home.revenueTrend.subtitleWeek",  unitKey: "home.revenueTrend.unitDay" },
  { value: "mes",    labelKey: "home.revenueTrend.rangeMonth", subtitleKey: "home.revenueTrend.subtitleMonth", unitKey: "home.revenueTrend.unitDay" },
  { value: "anio",   labelKey: "home.revenueTrend.rangeYear",  subtitleKey: "home.revenueTrend.subtitleYear",  unitKey: "home.revenueTrend.unitMonth" },
];

// recharts pesa ~95kb min+gz — dynamic import lo saca del bundle inicial del
// dashboard. La gráfica aparece tras el primer paint con un skeleton suave.
const RevenueAreaChart = dynamic(
  () => import("@/components/dashboard/revenue-area-chart").then((m) => m.RevenueAreaChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  },
);

/**
 * Tarjeta de la tendencia de ingresos.
 *
 * El rango arranca sincronizado con el toggle de periodo del home: si arriba
 * dice "Ingresos del mes", la gráfica muestra el mes. Así el total que se
 * imprime aquí es el MISMO número del KPI (misma ventana, mismo `where`; ver
 * `src/lib/home/revenue-buckets.ts`), y cuando no coincidan se nota a simple
 * vista en vez de quedar escondido en una línea plana.
 */
export function RevenueTrendCard({ period }: { period: AdminPeriod }) {
  const t = useT();
  const [range, setRange] = useState<RevenueRange>(() => rangeForPeriod(period));
  const [data, setData] = useState<RevenuePayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [failed, setFailed] = useState(false);
  const reqId = useRef(0);
  const mountedRef = useRef(true);

  const active = RANGES.find((r) => r.value === range) ?? RANGES[2];

  const loadRange = useCallback(async (next: RevenueRange) => {
    const id = ++reqId.current;
    setRange(next);
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/home/revenue?range=${next}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Partial<RevenuePayload>;
      // Sólo la última petición pinta (evita carreras de clics) y sólo si
      // seguimos montados (evita setState tras desmontar).
      if (id === reqId.current && mountedRef.current && Array.isArray(json.series)) {
        setData({
          series: json.series,
          total: Number(json.total ?? 0),
          count: Number(json.count ?? 0),
          degraded: Boolean(json.degraded),
        });
        setFailed(false);
      }
    } catch {
      // Antes se conservaba la serie vieja en silencio: la gráfica seguía
      // pintando otro rango como si fuera el pedido. Ahora se declara.
      if (id === reqId.current && mountedRef.current) {
        setData(EMPTY);
        setFailed(true);
      }
    } finally {
      if (id === reqId.current && mountedRef.current) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sigue al toggle de periodo del home (day→hoy, month→mes, year→anio;
  // "quarter" no tiene gráfica propia y se queda en el mes en curso).
  useEffect(() => {
    void loadRange(rangeForPeriod(period));
  }, [period, loadRange]);

  const elapsedBuckets = useMemo(
    () => Math.max(1, data.series.filter((p) => !p.future).length),
    [data.series],
  );

  const broken = failed || data.degraded;
  const showChart = !broken && data.total > 0 && data.series.length > 0;

  return (
    <HomeSection
      title={t("home.revenueTrend.title")}
      subtitle={t(active.subtitleKey)}
      action={
        <div
          role="tablist"
          aria-label={t("home.revenueTrend.rangeAriaLabel")}
          className="segment-new"
        >
          {RANGES.map((r) => {
            const isActive = r.value === range;
            return (
              <button
                key={r.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`segment-new__btn ${isActive ? "segment-new__btn--active" : ""}`}
                onClick={() => loadRange(r.value)}
              >
                {t(r.labelKey)}
              </button>
            );
          })}
        </div>
      }
      noPad
    >
      <div style={{ position: "relative" }}>
        {/* Total del rango: es, por construcción, el mismo número del KPI. */}
        <div style={{ padding: "0 20px 4px" }}>
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              color: "var(--text-1)",
              fontVariantNumeric: "tabular-nums",
              opacity: broken ? 0.35 : 1,
            }}
          >
            {broken ? "—" : money(data.total)}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              marginTop: 4,
              minHeight: 17,
            }}
          >
            {broken
              ? t("home.revenueTrend.errorHint")
              : `${t("home.revenueTrend.payments", { count: data.count })} · ${t(
                  "home.revenueTrend.avgPer",
                  {
                    amount: money(Math.round(data.total / elapsedBuckets)),
                    unit: t(active.unitKey),
                  },
                )}`}
          </div>
        </div>

        <div style={{ padding: "10px 18px 18px" }}>
          {!loadedOnce ? (
            <ChartSkeleton />
          ) : broken ? (
            <EmptyBox
              icon={<AlertCircle size={18} strokeWidth={1.75} aria-hidden />}
              title={t("home.revenueTrend.errorTitle")}
              hint={t("home.revenueTrend.errorHint")}
              tone="danger"
            />
          ) : showChart ? (
            <div
              style={{
                opacity: loading ? 0.45 : 1,
                transition: "opacity var(--dur-1) var(--ease)",
              }}
            >
              <RevenueAreaChart data={data.series} />
            </div>
          ) : (
            <EmptyBox
              icon={<TrendingUp size={18} strokeWidth={1.75} aria-hidden />}
              title={t("home.revenueTrend.emptyTitle")}
              hint={t("home.revenueTrend.emptyHint")}
            />
          )}
        </div>

        {loading && loadedOnce && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 18,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--text-3)",
                background: "var(--bg-elev)",
                border: "1px solid var(--border-soft)",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              {t("home.revenueTrend.updating")}
            </span>
          </div>
        )}
      </div>
    </HomeSection>
  );
}

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

/**
 * Estado vacío REAL. Antes una serie de puros ceros se dibujaba como una línea
 * plana pegada al eje: el usuario leía "la gráfica está rota", no "no hubo
 * cobros". El texto explica además QUÉ cuenta la gráfica (pagos con fecha de
 * cobro, no facturas emitidas), que era la otra mitad de la confusión.
 */
function EmptyBox({
  icon,
  title,
  hint,
  tone,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  tone?: "danger";
}) {
  const color = tone === "danger" ? "var(--danger)" : "var(--text-3)";
  const bg = tone === "danger" ? "var(--danger-soft)" : "var(--bg-elev-2)";
  return (
    <div
      style={{
        height: 260,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        textAlign: "center",
        padding: "0 24px",
        borderRadius: 12,
        background: "var(--bg-elev-2)",
        border: "1px dashed var(--border-soft)",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: bg,
          color,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 320, lineHeight: 1.45 }}>
        {hint}
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div
      style={{
        height: 260,
        background: "var(--bg-elev-2)",
        borderRadius: 12,
        opacity: 0.5,
      }}
      aria-hidden
    />
  );
}
