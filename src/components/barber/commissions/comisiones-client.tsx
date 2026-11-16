"use client";

import { useState, useTransition } from "react";
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
import { splitPaid, splitToPay } from "./split-to-pay";
import { salaryLabel } from "@/lib/barber/sueldo-texto";
import "./comisiones.css";

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
  cashOut = null,
  cashIn = null,
}: {
  dict: Dictionary;
  locale: string;
  summary: CommissionSummary;
  maxPeriod: string;
  canManage: boolean;
  noBarberLinked: boolean;
  /**
   * Caja completa (ws6-t1): se puede marcar «sale de la caja en efectivo»
   * (SQL pegado + cash.withdraw). sessionOpen = hay caja abierta ahora.
   * null = no se ofrece (como antes).
   */
  cashOut?: { sessionOpen: boolean } | null;
  /**
   * Renta de silla a favor del dueño (revisión ws6-t8, N3): se puede marcar
   * «entra a la caja en efectivo» (SQL pegado + cash.expenses). null = no.
   */
  cashIn?: { sessionOpen: boolean } | null;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, CommissionEntryRow[] | "loading">>({});
  const [payRow, setPayRow] = useState<CommissionSummaryRow | null>(null);
  const [busy, setBusy] = useState(false);
  // El refresco del servidor tarda 1-5 s: mientras tanto la fila sigue diciendo PENDIENTE.
  // Se avisa «Actualizando…» y el botón de pagar espera (QA de cierre E), como en Caja.
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  // Revisión ws6-t8 (N1): con caja abierta viene MARCADA (lo normal es pagar del cajón).
  const [fromCash, setFromCash] = useState(Boolean(cashOut?.sessionOpen));
  const [toCash, setToCash] = useState(Boolean(cashIn?.sessionOpen));
  const tz = summary.timezone;

  // Presentación de las dos cifras de arriba, con lo que YA trae la pantalla
  // (cada fila ya trae su «A pagar»). No cambia ningún cálculo: solo separa lo
  // que se le debe a los barberos de lo que los de renta de silla le deben al
  // dueño. El «A pagar» por fila y el recibo siguen siendo los de siempre.
  const { toPayBarbers, rentOwed } = splitToPay(summary.rows);
  // Lo ya pagado también va partido: la renta que ya le pagaron al dueño no
  // se resta de lo que él les pagó a los barberos (QA de cierre E).
  const { paidToBarbers, rentReceived } = splitPaid(summary.rows);
  // Al dueño la tarjeta de renta le sale siempre (como hasta ahora); al
  // Barbero, solo si de verdad debe renta o ya la pagó en el periodo.
  const showRentCard = !summary.selfOnly || rentOwed > 0 || rentReceived > 0;
  const rentHint = [
    summary.selfOnly ? t("comisiones.kpiRentYouOweHint") : t("comisiones.kpiRentOwedHint"),
    ...(rentReceived > 0 ? [t(summary.selfOnly ? "comisiones.kpiRentYouPaid" : "comisiones.kpiRentReceived", { paid: fmtMoney(rentReceived) })] : []),
  ].join(" ");

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
        // expectedTotal = la cifra que se le está enseñando a quien paga. Si
        // entró un ticket nuevo entretanto, el servidor NO marca nada y avisa.
        body: JSON.stringify({ barberId: payRow.barberId, periodKey: summary.periodKey, expectedTotal: payRow.totalToPay, fromCash: fromCash && payRow.totalToPay > 0, toCash: toCash && payRow.totalToPay < 0 }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; marked?: number; paidAmount?: number };
      if (!res.ok) {
        toast.error(data.error ?? t("common.error"));
        if (data.code === "PAYOUT_CHANGED") {
          setPayRow(null);
          setEntries({});
          refresh();
        }
        return;
      }
      toast.success(
        data.marked && data.marked > 0
          ? t("comisiones.markedPaidAmount", { amount: fmtSigned(data.paidAmount ?? 0) })
          : t("comisiones.nothingToPay"),
      );
      setPayRow(null);
      setFromCash(false);
      setEntries({});
      refresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const schemeLabel = (r: CommissionSummaryRow) =>
    r.commissionType === "COMMISSION" ? t("comisiones.schemeCOMMISSION", { pct: r.commissionPct ?? 0 }) : t(`comisiones.scheme${r.commissionType}`);

  return (
    <div className="bcaja-page bd-page">
      <div className="bcaja-head">
        <div>
          <h1 className="bcaja-head__title">{t("comisiones.title")}</h1>
          <p className="bcaja-head__sub">{refreshing ? <span role="status" aria-live="polite">{t("common.updating")}</span> : t("comisiones.subtitle")}</p>
        </div>
        <div className="bcaja-head__actions">
          <PeriodNav period={summary.periodKey} onChange={goPeriod} locale={locale} prevLabel={t("common.prevPeriod")} nextLabel={t("common.nextPeriod")} maxPeriod={maxPeriod} />
        </div>
      </div>

      {summary.selfOnly && <div className="bcaja-alert bcaja-alert--info">{noBarberLinked ? t("comisiones.noBarberLinked") : t("comisiones.selfOnly")}</div>}

      {/* El Barbero (selfOnly) ve SU pantalla: «A pagarte» y «Debes de renta»
          (C-M1). Para él, la renta pendiente la debe ÉL, no «te deben»; y si
          no debe renta, esa tarjeta no sale. */}
      <div className={showRentCard ? "bcaja-kpis bcaja-kpis--5 bd-band" : "bcaja-kpis bd-band"}>
        <KpiCard label={t("comisiones.kpiProduced")} value={fmtMoney(summary.totals.produced)} icon={Scissors} hero />
        <KpiCard label={t("comisiones.kpiCommission")} value={fmtMoney(summary.totals.commissionTotal)} icon={Percent} />
        <KpiCard label={t("comisiones.kpiTips")} value={fmtMoney(summary.totals.tips)} />
        <KpiCard
          label={summary.selfOnly ? t("comisiones.kpiToPayYou") : t("comisiones.kpiToPayBarbers")}
          value={fmtMoney(toPayBarbers)}
          icon={Wallet}
          hint={t("comisiones.kpiToPayBarbersHint", { paid: fmtMoney(paidToBarbers) })}
        />
        {showRentCard && (
          <KpiCard
            label={summary.selfOnly ? t("comisiones.kpiRentYouOwe") : t("comisiones.kpiRentOwed")}
            value={fmtMoney(rentOwed)}
            hint={rentHint}
          />
        )}
      </div>

      <div className="bcaja-alert bcaja-alert--info">
        <strong>{t("comisiones.policy")}:</strong> {t(`comisiones.policy${summary.policy.base}`)} · {t("comisiones.policyHint")}
      </div>

      <CardNew title={fmtPeriod(summary.periodKey, locale)} noPad>
        {summary.rows.length === 0 ? (
          <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("comisiones.empty")}</p>
        ) : (
          <div className="bcaja-table-wrap bcom-wrap">
            <table className="table-new bcom-table">
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
                  <th className="bcaja-num">{t("comisiones.colPaid")}</th>
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
                      <tr className="bcom-row">
                        <td className="bcom-name">
                          <strong>{r.nickname || r.barberName}</strong>
                          {!r.isActive && <span className="bcaja-muted"> · {t("comisiones.inactive")}</span>}
                        </td>
                        <td data-label={t("comisiones.colScheme")}>
                          {schemeLabel(r)}
                          {/* «Sueldo del periodo» (ws6-t6): solo si cobra por Sueldo y tiene monto. */}
                          {r.salaryPeriodTotal != null && (
                            <div className="bcaja-hint" style={{ marginTop: 2 }} title={r.salaryApprox ? t("comisiones.salaryApproxHint") : undefined}>
                              {t("comisiones.salaryOfPeriod")} {fmtMoney(r.salaryPeriodTotal)}
                              {r.salaryApprox ? ` ${t("comisiones.salaryApprox")}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="bcaja-num" data-label={t("comisiones.colTickets")}>{r.ticketCount}</td>
                        <td className="bcaja-num" data-label={t("comisiones.colProduced")}>{fmtMoney(r.produced)}</td>
                        <td className="bcaja-num" data-label={t("comisiones.colBase")}>{fmtMoney(r.commissionBase)}</td>
                        <td className="bcaja-num" data-label={t("comisiones.colCommission")}>{fmtMoney(r.commissionTotal)}</td>
                        <td className="bcaja-num" data-label={t("comisiones.colTips")}>{fmtMoney(r.tips)}</td>
                        <td className="bcaja-num" data-label={t("comisiones.colRent")}>{r.chairRent === null ? "—" : `−${fmtMoney(r.chairRent)}`}</td>
                        <td className="bcaja-num" data-label={t("comisiones.colPaid")}>{r.paidTotal === 0 ? <span className="bcaja-muted">{fmtMoney(0)}</span> : fmtSigned(r.paidTotal)}</td>
                        <td className="bcaja-num" data-label={t("comisiones.colToPay")}>
                          <strong style={{ color: r.totalToPay < 0 ? "var(--danger)" : undefined }}>{fmtSigned(r.totalToPay)}</strong>
                          {/* Adelantos/vales dados desde Caja este periodo: se enseñan para descontarlos (caja completa). */}
                          {r.advances != null && r.advances > 0 && (
                            <span className="bcaja-hint" style={{ display: "block", marginTop: 2 }} data-adelantos>{t("comisiones.advances", { amount: fmtMoney(r.advances) })}</span>
                          )}
                        </td>
                        <td data-label={t("comisiones.colStatus")}><BadgeNew tone={STATUS_TONE[r.paidStatus]} dot>{t(`comisiones.status${r.paidStatus}`)}</BadgeNew></td>
                        <td className="bcom-actions">
                          <span className="bcom-acts">
                            <button type="button" className="bcom-act" onClick={() => toggle(r)} aria-expanded={isOpen}>
                              {isOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                              {isOpen ? t("comisiones.hideDetail") : t("comisiones.detail")}
                            </button>
                            <Link href={`/barber/comisiones/recibo/${r.barberId}?period=${summary.periodKey}`} className="bcom-act">
                              <FileText size={14} aria-hidden="true" />
                              {t("comisiones.receipt")}
                            </Link>
                            {canManage && r.paidStatus !== "PAID" && r.paidStatus !== "EMPTY" && (
                              <button type="button" className="bcom-act bcom-act--primary" disabled={refreshing} onClick={() => { setFromCash(Boolean(cashOut?.sessionOpen)); setToCash(Boolean(cashIn?.sessionOpen)); setPayRow(r); }}>
                                <BadgeCheck size={14} aria-hidden="true" />
                                {/* Renta de silla mayor que lo producido: el barbero le paga al dueño (lógica L2). */}
                                {r.totalToPay < 0 ? t("comisiones.markOwed") : t("comisiones.markPaid")}
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bcom-detail">
                          <td colSpan={12} style={{ background: "var(--bg-elev-2)", whiteSpace: "normal" }}>
                            <div className="bcaja-hint" style={{ marginBottom: 8 }}>{t("comisiones.toPayExplain")}</div>
                            {r.commissionType === "CHAIR_RENT" && r.chairRentDiscounted && <div className="bcaja-hint" style={{ marginBottom: 8 }}>{t("comisiones.rentAlreadyDiscounted")}</div>}
                            {r.commissionType === "SALARY" && (
                              <div className="bcaja-hint" style={{ marginBottom: 8 }}>
                                {r.salaryPeriodTotal != null && r.salaryAmount != null && r.salaryPeriod
                                  ? t("comisiones.salaryNoteWithAmount", { salary: salaryLabel(r.salaryAmount, r.salaryPeriod, t, "comisiones") })
                                  : t("comisiones.salaryNote")}
                                {r.salaryApprox ? ` ${t("comisiones.salaryApproxHint")}` : ""}
                                {r.salaryPaid != null ? ` ${t("comisiones.salaryPaidNote", { amount: fmtMoney(r.salaryPaid) })}` : ""}
                              </div>
                            )}
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
                                      <td style={{ whiteSpace: "normal" }}>
                                        {e.itemsSummary ?? "—"}
                                        {/* Corte cubierto: el ticket vale $0 pero comisiona sobre el precio normal. */}
                                        {e.coveredCut && <div className="bcaja-hint">{t("comisiones.entryCovered")}</div>}
                                      </td>
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
          title={payRow.totalToPay < 0 ? t("comisiones.markOwedTitle") : t("comisiones.markPaidTitle")}
          onClose={() => setPayRow(null)}
          closeLabel={t("common.close")}
          footer={
            <>
              <button type="button" className="btn-new btn-new--ghost" onClick={() => setPayRow(null)} disabled={busy}>{t("common.cancel")}</button>
              <button type="button" className="btn-new barber-btn-primary" onClick={confirmPay} disabled={busy}>{busy ? t("common.saving") : payRow.totalToPay < 0 ? t("comisiones.markOwedConfirm") : t("comisiones.markPaidConfirm")}</button>
            </>
          }
        >
          <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>
            {payRow.totalToPay < 0
              ? t("comisiones.markOwedBody", { name: payRow.nickname || payRow.barberName, amount: fmtMoney(-payRow.totalToPay), period: fmtPeriod(summary.periodKey, locale) })
              : t("comisiones.markPaidBody", { name: payRow.nickname || payRow.barberName, period: fmtPeriod(summary.periodKey, locale) })}
          </p>
          {/* La MISMA cifra de la columna «A pagar» y del recibo, con su desglose. */}
          <div className="bcaja-totals">
            <div className="bcaja-totals__row"><span>{t("comisiones.payCommission")}</span><span>{fmtMoney(payRow.commissionPending)}</span></div>
            <div className="bcaja-totals__row"><span>{t("comisiones.payTips")}</span><span>{fmtMoney(payRow.tipsPending)}</span></div>
            {payRow.salaryPending != null && payRow.salaryPending > 0 && (
              <div className="bcaja-totals__row">
                <span>
                  {t("comisiones.paySalary")}
                  {payRow.salaryApprox ? ` (${t("comisiones.salaryApprox")})` : ""}
                </span>
                <span>{fmtMoney(payRow.salaryPending)}</span>
              </div>
            )}
            {payRow.chairRentPending !== null && payRow.chairRentPending > 0 && (
              <div className="bcaja-totals__row"><span>{t("comisiones.payRent")}</span><span>−{fmtMoney(payRow.chairRentPending)}</span></div>
            )}
            {/* Adelantos/vales del periodo: ya se le dieron, se restan solos (caja completa). */}
            {payRow.advances != null && payRow.advances > 0 && (
              <div className="bcaja-totals__row" data-adelantos-pago><span>{t("comisiones.payAdvances")}</span><span>−{fmtMoney(payRow.advances)}</span></div>
            )}
            <div className="bcaja-totals__row bcaja-totals__row--big"><span>{t(payRow.advances ? "comisiones.colToHand" : "comisiones.colToPay")}</span><span>{fmtSigned(payRow.totalToPay)}</span></div>
          </div>
          {payRow.paidTotal !== 0 && (
            <p className="bcaja-hint" style={{ margin: "10px 0 0" }}>{t("comisiones.payAlreadyPaid", { amount: fmtSigned(payRow.paidTotal) })}</p>
          )}
          {cashIn && payRow.totalToPay < 0 && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13.5, color: cashIn.sessionOpen ? "var(--text-1)" : "var(--text-3)" }} data-entra-a-caja>
              <input type="checkbox" checked={toCash && cashIn.sessionOpen} disabled={!cashIn.sessionOpen} onChange={(e) => setToCash(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                {t("comisiones.toCash", { amount: fmtMoney(-payRow.totalToPay) })}
                <span className="bcaja-hint" style={{ display: "block" }}>{cashIn.sessionOpen ? t("comisiones.toCashHint") : t("comisiones.fromCashNoSession")}</span>
              </span>
            </label>
          )}
          {cashOut && payRow.totalToPay > 0 && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13.5, color: cashOut.sessionOpen ? "var(--text-1)" : "var(--text-3)" }} data-sale-de-caja>
              <input type="checkbox" checked={fromCash && cashOut.sessionOpen} disabled={!cashOut.sessionOpen} onChange={(e) => setFromCash(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                {t("comisiones.fromCash", { amount: fmtMoney(payRow.totalToPay) })}
                <span className="bcaja-hint" style={{ display: "block" }}>{cashOut.sessionOpen ? t("comisiones.fromCashHint") : t("comisiones.fromCashNoSession")}</span>
              </span>
            </label>
          )}
        </BarberModal>
      )}
    </div>
  );
}

/** Fragment con key para agrupar la fila y su detalle dentro del tbody. */
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
