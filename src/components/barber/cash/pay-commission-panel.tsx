"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/i18n/t";
import type { CommissionSummary, CommissionSummaryRow } from "@/lib/barber/commissions";
import { CASH_MOVEMENT_METHODS, type CashMovementMethod } from "@/lib/barber/caja-movimientos-core";
import { useBarberT } from "./use-barber-t";
import { fmtMoney, fmtPeriod, fmtSigned } from "./money";

/**
 * «Pagar a barbero» → comisión o sueldo, DESDE CAJA (caja completa, punto 5).
 * No es otro registro: llama al MISMO «Marcar pagado» de Comisiones
 * (/api/barber/commissions/pay) con el medio elegido, y el servidor crea en
 * la misma transacción el pago (entradas/sueldo marcados) y su movimiento de
 * caja. Se paga TODO lo pendiente del mes, igual que en Comisiones.
 */
export function PayCommissionPanel({
  dict,
  barberId,
  periodKey,
  locale,
  sessionOpen,
  onPaid,
  onCancel,
}: {
  dict: Dictionary;
  barberId: string | null;
  periodKey: string;
  locale: string;
  sessionOpen: boolean;
  onPaid: (paidAmount: number) => void;
  onCancel: () => void;
}) {
  const t = useBarberT(dict);
  const [row, setRow] = useState<CommissionSummaryRow | null | "loading" | "error">(null);
  const [method, setMethod] = useState<CashMovementMethod>("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!barberId) {
      setRow(null);
      return;
    }
    let alive = true;
    setRow("loading");
    setError(null);
    fetch(`/api/barber/commissions?period=${encodeURIComponent(periodKey)}&barberId=${encodeURIComponent(barberId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as CommissionSummary;
        if (alive) setRow(json.rows.find((r) => r.barberId === barberId) ?? null);
      })
      .catch(() => {
        if (alive) setRow("error");
      });
    return () => {
      alive = false;
    };
  }, [barberId, periodKey]);

  async function pay(r: CommissionSummaryRow) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/barber/commissions/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barberId: r.barberId, periodKey, expectedTotal: r.totalToPay, payoutMethod: method }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; paidAmount?: number; marked?: number };
      if (!res.ok) {
        setError(json.error ?? t("common.error"));
        return;
      }
      onPaid(json.paidAmount ?? 0);
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const loaded = row && row !== "loading" && row !== "error" ? row : null;
  const nothing = loaded !== null && loaded.totalToPay <= 0;
  const cashBlocked = method === "CASH" && !sessionOpen;

  return (
    <div className="bcaja-form" data-pago-comision>
      {!barberId ? (
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("payc.pickBarber")}</p>
      ) : row === "loading" ? (
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("common.loading")}</p>
      ) : row === "error" || row === null ? (
        <div className="bcaja-alert bcaja-alert--danger" role="alert">{t("common.error")}</div>
      ) : (
        <>
          <p className="bcaja-hint" style={{ margin: 0 }}>{t("payc.body", { period: fmtPeriod(periodKey, locale) })}</p>
          <div className="bcaja-totals">
            <div className="bcaja-totals__row"><span>{t("comisiones.payCommission")}</span><span>{fmtMoney(row.commissionPending)}</span></div>
            <div className="bcaja-totals__row"><span>{t("comisiones.payTips")}</span><span>{fmtMoney(row.tipsPending)}</span></div>
            {row.salaryPending != null && row.salaryPending > 0 && (
              <div className="bcaja-totals__row"><span>{t("comisiones.paySalary")}</span><span>{fmtMoney(row.salaryPending)}</span></div>
            )}
            {row.chairRentPending !== null && row.chairRentPending > 0 && (
              <div className="bcaja-totals__row"><span>{t("comisiones.payRent")}</span><span style={{ whiteSpace: "nowrap" }}>−{fmtMoney(row.chairRentPending)}</span></div>
            )}
            {/* Adelantos/vales del periodo: ya se le dieron, se restan solos (caja completa). */}
            {row.advances != null && row.advances > 0 && (
              <div className="bcaja-totals__row" data-adelantos-pago><span>{t("comisiones.payAdvances")}</span><span style={{ whiteSpace: "nowrap" }}>−{fmtMoney(row.advances)}</span></div>
            )}
            <div className="bcaja-totals__row bcaja-totals__row--big"><span>{t(row.advances ? "comisiones.colToHand" : "comisiones.colToPay")}</span><span>{fmtSigned(row.totalToPay)}</span></div>
          </div>
          {nothing ? (
            <div className="bcaja-alert bcaja-alert--info" role="status">{row.totalToPay < 0 ? t("payc.owes", { amount: fmtMoney(-row.totalToPay) }) : t("payc.nothing")}</div>
          ) : (
            <div className="field-new">
              <label className="field-new__label">{t("mov.methodLabel")}</label>
              <div className="bcaja-seg" role="radiogroup" aria-label={t("mov.methodLabel")} style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                {CASH_MOVEMENT_METHODS.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} className={`bcaja-seg__btn ${method === m ? "bcaja-seg__btn--on" : ""}`} onClick={() => setMethod(m)}>
                    {t(`mov.method.${m}`)}
                  </button>
                ))}
              </div>
              {cashBlocked && <div className="bcaja-alert bcaja-alert--warning" style={{ marginTop: 8 }}>{t("payc.needsOpen")}</div>}
            </div>
          )}
        </>
      )}
      {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn-new btn-new--ghost" onClick={onCancel} disabled={busy}>{t("common.cancel")}</button>
        {loaded && !nothing && (
          <button type="button" className="btn-new barber-btn-primary" onClick={() => pay(loaded)} disabled={busy || cashBlocked} data-pagar-comision>
            {busy ? t("common.saving") : t("payc.confirm", { amount: fmtMoney(loaded.totalToPay) })}
          </button>
        )}
      </div>
    </div>
  );
}
