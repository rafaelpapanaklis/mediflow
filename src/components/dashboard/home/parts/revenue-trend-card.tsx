"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useT } from "@/i18n/i18n-provider";
import { HomeSection } from "../home-section";

type RevenueRange = "hoy" | "semana" | "mes" | "anio";

interface SeriesPoint {
  label: string;
  value: number;
}

const RANGES: Array<{
  value: RevenueRange;
  labelKey: string;
  subtitleKey: string;
}> = [
  { value: "hoy",    labelKey: "home.revenueTrend.rangeDay",   subtitleKey: "home.revenueTrend.subtitleDay" },
  { value: "semana", labelKey: "home.revenueTrend.rangeWeek",  subtitleKey: "home.revenueTrend.subtitleWeek" },
  { value: "mes",    labelKey: "home.revenueTrend.rangeMonth", subtitleKey: "home.revenueTrend.subtitleMonth" },
  { value: "anio",   labelKey: "home.revenueTrend.rangeYear",  subtitleKey: "home.revenueTrend.subtitleYear" },
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

export function RevenueTrendCard({ initialData }: { initialData: SeriesPoint[] }) {
  const t = useT();
  const [range, setRange] = useState<RevenueRange>("mes");
  // initialData (serie SSR de 6 meses) sirve de fallback para el primer paint;
  // en cuanto monta pedimos la serie real del rango por defecto ("mes").
  const [series, setSeries] = useState<SeriesPoint[]>(initialData);
  const [loading, setLoading] = useState(true);
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
      const json = (await res.json()) as { series?: SeriesPoint[] };
      // Sólo la última petición pinta (evita carreras de clics) y sólo si
      // seguimos montados (evita setState tras desmontar).
      if (id === reqId.current && mountedRef.current && Array.isArray(json.series)) {
        setSeries(json.series);
      }
    } catch {
      // Conservamos la última serie / initialData si el fetch falla.
    } finally {
      if (id === reqId.current && mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadRange("mes");
    return () => {
      mountedRef.current = false;
    };
  }, [loadRange]);

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
      <div style={{ padding: 18, position: "relative" }}>
        {series.length === 0 ? (
          <div
            style={{
              padding: "48px 16px",
              textAlign: "center",
              color: "var(--text-2)",
              fontSize: 13,
            }}
          >
            {t("home.revenueTrend.emptyState")}
          </div>
        ) : (
          <div
            style={{
              opacity: loading ? 0.45 : 1,
              transition: "opacity var(--dur-1) var(--ease)",
            }}
          >
            <RevenueAreaChart data={series} />
          </div>
        )}

        {loading && series.length > 0 && (
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

function ChartSkeleton() {
  return (
    <div
      style={{
        height: 260,
        background: "var(--bg-elev-2)",
        borderRadius: 8,
        opacity: 0.5,
      }}
      aria-hidden
    />
  );
}
