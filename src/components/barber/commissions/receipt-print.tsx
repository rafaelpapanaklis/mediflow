"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintSetupControls, printWithWidth, usePrintSetup } from "@/components/barber/cash/print-setup";
import type { Dictionary } from "@/i18n/t";
import type { CommissionEntryRow, CommissionSummaryRow } from "@/lib/barber/commissions";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtDate, fmtDateTime, fmtMoney, fmtPct, fmtPeriod, fmtSigned, fromCents, toCents } from "@/components/barber/cash/money";
import { upperFirst } from "@/components/barber/upper-first";
import { salaryLabel } from "@/lib/barber/sueldo-texto";
import "./comisiones.css";

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
  // Adelantos del periodo (pendientes de descontar + ya descontados).
  const advTotalCents = toCents(row.advances ?? 0) + toCents(row.advancesSettled ?? 0);
  const scheme =
    row.commissionType === "COMMISSION" ? t("comisiones.schemeCOMMISSION", { pct: row.commissionPct ?? 0 }) : t(`comisiones.scheme${row.commissionType}`);
  const live = entries.filter((e) => !e.saleCancelled);
  // Hoja carta o impresora térmica de 80/58 mm (recordado en este navegador).
  const printSetup = usePrintSetup();
  const receiptRef = useRef<HTMLDivElement | null>(null);

  return (
    <>
      <div className="bcaja-print-actions">
        <Link href={`/barber/comisiones?period=${periodKey}`} className="btn-new btn-new--ghost"><ArrowLeft size={14} /> {t("common.back")}</Link>
        <PrintSetupControls
          t={t}
          width={printSetup.width}
          setWidth={printSetup.setWidth}
          logo={printSetup.logo}
          setLogo={printSetup.setLogo}
          withLogo={false}
          onPrint={() => printWithWidth(printSetup.width, receiptRef)}
        />
      </div>

      <div className={`bcaja-print bcom-recibo ${printSetup.width === "letter" ? "bcaja-print--wide" : printSetup.className}`} ref={receiptRef} data-ancho-impresion={printSetup.width}>
        <div className="bcaja-print__head">
          <div className="bcaja-print__shop">{shopName}</div>
          <div className="bcaja-print__meta">{t("print.receiptTitle")}</div>
        </div>
        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__row"><span>{t("comisiones.colBarber")}</span><span>{row.barberName}{row.nickname ? ` (${row.nickname})` : ""}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptPeriod")}</span><span>{upperFirst(fmtPeriod(periodKey, locale))}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptScheme")}</span><span>{scheme}</span></div>
        <div className="bcaja-print__row"><span>{t("comisiones.policy")}</span><span>{policyLabel}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptStatus")}</span><span>{row.paidStatus === "PAID" && row.lastPaidAt ? t("print.receiptPaidAt", { date: fmtDate(row.lastPaidAt, tz) }) : row.paidStatus === "PARTIAL" && row.lastPaidAt ? t("print.receiptPartial", { date: fmtDate(row.lastPaidAt, tz) }) : t("print.receiptPending")}</span></div>

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__section">{t("print.receiptProduced")}</div>
        <div className="bcaja-print__row"><span>{t("print.receiptServices")}</span><span>{fmtMoney(row.servicesTotal)}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptProducts")}</span><span>{fmtMoney(row.productsTotal)}</span></div>
        {row.adjustmentsTotal !== 0 && <div className="bcaja-print__row"><span>{t("print.receiptAdjustments")}</span><span>{fmtMoney(row.adjustmentsTotal)}</span></div>}
        <div className="bcaja-print__row"><span>{t("comisiones.colProduced")} ({row.ticketCount})</span><span>{fmtMoney(row.produced)}</span></div>

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__row"><span>{t("print.receiptBase")}</span><span>{fmtMoney(row.commissionBase)}</span></div>
        {live.some((e) => e.coveredCut) && <div className="bcaja-print__meta" style={{ padding: "4px 0" }}>{t("print.receiptCoveredNote")}</div>}
        <div className="bcaja-print__row"><span>{t("print.receiptCommission")}</span><span>{fmtMoney(row.commissionTotal)}</span></div>
        <div className="bcaja-print__row"><span>{t("print.receiptTips")}</span><span>{fmtMoney(row.tips)}</span></div>
        {row.chairRent !== null && <div className="bcaja-print__row"><span>{t("print.receiptRent")}</span><span>−{fmtMoney(row.chairRent)}</span></div>}
        {/* Sueldo del periodo (ws6-t6): con monto capturado, renglón propio; sin él, la nota de siempre. */}
        {row.salaryPeriodTotal != null ? (
          <div className="bcaja-print__row">
            <span>
              {t("comisiones.salaryOfPeriod")}
              {row.salaryAmount != null && row.salaryPeriod ? ` (${salaryLabel(row.salaryAmount, row.salaryPeriod, t, "comisiones")}${row.salaryApprox ? `, ${t("comisiones.salaryApprox")}` : ""})` : ""}
            </span>
            <span>{fmtMoney(row.salaryPeriodTotal)}</span>
          </div>
        ) : (
          row.commissionType === "SALARY" && <div className="bcaja-print__meta" style={{ padding: "4px 0" }}>{t("print.receiptSalaryNote")}</div>
        )}
        {/* Tres renglones que suman: lo del periodo = ya pagado + a pagar.
            «A pagar» es la misma cifra de la tabla y del diálogo de pagar. */}
        <div className="bcaja-print__row"><span>{t("print.receiptPeriodTotal")}</span><span>{fmtSigned(row.periodTotal)}</span></div>
        {/* Caja completa (ws6-t1): los adelantos/vales del periodo ya se le
            entregaron y se RESTAN solos. Se enseñan aparte de «ya pagado»
            para que la cuenta se lea: periodo − adelantos − pagado = a entregar. */}
        {advTotalCents > 0 && (
          <div className="bcaja-print__row" data-recibo-adelantos><span>{t("print.receiptAdvances")}</span><span>−{fmtMoney(fromCents(advTotalCents))}</span></div>
        )}
        <div className="bcaja-print__row"><span>{t("print.receiptAlreadyPaid")}</span><span>{fmtSigned(fromCents(toCents(row.paidTotal) - advTotalCents))}</span></div>
        <div className="bcaja-print__row bcaja-print__row--total"><span>{t(advTotalCents > 0 ? "print.receiptToHand" : "print.receiptTotal")}</span><span>{fmtSigned(row.totalToPay)}</span></div>

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
              <th>{t("comisiones.entryPaid")}</th>
            </tr>
          </thead>
          <tbody>
            {live.length === 0 ? (
              <tr><td colSpan={7}>{t("comisiones.entriesEmpty")}</td></tr>
            ) : (
              live.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.createdAt, tz)}</td>
                  <td>{e.itemsSummary ?? "—"}{e.clientName ? ` · ${e.clientName}` : ""}{e.coveredCut ? ` — ${t("comisiones.entryCovered")}` : ""}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(e.base)}</td>
                  <td style={{ textAlign: "right" }}>{fmtPct(e.pct)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(e.amount)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(e.saleTip)}</td>
                  <td>{e.paidAt ? fmtDate(e.paidAt, tz) : t("comisiones.statusPENDING")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="bcaja-print__sign">
          <div>{t("print.receiptSignBarber")}</div>
          <div>{t("print.receiptSignShop")}</div>
        </div>
        {/* La hora se calcula al pintar en el servidor Y en el navegador: si cambia
            el minuto entre los dos, React avisaba (#418, QA B). Es solo un sello. */}
        <div className="bcaja-print__thanks" suppressHydrationWarning>{t("print.generated", { date: fmtDateTime(new Date().toISOString(), tz) })}</div>
      </div>
    </>
  );
}
