"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/cobranza — qué se cobra este mes, qué se pagó y qué está
// vencido, con semáforo por antigüedad del saldo.
//
// Cuatro pestañas: los cobros del mes, los recordatorios escalonados, la
// bandeja de mantenimiento y los gastos del inmueble. Todo lo que mueve
// dinero de una renta cabe en una pantalla.
//
// 🔴 EL PLAN PROPIETARIO ($199) NO TIENE WHATSAPP. La pestaña de
// recordatorios lo dice sin ambigüedad: en ese plan los avisos salen por
// CORREO y como pendiente aquí. Nadie debe llegar esperando lo que no
// compró.
//
// i18n CONVENCIÓN B: sub-árbol ya recortado, prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Receipt,
  RefreshCw,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  REALTY_AGING_ORDER,
  REALTY_REMINDER_STEPS,
  addMonthKey,
  centsToNumber,
  formatCents,
  formatMoney,
  formatShortDate,
  monthLabel,
  type RealtyAgingKey,
} from "@/lib/realty/rent-charges";
import type { RealtyChargeStatus, RealtyCurrency } from "@/lib/realty/types";
import { Card, EmptyState, Kpi, Note, Pill, Tabs, type Tone } from "./ui";
import { PaymentForm, type PaymentTarget } from "./payment-form";
import { MaintenancePanel, type MaintenanceRow } from "./maintenance-panel";
import { ExpensesPanel, type ExpenseRow } from "./expenses-panel";
import "./rentals.css";

export interface CollectionRowView {
  id: string;
  leaseId: string;
  propertyId: string;
  propertyTitle: string;
  tenantName: string;
  tenantPhone: string | null;
  periodMonth: string;
  periodLabel: string;
  dueAt: string;
  amount: number;
  paid: number;
  balance: number;
  status: RealtyChargeStatus;
  daysLate: number;
  aging: RealtyAgingKey;
  currency: RealtyCurrency;
}

export interface BoardTotals {
  chargedCents: number;
  paidCents: number;
  balanceCents: number;
  overdueCents: number;
  count: number;
  paidCount: number;
  overdueCount: number;
  byAging: Record<RealtyAgingKey, { count: number; balanceCents: number }>;
}

export interface NoticePreview {
  key: string;
  contactName: string;
  propertyTitle: string;
  periodLabel: string;
  step: string;
  tone: string;
  balanceCents: number;
  currency: RealtyCurrency;
  channels: string[];
  hasEmail: boolean;
}

type TabKey = "charges" | "reminders" | "maintenance" | "expenses";

const CHARGE_TONE: Record<RealtyChargeStatus, Tone> = {
  PENDIENTE: "info",
  PARCIAL: "warning",
  PAGADO: "success",
  VENCIDO: "danger",
};

const AGING_CELL: Record<RealtyAgingKey, string> = {
  AL_CORRIENTE: "success",
  D1_15: "warning",
  D16_30: "warning",
  D30_MAS: "danger",
};

