"use client";

import { useEffect, useRef, useState } from "react";
import type { ReportDayRow } from "@/lib/barber/stats";
import { fmtInt, fmtLongDay, fmtMediumDay, fmtMoney, fmtMoneyCompact, fmtShortDay } from "./format";

export interface RevenueChartLabels {
  services: string;
  products: string;
  tips: string;
  discounts: string;
  tickets: string;
  total: string;
  /** "Semana del {date}" ya con el patrón; se interpola aquí. */
  week: string;
}

interface Bucket {
  key: string;
  label: string;
  title: string;
  services: number;
  products: number;
  tips: number;
  discounts: number;
  revenue: number;
  total: number;
  tickets: number;
}

const SERIES: Array<{ key: "services" | "products" | "tips"; cssVar: string; labelKey: keyof RevenueChartLabels }> = [
  { key: "services", cssVar: "var(--bdash-s1)", labelKey: "services" },
  { key: "products", cssVar: "var(--bdash-s2)", labelKey: "products" },
  { key: "tips", cssVar: "var(--bdash-s3)", labelKey: "tips" },
];

const H = 240;
const PAD_L = 56;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 28;
const GAP = 2;
const RADIUS = 4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Más de ~5 semanas de días → se agrupa por semana para que quepan las columnas. */
export function bucketize(rows: ReportDayRow[], locale: string, labels: RevenueChartLabels): Bucket[] {
  if (rows.length <= 35) {
    return rows.map((r) => ({
      key: r.day,
      label: fmtShortDay(r.day, locale),
      title: fmtLongDay(r.day, locale),
      services: r.services,
      products: r.products,
      tips: r.tips,
      discounts: r.discounts,
      revenue: r.revenue,
      total: r.total,
      tickets: r.tickets,
    }));
  }
  const out: Bucket[] = [];
  for (let i = 0; i < rows.length; i += 7) {
    const chunk = rows.slice(i, i + 7);
    const b: Bucket = {
      key: chunk[0].day,
      label: fmtShortDay(chunk[0].day, locale),
      title: labels.week.replace("{date}", fmtMediumDay(chunk[0].day, locale)),
      services: 0,
      products: 0,
      tips: 0,
      discounts: 0,
      revenue: 0,
      total: 0,
      tickets: 0,
    };
    for (const r of chunk) {
      b.services = round2(b.services + r.services);
      b.products = round2(b.products + r.products);
      b.tips = round2(b.tips + r.tips);
      b.discounts = round2(b.discounts + r.discounts);
      b.revenue = round2(b.revenue + r.revenue);
      b.total = round2(b.total + r.total);
      b.tickets += r.tickets;
    }
    out.push(b);
  }
  return out;
}

/** Tope "bonito" del eje: 1 / 2 / 2.5 / 5 / 10 × 10^n. */
function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function topRoundedPath(x: number, top: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h / 2, w / 2);
  const right = x + w;
  const bottom = top + h;
  return [
    `M ${x} ${bottom}`,
    `V ${top + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${top}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${top + r}`,
    `V ${bottom}`,
    "Z",
  ].join(" ");
}

export function RevenueChart({
  rows,
  locale,
  labels,
}: {
  rows: ReportDayRow[];
  locale: string;
  labels: RevenueChartLabels;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(280, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buckets = bucketize(rows, locale, labels);
  const n = buckets.length;
  const plotW = Math.max(40, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const maxStack = buckets.reduce((m, b) => Math.max(m, b.services + b.products + b.tips), 0);
  const yMax = niceMax(maxStack);
  const y = (v: number) => PAD_T + plotH - (v / yMax) * plotH;
  const band = plotW / Math.max(1, n);
  const barW = Math.min(24, Math.max(4, band * 0.62));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 58))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  const hovered = hover === null ? null : buckets[hover];
  const tipLeft = hover === null ? 0 : Math.min(width - 100, Math.max(100, PAD_L + band * (hover + 0.5)));

  return (
    <div className="bdash-chart" ref={ref}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={labels.total}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line className="bdash-chart__grid" x1={PAD_L} x2={PAD_L + plotW} y1={y(tv)} y2={y(tv)} />
            <text className="bdash-chart__tick" x={PAD_L - 6} y={y(tv) + 4} textAnchor="end">
              {fmtMoneyCompact(tv, locale)}
            </text>
          </g>
        ))}
        <line className="bdash-chart__axis" x1={PAD_L} x2={PAD_L + plotW} y1={y(0)} y2={y(0)} />

        {buckets.map((b, i) => {
          const x = PAD_L + band * i + (band - barW) / 2;
          let cursor = y(0);
          const segs = SERIES.map((sdef) => ({ ...sdef, value: b[sdef.key] })).filter((sdef) => sdef.value > 0);
          const last = segs.length - 1;
          return (
            <g key={b.key}>
              {segs.map((sdef, si) => {
                const h = (sdef.value / yMax) * plotH;
                const top = cursor - h;
                const node =
                  si === last && h >= RADIUS ? (
                    <path key={sdef.key} d={topRoundedPath(x, top, barW, h)} fill={sdef.cssVar} />
                  ) : (
                    <rect key={sdef.key} x={x} y={top} width={barW} height={Math.max(0.5, h)} fill={sdef.cssVar} />
                  );
                cursor = top - GAP;
                return node;
              })}
              {i % labelEvery === 0 && (
                <text className="bdash-chart__tick" x={PAD_L + band * (i + 0.5)} y={H - 8} textAnchor="middle">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Zonas de hover: la banda entera es el blanco, no la columna. */}
        {buckets.map((b, i) => (
          <rect
            key={`band-${b.key}`}
            className={`bdash-chart__band${hover === i ? " bdash-chart__band--on" : ""}`}
            x={PAD_L + band * i}
            y={PAD_T}
            width={band}
            height={plotH}
            tabIndex={0}
            aria-label={`${b.title}: ${fmtMoney(b.total)}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>

      {hovered && (
        <div className="bdash-tip" style={{ left: tipLeft }} role="status">
          <div className="bdash-tip__title">{hovered.title}</div>
          {SERIES.map((sdef) => (
            <div className="bdash-tip__row" key={sdef.key}>
              <span>
                <span className="bdash-tip__key" style={{ background: sdef.cssVar }} />
                {labels[sdef.labelKey]}
              </span>
              <strong>{fmtMoney(hovered[sdef.key])}</strong>
            </div>
          ))}
          {hovered.discounts > 0 && (
            <div className="bdash-tip__row">
              <span>{labels.discounts}</span>
              <strong>−{fmtMoney(hovered.discounts)}</strong>
            </div>
          )}
          <div className="bdash-tip__row bdash-tip__row--total">
            <span>{labels.total}</span>
            <strong>{fmtMoney(hovered.total)}</strong>
          </div>
          <div className="bdash-tip__row">
            <span>{labels.tickets}</span>
            <strong>{fmtInt(hovered.tickets, locale)}</strong>
          </div>
        </div>
      )}

      <div className="bdash-legend" aria-hidden>
        {SERIES.map((sdef) => (
          <span className="bdash-legend__key" key={sdef.key}>
            <span className="bdash-legend__swatch" style={{ background: sdef.cssVar }} />
            {labels[sdef.labelKey]}
          </span>
        ))}
      </div>
    </div>
  );
}
