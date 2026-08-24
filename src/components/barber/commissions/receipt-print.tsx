"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CommissionEntryRow, CommissionSummaryRow } from "@/lib/barber/commissions";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtDate, fmtDateTime, fmtMoney, fmtPct, fmtPeriod, fmtSigned } from "@/components/barber/cash/money";

export function ReceiptPrint({
  dict,
  locale,
  shopName,
  periodKey,
  tz,
  row,
  entries,
  policyLabel,
}: {
  dict: Dictionary;
  locale: string;
  shopName: string;
  periodKey: string;
  tz: string;
  row: CommissionSummaryRow;
  entries: CommissionEntryRow[];
  policyLabel: string;
}) {
  const t = useBarberT(dict);
  const scheme =
    row.commissionType === "COMMISSION" ? t("comisiones.schemeCOMMISSION", { pct: row.commissionPct ?? 0 }) : t(`comisiones.scheme${row.commissionType}`);
  const live = entries.filter((e) => !e.saleCancelled);

  return (
    <>
      <div className="bcaja-print-actions">
        <Link href={`/barber/comisiones?period=${periodKey}`} className="btn-new btn-new--ghost"><ArrowLeft size={14} /> {t("common.back")}</Link>
        <button type="button" className="btn-new barber-btn-primary" onClick={() => window.print()}><Printer size={14} /> {t("common.print")}</button>
      </div>

      <div className="bcaja-print bcaja-print--wide">
        <div className="bcaja-print__head">
          <div className="bcaja-print__shop">{shopName}</div>
          <div className="bcaja-print__meta">{t("print.receiptTitle")}</div>
        </div>
        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__row"><span>{t("comisiones.colBarber")}</span><span>{row.barberName}{row.nickname ? ` (${row.nickname})` : ""}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptPeriod")}</span><span style={{ textTransform: "capitalize" }}>{fmtPeriod(periodKey, locale)}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptScheme")}</span><span>{scheme}</span></div>
        <div className="bcaja-print__row"><span>{t("comisiones.policy")}</span><span>{policyLabel}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptStatus")}</span><span>{row.paidStatus === "PAID" && row.lastPaidAt ? t("print.receiptPaidAt", { date: fmtDate(row.lastPaidAt, tz) }) : t("print.receiptPending")}</span></div>

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__section">{t("print.receiptProduced")}</div>
        <div className="bcaja-print__row"><span>{t("print.receiptServices")}</span><span>{fmtMoney(row.servicesTotal)}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptProducts")}</span><span>{fmtMoney(row.productsTotal)}</span></div>
        {row.adjustmentsTotal !== 0 && <div className="bcaja-print__row"><span>{t("print.receiptAdjustments")}</span><span>{fmtMoney(row.adjustmentsTotal)}</span></div>}
        <div className="bcaja-print__row"><span>{t("comisiones.colProduced")} ({row.ticketCount})</span><span>{fmtMoney(row.produced)}</span></div>

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__row"><span>{t("print.receiptBase")}</span><span>{fmtMoney(row.commissionBase)}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptCommission")}</span><span>{fmtMoney(row.commissionTotal)}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptTips")}</span><span>{fmtMoney(row.tips)}</span></div>
        {row.chairRent !== null && <div className="bcaja-print__row"><span>{t("print.receiptRent")}</span><span>−{fmtMoney(row.chairRent)}</span></div>}
        {row.commissionType === "SALARY" && <div className="bcaja-print__meta" style={{ padding: "4px 0" }}>{t("print.receiptSalaryNote")}</div>}
        <div className="bcaja-print__row bcaja-print__row--total"><span>{t("print.receiptTotal")}</span><span>{fmtSigned(row.totalToPay)}</span></div>

        <div className="bcaja-print__section">{t("print.receiptEntries")}</div>
        <table className="bcaja-print__table">
          <thead>
            <tr>
              <th>{t("comisiones.entryDate")}</th>
              <th>{t("comisiones.entryItems")}</th>
              <th style={{ textAlign: "right" }}>{t("comisiones.entryBase")}</th>
              <th style={{ textAlign: "right" }}>{t("comisiones.entryPct")}</th>
              <th style={{ textAlign: "right" }}>{t("comisiones.entryAmount")}</th>
              <th style={{ textAlign: "right" }}>{t("comisiones.entryTip")}</th>
            </tr>
          </thead>
          <tbody>
            {live.length === 0 ? (
              <tr><td colSpan={6}>{t("comisiones.entriesEmpty")}</td></tr>
            ) : (
              live.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.createdAt, tz)}</td>
                  <td>{e.itemsSummary ?? "—"}{e.clientName ? ` · ${e.clientName}` : ""}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(e.base)}</td>
                  <td style={{ textAlign: "right" }}>{fmtPct(e.pct)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(e.amount)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(e.saleTip)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="bcaja-print__sign">
          <div>{t("print.receiptSignBarber")}</div>
          <div>{t("print.receiptSignShop")}</div>
        </div>
        <div className="bcaja-print__thanks">{t("print.generated", { date: fmtDateTime(new Date().toISOString(), tz) })}</div>
      </div>
    </>
  );
}
