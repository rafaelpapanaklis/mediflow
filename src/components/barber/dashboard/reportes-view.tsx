"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Download, Receipt, Scissors, Table2, Wallet } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { ReportsSummary } from "@/lib/barber/stats";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtDateTime, fmtHour, fmtInt, fmtMediumDay, fmtMoney, fmtPct, fmtPctSigned, fmtShortDay } from "./format";
import { RevenueChart } from "./revenue-chart";
import { Heatmap } from "./heatmap";
import { ItemBars, PaymentsBar } from "./bars";
import type { BranchOption } from "./branch-select";

export interface BarberOption {
  id: string;
  label: string;
}

const RANGES: Array<"today" | "week" | "month" | "custom"> = ["today", "week", "month", "custom"];

/**
 * /barber/reportes — vista de cliente. TODO el dinero ya viene calculado del
 * servidor (getReportsSummary); aquí solo se pinta y se navega. Los filtros
 * viven en la URL (range/from/to/branch/barber) para que un reporte se pueda
 * compartir por liga y para que el CSV salga de la MISMA lectura.
 */
export function ReportesView({
  dict,
  summary: s,
  locale,
  branches,
  barbers,
  currentBranch,
  currentBarber,
}: {
  dict: Dictionary;
  summary: ReportsSummary;
  locale: string;
  branches: BranchOption[];
  barbers: BarberOption[];
  /** "all", id de sede o "" (la de la sesión). */
  currentBranch: string;
  /** id del barbero filtrado o "". */
  currentBarber: string;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [from, setFrom] = useState(s.period.from);
  const [to, setTo] = useState(s.period.to);
  const [customOpen, setCustomOpen] = useState(s.period.key === "custom");
  const tz = s.timezone;

  function buildQuery(next: Partial<Record<"range" | "from" | "to" | "branch" | "barber", string>>, apiNames = false): string {
    const p = new URLSearchParams();
    const range = next.range ?? s.period.key;
    p.set("range", range);
    if (range === "custom") {
      p.set("from", next.from ?? s.period.from);
      p.set("to", next.to ?? s.period.to);
    }
    const branch = next.branch !== undefined ? next.branch : currentBranch;
    if (branch) p.set(apiNames ? "branchId" : "branch", branch);
    const barber = next.barber !== undefined ? next.barber : currentBarber;
    if (barber) p.set(apiNames ? "barberId" : "barber", barber);
    return p.toString();
  }
  const go = (next: Parameters<typeof buildQuery>[0]) => router.push(`/barber/reportes?${buildQuery(next)}`);
  const csvHref = `/api/barber/stats/reports?${buildQuery({}, true)}&format=csv`;

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`weekdays.${i}`));
  const weekdaysLong = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`weekdaysLong.${i}`));
  const methodLabels: Record<string, string> = {
    CASH: t("methods.CASH"),
    CARD: t("methods.CARD"),
    SPEI: t("methods.SPEI"),
    STRIPE: t("methods.STRIPE"),
  };

  const vsPrev = s.totals.vsPrevPct;
  const revenueDelta =
    vsPrev === null
      ? undefined
      : { value: fmtPctSigned(vsPrev, locale), direction: vsPrev >= 0 ? ("up" as const) : ("down" as const), sub: t("kpi.vsPrev") };

  const periodLabel =
    s.period.from === s.period.to
      ? fmtMediumDay(s.period.from, locale)
      : `${fmtShortDay(s.period.from, locale)} – ${fmtMediumDay(s.period.to, locale)} · ${t("period.days", { count: s.period.days })}`;

  const hasSales = s.totals.tickets > 0;
  const occ = s.occupancy;
  const noSchedule = occ.openHours.every((h) => h !== null) && occ.openHours.every((h) => h && h.from === occ.openHours[0]!.from && h.to === occ.openHours[0]!.to);

  return (
    <div className="bdash-page">
      <div className="bdash-head">
        <div>
          <h1 className="bdash-head__title">{t("title")}</h1>
          <p className="bdash-head__sub">{t("subtitle")}</p>
        </div>
        <div className="bdash-head__actions">
          <a href={csvHref} className="btn-new btn-new--secondary btn-new--sm bdash-btn-icon" download>
            <Download size={14} aria-hidden /> {t("export")}
          </a>
        </div>
      </div>

      {s.scope.selfOnly && <div className="bdash-note">{s.scope.barberLinked ? t("selfOnly") : t("noBarberLinked")}</div>}

      {/* Una sola fila de filtros, arriba de todo: todo lo de abajo obedece a la misma rebanada. */}
      <div className="bdash-filters">
        <span className="bdash-filters__label">{t("period.label")}</span>
        <div className="bdash-seg" role="group" aria-label={t("period.label")}>
          {RANGES.map((r) => (
            <button
              type="button"
              key={r}
              className={`bdash-seg__btn${s.period.key === r ? " bdash-seg__btn--on" : ""}`}
              aria-pressed={s.period.key === r}
              onClick={() => {
                if (r === "custom") {
                  setCustomOpen(true);
                  return;
                }
                setCustomOpen(false);
                go({ range: r });
              }}
            >
              {t(`period.${r}`)}
            </button>
          ))}
        </div>
        {customOpen && (
          <form
            className="bdash-dates"
            onSubmit={(e) => {
              e.preventDefault();
              go({ range: "custom", from, to });
            }}
          >
            <label className="bdash-filters__label" htmlFor="bdash-from">
              {t("period.from")}
            </label>
            <input id="bdash-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
            <label className="bdash-filters__label" htmlFor="bdash-to">
              {t("period.to")}
            </label>
            <input id="bdash-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
            <button type="submit" className="btn-new btn-new--sm barber-btn-primary">
              {t("period.apply")}
            </button>
          </form>
        )}
        {s.scope.canConsolidate && branches.length > 1 && (
          <select className="bdash-select" value={currentBranch} aria-label={t("branch.label")} onChange={(e) => go({ branch: e.target.value })}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
            <option value="all">{t("branch.all")}</option>
          </select>
        )}
        {!s.scope.selfOnly && barbers.length > 1 && (
          <select className="bdash-select" value={currentBarber} aria-label={t("barber.label")} onChange={(e) => go({ barber: e.target.value })}>
            <option value="">{t("barber.all")}</option>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        )}
        <span className="bdash-filters__spacer" />
        <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>{periodLabel}</span>
      </div>

      <div className="bdash-kpis">
        <KpiCard label={t("kpi.revenue")} value={fmtMoney(s.totals.revenue)} icon={Wallet} hero hint={t("kpi.revenueHint")} delta={revenueDelta} />
        <KpiCard label={t("kpi.tickets")} value={fmtInt(s.totals.tickets, locale)} icon={Receipt} />
        <KpiCard label={t("kpi.avgTicket")} value={s.totals.avgTicket === null ? "—" : fmtMoney(s.totals.avgTicket)} icon={BarChart3} />
        <KpiCard label={t("kpi.tips")} value={fmtMoney(s.totals.tips)} icon={Scissors} hint={`${t("kpi.total")}: ${fmtMoney(s.totals.total)}`} />
      </div>

      {/* Ingresos por día */}
      <CardNew
        title={t("revenue.title")}
        sub={t("revenue.sub")}
        action={
          hasSales ? (
            <div className="bdash-card-actions">
              <button
                type="button"
                className="btn-new btn-new--ghost btn-new--sm bdash-btn-icon"
                onClick={() => setView(view === "chart" ? "table" : "chart")}
                aria-pressed={view === "table"}
              >
                {view === "chart" ? <Table2 size={14} aria-hidden /> : <BarChart3 size={14} aria-hidden />}
                {view === "chart" ? t("revenue.table") : t("revenue.chart")}
              </button>
            </div>
          ) : undefined
        }
        noPad={view === "table" && hasSales}
      >
        {!hasSales ? (
          <div className="bdash-empty">{t("revenue.empty")}</div>
        ) : view === "chart" ? (
          <RevenueChart
            rows={s.byDay}
            locale={locale}
            labels={{
              services: t("revenue.services"),
              products: t("revenue.products"),
              tips: t("revenue.tips"),
              discounts: t("revenue.discounts"),
              tickets: t("revenue.tickets"),
              total: t("revenue.total"),
              week: t("revenue.week"),
            }}
          />
        ) : (
          <div className="bdash-table-wrap">
            <table className="table-new">
              <thead>
                <tr>
                  <th>{t("period.label")}</th>
                  <th className="bdash-num">{t("revenue.tickets")}</th>
                  <th className="bdash-num">{t("revenue.services")}</th>
                  <th className="bdash-num">{t("revenue.products")}</th>
                  <th className="bdash-num">{t("revenue.tips")}</th>
                  <th className="bdash-num">{t("revenue.discounts")}</th>
                  <th className="bdash-num">{t("kpi.revenue")}</th>
                  <th className="bdash-num">{t("revenue.total")}</th>
                </tr>
              </thead>
              <tbody>
                {s.byDay.map((d) => (
                  <tr key={d.day}>
                    <td>{fmtMediumDay(d.day, locale)}</td>
                    <td className="bdash-num">{fmtInt(d.tickets, locale)}</td>
                    <td className="bdash-num">{fmtMoney(d.services)}</td>
                    <td className="bdash-num">{fmtMoney(d.products)}</td>
                    <td className="bdash-num">{fmtMoney(d.tips)}</td>
                    <td className="bdash-num">{d.discounts > 0 ? `−${fmtMoney(d.discounts)}` : "—"}</td>
                    <td className="bdash-num">{fmtMoney(d.revenue)}</td>
                    <td className="bdash-num">{fmtMoney(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      <div className="bdash-grid bdash-grid--even">
        {/* Por barbero */}
        <CardNew title={t("barbers.title")} noPad={s.byBarber.length > 0}>
          {s.byBarber.length === 0 ? (
            <div className="bdash-empty">{t("barbers.empty")}</div>
          ) : (
            <div className="bdash-table-wrap">
              <table className="table-new">
                <thead>
                  <tr>
                    <th>{t("barbers.colBarber")}</th>
                    <th className="bdash-num">{t("barbers.colTickets")}</th>
                    <th className="bdash-num">{t("barbers.colProduced")}</th>
                    <th className="bdash-num">{t("barbers.colAvg")}</th>
                    <th className="bdash-num">{t("barbers.colTips")}</th>
                    {s.can.commissions && <th className="bdash-num">{t("barbers.colCommission")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {s.byBarber.map((b) => (
                    <tr key={b.barberId}>
                      <td>
                        {b.nickname || b.name}
                        {!b.isActive && (
                          <>
                            {" "}
                            <BadgeNew tone="neutral">{t("barbers.inactive")}</BadgeNew>
                          </>
                        )}
                      </td>
                      <td className="bdash-num">{fmtInt(b.tickets, locale)}</td>
                      <td className="bdash-num">{fmtMoney(b.produced)}</td>
                      <td className="bdash-num">{b.avgTicket === null ? "—" : fmtMoney(b.avgTicket)}</td>
                      <td className="bdash-num">{fmtMoney(b.tips)}</td>
                      {s.can.commissions && <td className="bdash-num">{b.commission === null ? "—" : fmtMoney(b.commission)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardNew>

        {/* Métodos de pago */}
        <CardNew title={t("payments.title")}>
          {s.payments.every((p) => p.count === 0) ? (
            <div className="bdash-empty">{t("payments.empty")}</div>
          ) : (
            <PaymentsBar payments={s.payments} locale={locale} methodLabels={methodLabels} ticketsLabel={t("payments.colTickets").toLowerCase()} />
          )}
        </CardNew>
      </div>

      <div className="bdash-grid bdash-grid--even">
        <CardNew title={t("items.servicesTitle")}>
          {s.topServices.length === 0 ? (
            <div className="bdash-empty">{t("items.empty")}</div>
          ) : (
            <ItemBars
              items={s.topServices.slice(0, 8)}
              locale={locale}
              kind="service"
              qtyLabel={t("items.colQty")}
              shareLabel={t("items.colShare")}
              marginLabel={t("items.colMargin")}
              noCostLabel={t("items.noCost")}
            />
          )}
        </CardNew>
        {s.can.products && (
          <CardNew title={t("items.productsTitle")} sub={t("items.marginHint")}>
            {s.topProducts.length === 0 ? (
              <div className="bdash-empty">{t("items.empty")}</div>
            ) : (
              <ItemBars
                items={s.topProducts.slice(0, 8)}
                locale={locale}
                kind="product"
                qtyLabel={t("items.colQty")}
                shareLabel={t("items.colShare")}
                marginLabel={t("items.colMargin")}
                noCostLabel={t("items.noCost")}
              />
            )}
          </CardNew>
        )}
      </div>

      {/* Horas muertas */}
      <CardNew title={t("occupancy.title")} sub={t("occupancy.sub")}>
        {occ.totalVisits === 0 && occ.deadSlots.length === 0 ? (
          <div className="bdash-empty">{t("occupancy.empty")}</div>
        ) : (
          <>
            <Heatmap
              occ={occ}
              weekdays={weekdays}
              weekdaysLong={weekdaysLong}
              visitsLabel={(n) => t("occupancy.visits", { count: n })}
              closedLabel={t("occupancy.closed")}
              deadLabel={t("occupancy.dead")}
              lowLabel={t("occupancy.legendLow")}
              highLabel={t("occupancy.legendHigh")}
            />
            <div className="bdash-foot">
              <span>
                {t("occupancy.deadSummary", { count: occ.deadSlots.length, open: occ.openSlots })}
                {noSchedule && occ.openHours[0] ? ` · ${t("occupancy.noSchedule", { from: occ.openHours[0].from, to: occ.openHours[0].to })}` : ""}
              </span>
              {occ.peak.length > 0 && (
                <span>
                  {t("occupancy.peak")}:{" "}
                  {occ.peak.map((p) => `${weekdays[p.dow]} ${fmtHour(p.hour)} (${p.visits})`).join(" · ")}
                </span>
              )}
            </div>
          </>
        )}
      </CardNew>

      <div className="bdash-grid bdash-grid--even">
        {/* No-shows */}
        <CardNew title={t("noShows.title")}>
          <div className="bdash-stats">
            <div className="bdash-stat">
              <div className="bdash-stat__label">{t("noShows.count")}</div>
              <div className="bdash-stat__value">{fmtInt(s.noShows.count, locale)}</div>
            </div>
            <div className="bdash-stat">
              <div className="bdash-stat__label">{t("noShows.rate")}</div>
              <div className="bdash-stat__value">{s.noShows.rate === null ? "—" : fmtPct(s.noShows.rate)}</div>
              <div className="bdash-stat__hint">{t("noShows.rateHint")}</div>
            </div>
            <div className="bdash-stat">
              <div className="bdash-stat__label">{t("noShows.done")}</div>
              <div className="bdash-stat__value">{fmtInt(s.noShows.done, locale)}</div>
            </div>
            <div className="bdash-stat">
              <div className="bdash-stat__label">{t("noShows.cancelled")}</div>
              <div className="bdash-stat__value">{fmtInt(s.noShows.cancelled, locale)}</div>
            </div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>{t("noShows.repeatTitle")}</div>
          {s.noShows.repeat.length === 0 ? (
            <div className="bdash-empty" style={{ textAlign: "left", padding: "6px 0 0" }}>
              {t("noShows.repeatEmpty")}
            </div>
          ) : (
            <div className="bdash-list" style={{ marginTop: 8 }}>
              {s.noShows.repeat.map((r) => (
                <div className="bdash-row" key={r.key} style={{ padding: "8px 10px" }}>
                  <div className="bdash-row__main">
                    <div className="bdash-row__name">{r.name || t("noShows.unknown")}</div>
                    <div className="bdash-row__meta">
                      {r.phone ?? "—"}
                      {r.lastAt ? ` · ${t("noShows.last", { date: fmtDateTime(r.lastAt, tz) })}` : ""}
                    </div>
                  </div>
                  <BadgeNew tone="danger">{t("noShows.times", { count: r.count })}</BadgeNew>
                </div>
              ))}
            </div>
          )}
        </CardNew>

        {/* Retención */}
        <CardNew title={t("retention.title")} sub={t("retention.hint")}>
          <div className="bdash-stats">
            <div className="bdash-stat">
              <div className="bdash-stat__label">{t("retention.new")}</div>
              <div className="bdash-stat__value">{fmtInt(s.retention.newClients, locale)}</div>
            </div>
            <div className="bdash-stat">
              <div className="bdash-stat__label">{t("retention.returning")}</div>
              <div className="bdash-stat__value">{fmtInt(s.retention.returningClients, locale)}</div>
            </div>
            <div className="bdash-stat">
              <div className="bdash-stat__label">{t("retention.returned", { days: s.retention.windowDays })}</div>
              <div className="bdash-stat__value">
                {fmtInt(s.retention.newReturned, locale)}
                {s.retention.returnRate !== null ? (
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)", marginLeft: 6 }}>{fmtPct(s.retention.returnRate)}</span>
                ) : null}
              </div>
              <div className="bdash-stat__hint">{t("retention.returnedHint")}</div>
            </div>
          </div>
        </CardNew>
      </div>
    </div>
  );
}
