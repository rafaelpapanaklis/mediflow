"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { BadgeCheck, ChevronDown, ChevronUp, FileText, Percent, Scissors, Wallet } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CommissionEntryRow, CommissionSummary, CommissionSummaryRow } from "@/lib/barber/commissions";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BarberModal } from "@/components/barber/cash/modal";
import { PeriodNav } from "@/components/barber/cash/period-nav";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtDateTime, fmtMoney, fmtPct, fmtPeriod, fmtSigned } from "@/components/barber/cash/money";

const STATUS_TONE: Record<CommissionSummaryRow["paidStatus"], "neutral" | "warning" | "info" | "success"> = {
  EMPTY: "neutral",
  PENDING: "warning",
  PARTIAL: "info",
  PAID: "success",
};

export function ComisionesClient({
  dict,
  locale,
  summary,
  maxPeriod,
  canManage,
  noBarberLinked,
}: {
  dict: Dictionary;
  locale: string;
  summary: CommissionSummary;
  maxPeriod: string;
  canManage: boolean;
  noBarberLinked: boolean;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, CommissionEntryRow[] | "loading">>({});
  const [payRow, setPayRow] = useState<CommissionSummaryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const tz = summary.timezone;

  function goPeriod(p: string) {
    router.push(`/barber/comisiones?period=${p}`);
  }

  async function toggle(row: CommissionSummaryRow) {
    if (expanded === row.barberId) {
      setExpanded(null);
      return;
    }
    setExpanded(row.barberId);
    if (!entries[row.barberId]) {
      setEntries((e) => ({ ...e, [row.barberId]: "loading" }));
      try {
        const res = await fetch(`/api/barber/commissions/entries?period=${summary.periodKey}&barberId=${row.barberId}`);
        const data = (await res.json()) as { entries?: CommissionEntryRow[] };
        setEntries((e) => ({ ...e, [row.barberId]: data.entries ?? [] }));
      } catch {
        setEntries((e) => ({ ...e, [row.barberId]: [] }));
      }
    }
  }

  async function confirmPay() {
    if (!payRow || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/barber/commissions/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barberId: payRow.barberId, periodKey: summary.periodKey }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("common.error"));
        return;
      }
      toast.success(t("comisiones.markedPaid"));
      setPayRow(null);
      setEntries({});
      router.refresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const schemeLabel = (r: CommissionSummaryRow) =>
    r.commissionType === "COMMISSION" ? t("comisiones.schemeCOMMISSION", { pct: r.commissionPct ?? 0 }) : t(`comisiones.scheme${r.commissionType}`);

  return (
    <div className="bcaja-page">
      <div className="bcaja-head">
        <div>
          <h1 className="bcaja-head__title">{t("comisiones.title")}</h1>
          <p className="bcaja-head__sub">{t("comisiones.subtitle")}</p>
        </div>
        <div className="bcaja-head__actions">
          <PeriodNav period={summary.periodKey} onChange={goPeriod} locale={locale} prevLabel={t("common.prevPeriod")} nextLabel={t("common.nextPeriod")} maxPeriod={maxPeriod} />
        </div>
      </div>

      {summary.selfOnly && <div className="bcaja-alert bcaja-alert--info">{noBarberLinked ? t("comisiones.noBarberLinked") : t("comisiones.selfOnly")}</div>}

      <div className="bcaja-kpis">
        <KpiCard label={t("comisiones.kpiProduced")} value={fmtMoney(summary.totals.produced)} icon={Scissors} hero />
        <KpiCard label={t("comisiones.kpiCommission")} value={fmtMoney(summary.totals.commissionTotal)} icon={Percent} />
        <KpiCard label={t("comisiones.kpiTips")} value={fmtMoney(summary.totals.tips)} />
        <KpiCard label={t("comisiones.kpiToPay")} value={fmtMoney(summary.totals.totalToPay)} icon={Wallet} hint={`${t("comisiones.policy")}: ${t(`comisiones.policy${summary.policy.base}`)}`} />
      </div>

      <div className="bcaja-alert bcaja-alert--info">
        <strong>{t("comisiones.policy")}:</strong> {t(`comisiones.policy${summary.policy.base}`)} · {t("comisiones.policyHint")}
      </div>

      <CardNew title={fmtPeriod(summary.periodKey, locale)} noPad>
        {summary.rows.length === 0 ? (
          <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("comisiones.empty")}</p>
        ) : (
          <div className="bcaja-table-wrap">
            <table className="table-new">
              <thead>
                <tr>
                  <th>{t("comisiones.colBarber")}</th>
                  <th>{t("comisiones.colScheme")}</th>
                  <th className="bcaja-num">{t("comisiones.colTickets")}</th>
                  <th className="bcaja-num">{t("comisiones.colProduced")}</th>
                  <th className="bcaja-num">{t("comisiones.colBase")}</th>
                  <th className="bcaja-num">{t("comisiones.colCommission")}</th>
                  <th className="bcaja-num">{t("comisiones.colTips")}</th>
                  <th className="bcaja-num">{t("comisiones.colRent")}</th>
                  <th className="bcaja-num">{t("comisiones.colToPay")}</th>
                  <th>{t("comisiones.colStatus")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => {
                  const isOpen = expanded === r.barberId;
                  const rows = entries[r.barberId];
                  return (
                    <RowGroup key={r.barberId}>
                      <tr>
                        <td>
                          <strong>{r.nickname || r.barberName}</strong>
                          {!r.isActive && <span className="bcaja-muted"> · {t("comisiones.inactive")}</span>}
                        </td>
                        <td>{schemeLabel(r)}</td>
                        <td className="bcaja-num">{r.ticketCount}</td>
                        <td className="bcaja-num">{fmtMoney(r.produced)}</td>
                        <td className="bcaja-num">{fmtMoney(r.commissionBase)}</td>
                        <td className="bcaja-num">{fmtMoney(r.commissionTotal)}</td>
                        <td className="bcaja-num">{fmtMoney(r.tips)}</td>
                        <td className="bcaja-num">{r.chairRent === null ? "—" : `−${fmtMoney(r.chairRent)}`}</td>
                        <td className="bcaja-num"><strong style={{ color: r.totalToPay < 0 ? "var(--danger)" : undefined }}>{fmtSigned(r.totalToPay)}</strong></td>
                        <td><BadgeNew tone={STATUS_TONE[r.paidStatus]} dot>{t(`comisiones.status${r.paidStatus}`)}</BadgeNew></td>
                        <td>
                          <span className="bcaja-row-actions">
                            <button type="button" className="icon-btn-new" onClick={() => toggle(r)} aria-label={isOpen ? t("comisiones.hideDetail") : t("comisiones.detail")} title={isOpen ? t("comisiones.hideDetail") : t("comisiones.detail")}>
                              {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                            <Link href={`/barber/comisiones/recibo/${r.barberId}?period=${summary.periodKey}`} className="icon-btn-new" aria-label={t("comisiones.receipt")} title={t("comisiones.receipt")}>
                              <FileText size={13} />
                            </Link>
                            {canManage && r.paidStatus !== "PAID" && r.paidStatus !== "EMPTY" && (
                              <button type="button" className="icon-btn-new" onClick={() => setPayRow(r)} aria-label={t("comisiones.markPaid")} title={t("comisiones.markPaid")}>
                                <BadgeCheck size={13} />
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} style={{ background: "var(--bg-elev-2)", whiteSpace: "normal" }}>
                            {r.commissionType === "SALARY" && <div className="bcaja-hint" style={{ marginBottom: 8 }}>{t("comisiones.salaryNote")}</div>}
                            {r.commissionType === "CHAIR_RENT" && r.totalToPay < 0 && <div className="bcaja-hint" style={{ marginBottom: 8, color: "var(--danger)" }}>{t("comisiones.rentNegative")}</div>}
                            {rows === "loading" || !rows ? (
                              <span className="bcaja-hint">{t("common.loading")}</span>
                            ) : rows.length === 0 ? (
                              <span className="bcaja-hint">{t("comisiones.entriesEmpty")}</span>
                            ) : (
                              <table className="table-new">
                                <thead>
                                  <tr>
                                    <th>{t("comisiones.entryDate")}</th>
                                    <th>{t("comisiones.entryClient")}</th>
                                    <th>{t("comisiones.entryItems")}</th>
                                    <th className="bcaja-num">{t("comisiones.entryBase")}</th>
                                    <th className="bcaja-num">{t("comisiones.entryPct")}</th>
                                    <th className="bcaja-num">{t("comisiones.entryAmount")}</th>
                                    <th className="bcaja-num">{t("comisiones.entryTip")}</th>
                                    <th>{t("comisiones.entryPaid")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((e) => (
                                    <tr key={e.id}>
                                      <td>{fmtDateTime(e.createdAt, tz)}</td>
                                      <td>{e.clientName ?? "—"}</td>
                                      <td style={{ whiteSpace: "normal" }}>{e.itemsSummary ?? "—"}</td>
                                      <td className="bcaja-num">{fmtMoney(e.base)}</td>
                                      <td className="bcaja-num">{fmtPct(e.pct)}</td>
                                      <td className="bcaja-num">{fmtMoney(e.amount)}</td>
                                      <td className="bcaja-num">{fmtMoney(e.saleTip)}</td>
                                      <td>{e.paidAt ? <BadgeNew tone="success">{fmtDateTime(e.paidAt, tz)}</BadgeNew> : <BadgeNew tone="warning">{t("comisiones.statusPENDING")}</BadgeNew>}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </RowGroup>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      {payRow && (
        <BarberModal
          open
          title={t("comisiones.markPaidTitle")}
          onClose={() => setPayRow(null)}
          closeLabel={t("common.close")}
          footer={
            <>
              <button type="button" className="btn-new btn-new--ghost" onClick={() => setPayRow(null)} disabled={busy}>{t("common.cancel")}</button>
              <button type="button" className="btn-new barber-btn-primary" onClick={confirmPay} disabled={busy}>{busy ? t("common.saving") : t("comisiones.markPaidConfirm")}</button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>
            {t("comisiones.markPaidBody", { name: payRow.nickname || payRow.barberName, period: fmtPeriod(summary.periodKey, locale), amount: fmtMoney(payRow.commissionPending) })}
          </p>
        </BarberModal>
      )}
    </div>
  );
}

/** Fragment con key para agrupar la fila y su detalle dentro del tbody. */
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
