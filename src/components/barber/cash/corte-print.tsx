"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashSessionSummary } from "@/lib/barber/cash";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, fmtSigned, fromCents, toCents } from "./money";
import { PrintSetupControls, printWithWidth, usePrintSetup } from "./print-setup";
import { closeExpectedView } from "./close-expected";
import { corteDiffCents, corteDiffLabel, corteWhatsappText, denominationLabel, waMeLink } from "./corte-core";
import { categoryLabel, movementTitle } from "./movement-modals";
import { CASH_DENOMINATIONS } from "@/lib/barber/caja-movimientos-core";

/**
 * El corte de caja imprimible (ws6-t1): misma página que el ticket
 * (carta o rollo térmico de 80/58 mm, recordado en este navegador) y el
 * mismo texto que se manda por WhatsApp. Todo viene calculado del servidor.
 * ?imprimir=1 abre el diálogo de impresión solo (al cerrar caja).
 */
export function CortePrint({
  dict,
  summary,
  shop,
}: {
  dict: Dictionary;
  summary: CashSessionSummary;
  shop: { name: string; logoUrl: string | null; timezone: string };
}) {
  const t = useBarberT(dict);
  const printSetup = usePrintSetup();
  const ref = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(printSetup.width);
  widthRef.current = printSetup.width;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("imprimir") !== "1") return;
    const id = window.setTimeout(() => printWithWidth(widthRef.current, ref), 400);
    return () => window.clearTimeout(id);
  }, []);

  const tz = shop.timezone;
  const s = summary.session;
  const r = summary.resumen;
  const view = closeExpectedView(summary);
  const diff = corteDiffCents(summary);
  const thermal = printSetup.width !== "letter";
  const catLabel = (c: string) => categoryLabel(t, c);
  const text = corteWhatsappText(summary, { shopName: shop.name, tz, t, categoryLabel: catLabel });
  const breakdown = s.countedBreakdown ?? null;
  const payouts = summary.movements.filter((m) => m.type === "BARBER_PAYOUT" && !m.voidedAt);

  return (
    <>
      <div className="bcaja-print-actions">
        <Link href="/barber/caja" className="btn-new btn-new--ghost"><ArrowLeft size={14} /> {t("common.back")}</Link>
        <PrintSetupControls
          t={t}
          width={printSetup.width}
          setWidth={printSetup.setWidth}
          logo={printSetup.logo}
          setLogo={printSetup.setLogo}
          withLogo={Boolean(shop.logoUrl)}
          onPrint={() => printWithWidth(printSetup.width, ref)}
        />
        <a className="btn-new btn-new--secondary" href={waMeLink(text)} target="_blank" rel="noopener noreferrer" data-corte-whatsapp>
          <MessageCircle size={14} /> {t("corte.whatsapp")}
        </a>
      </div>

      <div className={`bcaja-print ${printSetup.className}`.trim()} ref={ref} data-ancho-impresion={printSetup.width} data-corte={s.id}>
        <div className="bcaja-print__head">
          {shop.logoUrl && (!thermal || printSetup.logo) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="bcaja-print__logo" src={shop.logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", margin: "0 auto 8px" }} />
          )}
          <div className="bcaja-print__shop">{shop.name}</div>
          <div className="bcaja-print__meta">{t("corte.title")}</div>
        </div>
        {!s.closedAt && <div style={{ textAlign: "center" }}><span className="bcaja-print__stamp">{t("corte.notClosed")}</span></div>}

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__row"><span>{t("corte.opened")}</span><span>{fmtDateTime(s.openedAt, tz)}</span></div>
        <div className="bcaja-print__row"><span>{t("corte.openedByLabel")}</span><span>{s.openedByName}</span></div>
        {s.closedAt && <div className="bcaja-print__row"><span>{t("corte.closed")}</span><span>{fmtDateTime(s.closedAt, tz)}</span></div>}
        {s.closedByName && <div className="bcaja-print__row"><span>{t("corte.closedByLabel")}</span><span>{s.closedByName}</span></div>}

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__section">{t("corte.cashSection")}</div>
        <div className="bcaja-print__row"><span>{t("caja.openingAmount")}</span><span>{fmtMoney(view.opening)}</span></div>
        <div className="bcaja-print__row"><span>+ {t("session.cashCharged")}</span><span>{fmtMoney(view.cashCharged)}</span></div>
        {view.extras.map((x) => (
          <div key={x.key} className="bcaja-print__row"><span>{x.sign} {t(`session.sum.${x.key}`)}</span><span>{fmtMoney(x.amount)}</span></div>
        ))}
        <div className="bcaja-print__row bcaja-print__row--total"><span>= {t("session.expected")}</span><span>{fmtMoney(s.expectedAmount ?? summary.expectedCash)}</span></div>
        {s.countedAmount !== null && (
          <>
            <div className="bcaja-print__row"><span>{t("corte.counted")}</span><span>{fmtMoney(s.countedAmount)}</span></div>
            {diff !== null && (
              <div className="bcaja-print__row bcaja-print__row--total" data-diferencia-impresa>
                <span>{corteDiffLabel(t, diff)}</span><span>{fmtSigned(fromCents(diff))}</span>
              </div>
            )}
          </>
        )}
        {s.leftForNext !== null && s.leftForNext !== undefined && (
          <>
            <div className="bcaja-print__row"><span>{t("corte.leftForNext")}</span><span>{fmtMoney(s.leftForNext)}</span></div>
            {s.countedAmount !== null && (
              <div className="bcaja-print__row"><span>{t("corte.taken")}</span><span>{fmtMoney(fromCents(toCents(s.countedAmount) - toCents(s.leftForNext)))}</span></div>
            )}
          </>
        )}

        {breakdown && Object.keys(breakdown).length > 0 && (
          <>
            <hr className="bcaja-print__rule" />
            <div className="bcaja-print__section">{t("corte.countSection")}</div>
            {CASH_DENOMINATIONS.filter((d) => (breakdown[d.key] ?? 0) > 0).map((d) => (
              <div key={d.key} className="bcaja-print__row">
                <span>{breakdown[d.key]} × {denominationLabel(t, d.key)}</span>
                <span>{fmtMoney(fromCents(d.cents * breakdown[d.key]))}</span>
              </div>
            ))}
          </>
        )}

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__section">{t("cards.income")}</div>
        <div className="bcaja-print__row"><span>{t("common.cash")}</span><span>{fmtMoney(r.income.byMethod.CASH.total)}</span></div>
        <div className="bcaja-print__row"><span>{t("common.card")}</span><span>{fmtMoney(r.income.byMethod.CARD.total)}</span></div>
        <div className="bcaja-print__row"><span>{t("common.spei")}</span><span>{fmtMoney(r.income.byMethod.SPEI.total)}</span></div>
        {r.income.byMethod.ONLINE.count > 0 && <div className="bcaja-print__row"><span>{t("cards.online")}</span><span>{fmtMoney(r.income.byMethod.ONLINE.total)}</span></div>}
        <div className="bcaja-print__row bcaja-print__row--total"><span>{t("common.total")}</span><span>{fmtMoney(r.income.total)}</span></div>
        <div className="bcaja-print__row"><span>{t("corte.tickets")}</span><span>{r.tickets.count}</span></div>
        <div className="bcaja-print__row"><span>{t("corte.average")}</span><span>{fmtMoney(r.tickets.average)}</span></div>
        {r.discounts > 0 && <div className="bcaja-print__row"><span>{t("corte.discounts")}</span><span>{fmtMoney(r.discounts)}</span></div>}
        {r.tips.total > 0 && <div className="bcaja-print__row"><span>{t("caja.tipsTotal")}</span><span>{fmtMoney(r.tips.total)}</span></div>}
        {r.tips.byBarber.map((b) => (
          <div key={b.barberId} className="bcaja-print__row"><span>· {b.barberName}</span><span>{fmtMoney(b.total)}</span></div>
        ))}

        {r.expenses.count > 0 && (
          <>
            <hr className="bcaja-print__rule" />
            <div className="bcaja-print__section">{t("cards.expenses")}</div>
            {r.expenses.byCategory.map((c) => (
              <div key={c.category} className="bcaja-print__row"><span>{catLabel(c.category)}</span><span>{fmtMoney(c.total)}</span></div>
            ))}
            <div className="bcaja-print__row bcaja-print__row--total"><span>{t("common.total")}</span><span>{fmtMoney(r.expenses.total)}</span></div>
          </>
        )}
        {payouts.length > 0 && (
          <>
            <hr className="bcaja-print__rule" />
            <div className="bcaja-print__section">{t("corte.payouts")}</div>
            {payouts.map((m) => (
              <div key={m.id} className="bcaja-print__row"><span>{movementTitle(t, m)}</span><span>{fmtMoney(m.amount)}</span></div>
            ))}
          </>
        )}
        {(r.withdrawals.count > 0 || r.deposits.count > 0) && (
          <>
            <hr className="bcaja-print__rule" />
            <div className="bcaja-print__row"><span>{t("corte.withdrawals")}</span><span>{fmtMoney(r.withdrawals.total)}</span></div>
            <div className="bcaja-print__row"><span>{t("corte.deposits")}</span><span>{fmtMoney(r.deposits.total)}</span></div>
          </>
        )}
        {s.notes && (
          <>
            <hr className="bcaja-print__rule" />
            <div className="bcaja-print__meta" style={{ whiteSpace: "pre-wrap", textAlign: "left" }}>{s.notes}</div>
          </>
        )}
        <div className="bcaja-print__sign">{t("corte.sign")}</div>
      </div>
    </>
  );
}