export function CollectionsClient({
  dict,
  periodMonth,
  rows,
  totals,
  notices,
  maintenance,
  expenses,
  properties,
  planHasWhatsapp,
  todayISO,
  canCollect,
  canMaintain,
  canExpenses,
}: {
  dict: Dictionary;
  periodMonth: string;
  rows: CollectionRowView[];
  totals: BoardTotals;
  notices: NoticePreview[];
  maintenance: MaintenanceRow[];
  expenses: { rows: ExpenseRow[]; totalCents: number };
  properties: Array<{ id: string; title: string }>;
  planHasWhatsapp: boolean;
  todayISO: string;
  canCollect: boolean;
  canMaintain: boolean;
  canExpenses: boolean;
}) {
  const t = makeRealtyT(dict);
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("charges");
  const [aging, setAging] = useState<RealtyAgingKey | null>(null);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () => (aging === null ? rows : rows.filter((r) => r.aging === aging)),
    [rows, aging],
  );

  function goMonth(delta: number) {
    const next = addMonthKey(periodMonth, delta);
    router.push(`/inmobiliaria/cobranza?periodo=${next}`);
  }

  async function sweep() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/realty/leases/barrido", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("common.genericError")));
        return;
      }
      toast.success(
        t("collections.sweepDone", {
          charges: Number(data?.chargesCreated ?? 0),
          notices: Number(data?.notices ?? 0),
        }),
      );
      router.refresh();
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rnt">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{t("collections.title")}</h1>
            <p className="rnt-head__sub">{t("collections.subtitle")}</p>
          </div>
          <div className="rnt-head__actions">
            <button
              type="button"
              className="rnt-btn rnt-btn--sm"
              onClick={() => goMonth(-1)}
              aria-label={t("collections.month.prev")}
            >
              <ChevronLeft size={14} />
            </button>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--text-1)",
                minWidth: 140,
                textAlign: "center",
              }}
            >
              {monthLabel(periodMonth)}
            </span>
            <button
              type="button"
              className="rnt-btn rnt-btn--sm"
              onClick={() => goMonth(1)}
              aria-label={t("collections.month.next")}
            >
              <ChevronRight size={14} />
            </button>
            {canCollect ? (
              <button
                type="button"
                className="rnt-btn rnt-btn--sm rnt-btn--primary"
                onClick={sweep}
                disabled={busy}
                title={t("collections.sweepHint")}
              >
                <RefreshCw size={13} />
                {busy ? t("common.saving") : t("collections.sweep")}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="rnt-kpis">
        <Kpi
          label={t("collections.kpi.charged")}
          value={formatCents(totals.chargedCents)}
          hint={t("collections.kpi.chargedHint")}
        />
        <Kpi
          label={t("collections.kpi.collected")}
          value={formatCents(totals.paidCents)}
          hint={t("collections.kpi.collectedHint")}
          tone="good"
        />
        <Kpi
          label={t("collections.kpi.balance")}
          value={formatCents(totals.balanceCents)}
          hint={t("collections.kpi.balanceHint")}
          tone={totals.balanceCents > 0 ? "danger" : "good"}
        />
        <Kpi
          label={t("collections.kpi.overdue")}
          value={formatCents(totals.overdueCents)}
          hint={t("collections.kpi.overdueHint")}
          tone={totals.overdueCents > 0 ? "danger" : undefined}
        />
      </div>

      <Card title={t("collections.aging.title")}>
        <div className="rnt-aging">
          {REALTY_AGING_ORDER.map((key) => {
            const cell = totals.byAging[key] ?? { count: 0, balanceCents: 0 };
            return (
              <button
                key={key}
                type="button"
                className={`rnt-aging__cell rnt-aging__cell--${AGING_CELL[key]}`}
                aria-pressed={aging === key}
                onClick={() => setAging(aging === key ? null : key)}
              >
                <div className="rnt-aging__label">{t(`collections.aging.${key}`)}</div>
                <div className="rnt-aging__value">{formatCents(cell.balanceCents)}</div>
                <div className="rnt-aging__count">
                  {cell.count} {t("collections.aging.chargesWord")}
                </div>
              </button>
            );
          })}
        </div>
        {aging !== null ? (
          <div className="rnt-toolbar" style={{ marginTop: 10 }}>
            <button type="button" className="rnt-btn rnt-btn--sm" onClick={() => setAging(null)}>
              {t("collections.aging.showAll")}
            </button>
          </div>
        ) : null}
      </Card>

      <Tabs<TabKey>
        label={t("collections.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "charges", label: t("collections.tabs.charges"), count: rows.length },
          { key: "reminders", label: t("collections.tabs.reminders"), count: notices.length },
          { key: "maintenance", label: t("collections.tabs.maintenance"), count: maintenance.length },
          { key: "expenses", label: t("collections.tabs.expenses"), count: expenses.rows.length },
        ]}
      />

      {tab === "charges" ? (
        <Card flush>
          {visible.length === 0 ? (
            aging !== null ? (
              <EmptyState
                title={t("collections.emptyFiltered.title")}
                body={t("collections.emptyFiltered.body")}
              />
            ) : (
              <EmptyState title={t("collections.empty.title")} body={t("collections.empty.body")} />
            )
          ) : (
            <div className="rnt-tablewrap">
              <table className="rnt-table">
                <thead>
                  <tr>
                    <th>{t("collections.table.property")}</th>
                    <th className="rnt-hide-xs">{t("collections.table.tenant")}</th>
                    <th className="rnt-hide-sm">{t("collections.table.dueAt")}</th>
                    <th className="num">{t("collections.table.amount")}</th>
                    <th className="num">{t("collections.table.balance")}</th>
                    <th>{t("collections.table.status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link
                          href={`/inmobiliaria/rentas/${r.leaseId}`}
                          className="rnt-strong"
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          {r.propertyTitle}
                        </Link>
                        <div className="rnt-muted">{r.periodLabel}</div>
                      </td>
                      <td className="rnt-hide-xs">
                        <div>{r.tenantName}</div>
                        {r.tenantPhone ? <div className="rnt-muted">{r.tenantPhone}</div> : null}
                      </td>
                      <td className="rnt-hide-sm">
                        <div>{formatShortDate(r.dueAt)}</div>
                        {r.balance > 0 && r.daysLate > 0 ? (
                          <div className="rnt-muted">
                            {t("charges.lateDays", { count: r.daysLate })}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{formatMoney(r.amount, r.currency)}</td>
                      <td
                        className="num rnt-strong"
                        style={{ color: r.balance > 0 ? "var(--danger)" : "var(--text-3)" }}
                      >
                        {formatMoney(r.balance, r.currency)}
                      </td>
                      <td>
                        <Pill tone={CHARGE_TONE[r.status]} dot>
                          {t(`charges.status.${r.status}`)}
                        </Pill>
                      </td>
                      <td className="num">
                        {canCollect && r.balance > 0 ? (
                          <button
                            type="button"
                            className="rnt-btn rnt-btn--sm rnt-btn--primary"
                            onClick={() =>
                              setPayTarget({
                                chargeId: r.id,
                                leaseId: r.leaseId,
                                propertyTitle: r.propertyTitle,
                                tenantName: r.tenantName,
                                periodLabel: r.periodLabel,
                                amount: r.amount,
                                paid: r.paid,
                                balance: r.balance,
                                currency: r.currency,
                              })
                            }
                          >
                            {t("charges.pay")}
                          </button>
                        ) : r.balance <= 0 ? (
                          <Link
                            href={`/inmobiliaria/rentas/${r.leaseId}`}
                            className="rnt-btn rnt-btn--sm"
                          >
                            <Receipt size={13} />
                            {t("receipt.label")}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "reminders" ? (
        <>
          <Card title={t("reminders.title")} sub={t("reminders.subtitle")}>
            {planHasWhatsapp ? (
              <Note tone="brand">
                <MessageCircle size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                {t("reminders.planWhatsapp")}
              </Note>
            ) : (
              <Note tone="warning">
                <strong>{t("reminders.planNoWhatsapp")}</strong>
                <br />
                {t("reminders.planUpgrade")}{" "}
                <Link href="/inmobiliaria/suscripcion" style={{ color: "var(--brand)", fontWeight: 600 }}>
                  {t("reminders.planUpgradeCta")}
                </Link>
              </Note>
            )}

            <div className="rnt-steps" style={{ marginTop: 14 }}>
              {REALTY_REMINDER_STEPS.map((s) => (
                <div className="rnt-step" key={s.key}>
                  <div className="rnt-step__when">{t(`reminders.steps.${s.key}`)}</div>
                  <div className="rnt-step__tone">{t(`reminders.tone.${s.tone}`)}</div>
                  <div className="rnt-step__help">{t(`reminders.help.${s.key}`)}</div>
                </div>
              ))}
            </div>

            <p className="rnt-field__hint" style={{ marginTop: 12 }}>
              {t("reminders.cron")}
            </p>
          </Card>

          <Card title={t("reminders.queueTitle")} sub={t("reminders.queueBody")} flush>
            {notices.length === 0 ? (
              <EmptyState title={t("reminders.queueEmpty")} body={t("reminders.queueBody")} />
            ) : (
              <div className="rnt-tablewrap">
                <table className="rnt-table">
                  <thead>
                    <tr>
                      <th>{t("collections.table.tenant")}</th>
                      <th className="rnt-hide-xs">{t("collections.table.property")}</th>
                      <th>{t("charges.table.period")}</th>
                      <th className="num">{t("charges.table.balance")}</th>
                      <th>{t("reminders.channel.PANEL")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notices.map((n) => (
                      <tr key={n.key}>
                        <td>
                          <div className="rnt-strong">{n.contactName || "—"}</div>
                          <div className="rnt-muted">{t(`reminders.steps.${n.step}`)}</div>
                        </td>
                        <td className="rnt-hide-xs">{n.propertyTitle}</td>
                        <td>{n.periodLabel}</td>
                        <td className="num rnt-strong">
                          {formatMoney(centsToNumber(n.balanceCents), n.currency)}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {n.channels.map((c) => (
                              <Pill key={c} tone={c === "WHATSAPP" ? "success" : "neutral"}>
                                {t(`reminders.channel.${c}`)}
                              </Pill>
                            ))}
                          </div>
                          {!planHasWhatsapp && !n.hasEmail ? (
                            <div className="rnt-muted">{t("reminders.noEmail")}</div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}

      {tab === "maintenance" ? (
        <MaintenancePanel
          dict={dict}
          rows={maintenance}
          properties={properties}
          canEdit={canMaintain}
          canExpenses={canExpenses}
          todayISO={todayISO}
        />
      ) : null}

      {tab === "expenses" ? (
        <ExpensesPanel
          dict={dict}
          rows={expenses.rows}
          totalCents={expenses.totalCents}
          properties={properties}
          canEdit={canExpenses}
          todayISO={todayISO}
        />
      ) : null}

      {canCollect ? (
        <PaymentForm
          dict={dict}
          target={payTarget}
          todayISO={todayISO}
          onClose={() => setPayTarget(null)}
          onSaved={(res) => {
            setPayTarget(null);
            toast.success(
              res.folio
                ? t("payment.toast.savedWithReceipt", { folio: res.folio })
                : t("payment.toast.saved"),
            );
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
