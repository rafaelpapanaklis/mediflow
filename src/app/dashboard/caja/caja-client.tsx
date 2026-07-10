"use client";
import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Wallet, TrendingUp, Percent, Receipt, ArrowDownCircle, Banknote,
  Lock, Plus, Printer, X, ChevronDown, ChevronRight, History,
} from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import { BillingClient } from "../billing/billing-client";
import type { CajaState, CajaHistoryRow } from "@/lib/caja";

interface BillingProps {
  invoices:      any[];
  patients:      any[];
  totalPaid:     number;
  totalPending:  number;
  totalOverdue:  number;
  monthInvoices: number;
  creditTotal:   number;
  clinic:        { facturApiEnabled: boolean; rfcEmisor: string | null };
}

interface Props {
  caja:     CajaState;
  history:  CajaHistoryRow[];
  timezone: string;
  billing:  BillingProps;
}

interface CloseSummary {
  openedAt:       string;
  closedAt:       string;
  openingBalance: number;
  cashIncome:     number;
  otherIncome:    number;
  totalIncome:    number;
  discounts:      number;
  tax:            number;
  withdrawals:    number;
  expectedCash:   number;
  counted:        number;
  variance:       number;
  list:           CajaState["list"];
}

export function CajaClient({ caja, history, timezone, billing }: Props) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<"caja" | "facturas">(
    searchParams.get("tab") === "facturas" ? "facturas" : "caja",
  );

  // Modals
  const [showOpen, setShowOpen]             = useState(false);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [showClose, setShowClose]           = useState(false);
  const [summary, setSummary]               = useState<CloseSummary | null>(null);
  const [showHistory, setShowHistory]       = useState(false);

  // Form state
  const [openingBalance, setOpeningBalance] = useState("");
  const [wAmount, setWAmount]               = useState("");
  const [wReason, setWReason]               = useState("");
  const [counted, setCounted]               = useState("");
  const [closingNotes, setClosingNotes]     = useState("");
  const [busy, setBusy]                     = useState(false);

  const reg    = caja.register;
  const totals = caja.totals;

  const METHOD_LABEL: Record<string, string> = {
    cash:     t("cashRegister.methodCash"),
    debit:    t("cashRegister.methodDebit"),
    credit:   t("cashRegister.methodCredit"),
    transfer: t("cashRegister.methodTransfer"),
    check:    t("cashRegister.methodCheck"),
    other:    t("cashRegister.methodOther"),
  };
  const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone });

  // Diferencia en vivo dentro del modal de cierre.
  const countedNum = parseFloat(counted);
  const liveVariance = useMemo(() => {
    if (!totals || Number.isNaN(countedNum)) return null;
    return Math.round((countedNum - totals.expectedCash + Number.EPSILON) * 100) / 100;
  }, [countedNum, totals]);

  async function post(url: string, body: any): Promise<any | null> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || t("cashRegister.errorGeneric"));
        return null;
      }
      return data ?? {};
    } catch {
      toast.error(t("cashRegister.errorGeneric"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openRegister() {
    const bal = parseFloat(openingBalance);
    if (Number.isNaN(bal) || bal < 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    const ok = await post("/api/caja/open", { openingBalance: bal });
    if (!ok) return;
    toast.success(t("cashRegister.toastOpened"));
    setShowOpen(false);
    setOpeningBalance("");
    router.refresh();
  }

  async function recordWithdrawal() {
    const amt = parseFloat(wAmount);
    if (Number.isNaN(amt) || amt <= 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    if (!wReason.trim()) { toast.error(t("cashRegister.reasonRequired")); return; }
    const ok = await post("/api/caja/withdrawal", { amount: amt, reason: wReason.trim() });
    if (!ok) return;
    toast.success(t("cashRegister.toastWithdrawal"));
    setShowWithdrawal(false);
    setWAmount(""); setWReason("");
    router.refresh();
  }

  async function closeRegister() {
    const cnt = parseFloat(counted);
    if (Number.isNaN(cnt) || cnt < 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    if (!totals || !reg) return;
    const res = await post("/api/caja/close", { countedClosingBalance: cnt, closingNotes: closingNotes.trim() || undefined });
    if (!res) return;
    // Congela el resumen del corte para mostrarlo/imprimirlo (tras refresh reg = null).
    setSummary({
      openedAt:       reg.openedAt,
      closedAt:       new Date().toISOString(),
      openingBalance: totals.openingBalance,
      cashIncome:     totals.cashIncome,
      otherIncome:    totals.otherIncome,
      totalIncome:    totals.totalIncome,
      discounts:      totals.discounts,
      tax:            totals.tax,
      withdrawals:    totals.withdrawals,
      expectedCash:   totals.expectedCash,
      counted:        cnt,
      variance:       typeof res.variance === "number" ? res.variance : cnt - totals.expectedCash,
      list:           caja.list,
    });
    toast.success(t("cashRegister.toastClosed"));
    setShowClose(false);
    setCounted(""); setClosingNotes("");
    router.refresh();
  }

  function printSummary(s: CloseSummary) {
    const rows = s.list.map(r =>
      `<tr><td>${fmtTime(r.at)}</td><td>${esc(r.patientName)}</td><td>${esc(r.concept)}</td><td style="text-align:right">${fmtMXNdec(r.amount)}</td><td>${esc(methodLabel(r.method))}</td><td>${esc(r.doctorName)}</td></tr>`,
    ).join("");
    const line = (label: string, val: string) =>
      `<tr><td style="padding:2px 12px 2px 0;color:#555">${label}</td><td style="text-align:right;font-weight:600">${val}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${t("cashRegister.summaryTitle")}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#111;font-size:13px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px}table{border-collapse:collapse;width:100%}td,th{padding:4px 8px}.mov th,.mov td{border-bottom:1px solid #eee;text-align:left}.mov th{background:#f6f6f6}</style>
      </head><body>
      <h1>${t("cashRegister.summaryTitle")}</h1>
      <div style="color:#666">${fmtDateTime(s.openedAt)} → ${fmtDateTime(s.closedAt)}</div>
      <h2>${t("cashRegister.title")}</h2>
      <table>
        ${line(t("cashRegister.kpiOpening"), fmtMXNdec(s.openingBalance))}
        ${line(t("cashRegister.kpiIncome"), fmtMXNdec(s.totalIncome))}
        ${line(t("cashRegister.methodCash"), fmtMXNdec(s.cashIncome))}
        ${line(t("cashRegister.kpiDiscounts"), fmtMXNdec(s.discounts))}
        ${line(t("cashRegister.kpiTax"), fmtMXNdec(s.tax))}
        ${line(t("cashRegister.kpiWithdrawals"), fmtMXNdec(s.withdrawals))}
        ${line(t("cashRegister.expectedCashLabel"), fmtMXNdec(s.expectedCash))}
        ${line(t("cashRegister.countedLabel"), fmtMXNdec(s.counted))}
        ${line(t("cashRegister.varianceLabel"), fmtMXNdec(s.variance))}
      </table>
      <h2>${t("cashRegister.listTitle")}</h2>
      <table class="mov"><thead><tr>
        <th>${t("cashRegister.thTime")}</th><th>${t("cashRegister.thPatient")}</th><th>${t("cashRegister.thConcept")}</th>
        <th style="text-align:right">${t("cashRegister.thAmount")}</th><th>${t("cashRegister.thMethod")}</th><th>${t("cashRegister.thDoctor")}</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="6" style="color:#999">${t("cashRegister.emptyList")}</td></tr>`}</tbody></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=820,height=640");
    if (w) { w.document.write(html); w.document.close(); }
  }

  const varianceTone = (v: number) => (Math.abs(v) < 0.005 ? "success" : v > 0 ? "info" : "danger");

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      {/* Header + tabs */}
      <div style={{ padding: "clamp(14px, 1.6vw, 28px) clamp(14px, 1.6vw, 28px) 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
              {t("cashRegister.title")}
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>{t("cashRegister.subtitle")}</p>
          </div>
        </div>
        <div className="segment-new" role="tablist" style={{ marginBottom: 4 }}>
          <button type="button" onClick={() => setTab("caja")}
            className={`segment-new__btn ${tab === "caja" ? "segment-new__btn--active" : ""}`}>
            {t("cashRegister.tabCaja")}
          </button>
          <button type="button" onClick={() => setTab("facturas")}
            className={`segment-new__btn ${tab === "facturas" ? "segment-new__btn--active" : ""}`}>
            {t("cashRegister.tabInvoices")}
          </button>
        </div>
      </div>

      {tab === "facturas" ? (
        <BillingClient
          invoices={billing.invoices}
          patients={billing.patients}
          totalPaid={billing.totalPaid}
          totalPending={billing.totalPending}
          totalOverdue={billing.totalOverdue}
          monthInvoices={billing.monthInvoices}
          creditTotal={billing.creditTotal}
          clinic={billing.clinic}
        />
      ) : (
        <div style={{ padding: "clamp(14px, 1.6vw, 28px)" }}>
          {!reg || !totals ? (
            /* ── Caja cerrada ── */
            <CardNew>
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <Wallet size={34} style={{ color: "var(--text-3)", marginBottom: 12 }} />
                <div style={{ color: "var(--text-1)", fontSize: 16, fontWeight: 600 }}>{t("cashRegister.closedTitle")}</div>
                <p style={{ color: "var(--text-3)", fontSize: 13, margin: "6px 0 18px" }}>{t("cashRegister.closedDesc")}</p>
                <ButtonNew variant="primary" icon={<Wallet size={14} />} onClick={() => setShowOpen(true)}>
                  {t("cashRegister.openCta")}
                </ButtonNew>
              </div>
            </CardNew>
          ) : (
            <>
              {/* Barra de estado + acciones */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <BadgeNew tone="success" dot>{t("cashRegister.tabCaja")}</BadgeNew>
                  <span style={{ color: "var(--text-3)", fontSize: 12.5 }}>
                    {t("cashRegister.openedBy", { name: reg.operatorName })} · {t("cashRegister.openedAt", { time: fmtDateTime(reg.openedAt) })}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <ButtonNew variant="secondary" icon={<ArrowDownCircle size={14} />} onClick={() => setShowWithdrawal(true)}>
                    {t("cashRegister.withdrawalCta")}
                  </ButtonNew>
                  <ButtonNew variant="primary" icon={<Lock size={14} />} onClick={() => setShowClose(true)}>
                    {t("cashRegister.closeCta")}
                  </ButtonNew>
                </div>
              </div>

              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 8 }}>
                <KpiCard label={t("cashRegister.kpiOpening")}      value={fmtMXNdec(totals.openingBalance)} icon={Wallet} />
                <KpiCard label={t("cashRegister.kpiIncome")}       value={fmtMXNdec(totals.totalIncome)}    icon={TrendingUp} />
                <KpiCard label={t("cashRegister.kpiDiscounts")}    value={fmtMXNdec(totals.discounts)}      icon={Percent} />
                <KpiCard label={t("cashRegister.kpiTax")}          value={fmtMXNdec(totals.tax)}            icon={Receipt} />
                <KpiCard label={t("cashRegister.kpiWithdrawals")}  value={fmtMXNdec(totals.withdrawals)}    icon={ArrowDownCircle} />
                <KpiCard label={t("cashRegister.kpiExpectedCash")} value={fmtMXNdec(totals.expectedCash)}   icon={Banknote} />
              </div>
              <p style={{ color: "var(--text-3)", fontSize: 12, margin: "0 0 18px" }}>
                {t("cashRegister.incomeBreakdown", { cash: fmtMXNdec(totals.cashIncome), other: fmtMXNdec(totals.otherIncome) })}
              </p>

              {/* Retiros del turno */}
              {caja.withdrawals.length > 0 && (
                <CardNew title={t("cashRegister.withdrawalsTitle")} className="mb-4" >
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {caja.withdrawals.map(w => (
                      <div key={w.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, borderBottom: "1px solid var(--border-soft)", paddingBottom: 6 }}>
                        <span style={{ color: "var(--text-2)" }}>{w.reason} <span style={{ color: "var(--text-3)" }}>· {fmtTime(w.recordedAt)} · {w.recordedByName}</span></span>
                        <span style={{ color: "var(--text-1)", fontWeight: 600 }}>−{fmtMXNdec(w.amount)}</span>
                      </div>
                    ))}
                  </div>
                </CardNew>
              )}

              {/* Lista del turno */}
              <div style={{ marginTop: 18 }}>
                <CardNew noPad title={t("cashRegister.listTitle")}>
                  {caja.list.length === 0 ? (
                    <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                      {t("cashRegister.emptyList")}
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="table-new">
                        <thead>
                          <tr>
                            <th>{t("cashRegister.thTime")}</th>
                            <th>{t("cashRegister.thPatient")}</th>
                            <th>{t("cashRegister.thConcept")}</th>
                            <th style={{ textAlign: "right" }}>{t("cashRegister.thAmount")}</th>
                            <th>{t("cashRegister.thMethod")}</th>
                            <th>{t("cashRegister.thDoctor")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {caja.list.map(r => (
                            <tr key={r.paymentId}>
                              <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{fmtTime(r.at)}</td>
                              <td style={{ color: "var(--text-1)" }}>{r.patientName}</td>
                              <td style={{ color: "var(--text-2)" }}>{r.concept}</td>
                              <td style={{ textAlign: "right", fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap" }}>{fmtMXNdec(r.amount)}</td>
                              <td><BadgeNew tone={r.method === "cash" ? "success" : "info"}>{methodLabel(r.method)}</BadgeNew></td>
                              <td style={{ color: "var(--text-2)" }}>{r.doctorName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardNew>
              </div>
            </>
          )}

          {/* Historial de cortes (colapsable) */}
          <div style={{ marginTop: 22 }}>
            <button type="button" onClick={() => setShowHistory(s => !s)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-2)", fontSize: 13, fontWeight: 500, padding: "6px 0" }}>
              {showHistory ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <History size={14} /> {t("cashRegister.historyTitle")} ({history.length})
            </button>
            {showHistory && (
              <CardNew noPad>
                {history.length === 0 ? (
                  <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    {t("cashRegister.historyEmpty")}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="table-new">
                      <thead>
                        <tr>
                          <th>{t("cashRegister.thOpened")}</th>
                          <th>{t("cashRegister.thClosed")}</th>
                          <th>{t("cashRegister.thOperator")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.kpiOpening")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thExpected")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thCounted")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thVariance")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id}>
                            <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{fmtDateTime(h.openedAt)}</td>
                            <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{h.closedAt ? fmtDateTime(h.closedAt) : "—"}</td>
                            <td style={{ color: "var(--text-2)" }}>{h.operatorName}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtMXNdec(h.openingBalance)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{h.expectedCash == null ? "—" : fmtMXNdec(h.expectedCash)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{h.countedClosingBalance == null ? "—" : fmtMXNdec(h.countedClosingBalance)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              {h.variance == null ? "—" : <BadgeNew tone={varianceTone(h.variance)}>{fmtMXNdec(h.variance)}</BadgeNew>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardNew>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Abrir caja ── */}
      {showOpen && (
        <div className="modal-overlay" onClick={() => setShowOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.openTitle")}</div>
              <button onClick={() => setShowOpen(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={14} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); openRegister(); }}>
              <div className="modal__body">
                <div className="field-new">
                  <label className="field-new__label">{t("cashRegister.openingBalanceLabel")}</label>
                  <input type="number" min={0} step="0.01" className="input-new" autoFocus placeholder="0.00"
                    value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} />
                  <span style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>{t("cashRegister.openingBalanceHint")}</span>
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowOpen(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={busy}>{t("cashRegister.openSubmit")}</ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Registrar retiro ── */}
      {showWithdrawal && (
        <div className="modal-overlay" onClick={() => setShowWithdrawal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.withdrawalTitle")}</div>
              <button onClick={() => setShowWithdrawal(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={14} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); recordWithdrawal(); }}>
              <div className="modal__body">
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.amountLabel")} <span className="req">*</span></label>
                  <input type="number" min={0} step="0.01" className="input-new" autoFocus placeholder="0.00"
                    value={wAmount} onChange={e => setWAmount(e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">{t("cashRegister.reasonLabel")} <span className="req">*</span></label>
                  <input className="input-new" placeholder={t("cashRegister.reasonPlaceholder")}
                    value={wReason} onChange={e => setWReason(e.target.value)} />
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowWithdrawal(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={busy}>{t("cashRegister.withdrawalSubmit")}</ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Cerrar caja ── */}
      {showClose && totals && (
        <div className="modal-overlay" onClick={() => setShowClose(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.closeTitle")}</div>
              <button onClick={() => setShowClose(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={14} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); closeRegister(); }}>
              <div className="modal__body">
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-elev)", borderRadius: 8, marginBottom: 14 }}>
                  <span style={{ color: "var(--text-2)", fontSize: 13 }}>{t("cashRegister.expectedCashLabel")}</span>
                  <span style={{ color: "var(--text-1)", fontWeight: 700 }}>{fmtMXNdec(totals.expectedCash)}</span>
                </div>
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.countedLabel")} <span className="req">*</span></label>
                  <input type="number" min={0} step="0.01" className="input-new" autoFocus placeholder="0.00"
                    value={counted} onChange={e => setCounted(e.target.value)} />
                  <span style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>{t("cashRegister.countedHint")}</span>
                </div>
                {liveVariance !== null && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <span style={{ color: "var(--text-2)", fontSize: 13 }}>{t("cashRegister.varianceLabel")}</span>
                    <BadgeNew tone={varianceTone(liveVariance)}>{fmtMXNdec(liveVariance)}</BadgeNew>
                  </div>
                )}
                <div className="field-new">
                  <label className="field-new__label">{t("cashRegister.notesLabel")}</label>
                  <input className="input-new" placeholder={t("cashRegister.notesPlaceholder")}
                    value={closingNotes} onChange={e => setClosingNotes(e.target.value)} />
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowClose(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={busy}>{t("cashRegister.closeSubmit")}</ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Resumen del corte (post-cierre) ── */}
      {summary && (
        <div className="modal-overlay" onClick={() => setSummary(null)}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.summaryTitle")}</div>
              <button onClick={() => setSummary(null)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={14} /></button>
            </div>
            <div className="modal__body">
              <div style={{ color: "var(--text-3)", fontSize: 12.5, marginBottom: 14 }}>
                {fmtDateTime(summary.openedAt)} → {fmtDateTime(summary.closedAt)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 18 }}>
                <SumRow label={t("cashRegister.kpiOpening")}      value={fmtMXNdec(summary.openingBalance)} />
                <SumRow label={t("cashRegister.kpiIncome")}       value={fmtMXNdec(summary.totalIncome)} />
                <SumRow label={t("cashRegister.methodCash")}      value={fmtMXNdec(summary.cashIncome)} />
                <SumRow label={t("cashRegister.kpiDiscounts")}    value={fmtMXNdec(summary.discounts)} />
                <SumRow label={t("cashRegister.kpiTax")}          value={fmtMXNdec(summary.tax)} />
                <SumRow label={t("cashRegister.kpiWithdrawals")}  value={fmtMXNdec(summary.withdrawals)} />
                <SumRow label={t("cashRegister.expectedCashLabel")} value={fmtMXNdec(summary.expectedCash)} strong />
                <SumRow label={t("cashRegister.countedLabel")}    value={fmtMXNdec(summary.counted)} strong />
                <SumRow label={t("cashRegister.varianceLabel")}   value={fmtMXNdec(summary.variance)} strong />
              </div>
              {summary.list.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="table-new">
                    <thead>
                      <tr>
                        <th>{t("cashRegister.thTime")}</th><th>{t("cashRegister.thPatient")}</th><th>{t("cashRegister.thConcept")}</th>
                        <th style={{ textAlign: "right" }}>{t("cashRegister.thAmount")}</th><th>{t("cashRegister.thMethod")}</th><th>{t("cashRegister.thDoctor")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.list.map(r => (
                        <tr key={r.paymentId}>
                          <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{fmtTime(r.at)}</td>
                          <td>{r.patientName}</td>
                          <td style={{ color: "var(--text-2)" }}>{r.concept}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMXNdec(r.amount)}</td>
                          <td>{methodLabel(r.method)}</td>
                          <td style={{ color: "var(--text-2)" }}>{r.doctorName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal__footer">
              <ButtonNew variant="secondary" type="button" icon={<Printer size={14} />} onClick={() => printSummary(summary)}>
                {t("cashRegister.print")}
              </ButtonNew>
              <ButtonNew variant="primary" type="button" onClick={() => setSummary(null)}>{t("common.close")}</ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "var(--bg-elev)", borderRadius: 8 }}>
      <span style={{ color: "var(--text-3)", fontSize: 12.5 }}>{label}</span>
      <span style={{ color: "var(--text-1)", fontWeight: strong ? 700 : 600, fontSize: 13 }}>{value}</span>
    </div>
  );
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
