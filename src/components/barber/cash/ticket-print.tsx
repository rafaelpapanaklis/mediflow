"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Link2, MessageCircle, Printer } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { SaleDetail } from "@/lib/barber/cash";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, PAYMENT_METHOD_KEYS } from "./money";

/** Ticket imprimible / compartible. Todo el dinero viene ya calculado del server. */
export function TicketPrint({ sale, dict }: { sale: SaleDetail; dict: Dictionary }) {
  const t = useBarberT(dict);
  const [shareBusy, setShareBusy] = useState(false);
  const tz = sale.shop.timezone;
  const shortId = sale.id.slice(-6).toUpperCase();
  const shareText = t("print.shareText", { shop: sale.shop.name, total: fmtMoney(sale.total) });
  const phoneDigits = (sale.clientPhone ?? "").replace(/\D/g, "");
  const waHref = phoneDigits
    ? `https://wa.me/${phoneDigits.length === 10 ? `52${phoneDigits}` : phoneDigits}?text=${encodeURIComponent(shareText)}`
    : `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  async function copyLink() {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const url = typeof window !== "undefined" ? window.location.href : "";
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: `${sale.shop.name} · ${t("print.ticketTitle")} ${shortId}`, text: shareText, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t("common.copied"));
      }
    } catch {
      /* el usuario canceló el share */
    } finally {
      setShareBusy(false);
    }
  }

  const address = [sale.shop.address, sale.shop.city, sale.shop.state].filter(Boolean).join(", ");

  return (
    <>
      <div className="bcaja-print-actions">
        <Link href="/barber/caja" className="btn-new btn-new--ghost"><ArrowLeft size={14} /> {t("common.back")}</Link>
        <button type="button" className="btn-new barber-btn-primary" onClick={() => window.print()}><Printer size={14} /> {t("common.print")}</button>
        <a className="btn-new btn-new--secondary" href={waHref} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> {t("print.shareWhatsapp")}</a>
        <button type="button" className="btn-new btn-new--secondary" onClick={copyLink} disabled={shareBusy}><Link2 size={14} /> {t("print.copyLink")}</button>
      </div>

      <div className="bcaja-print">
        <div className="bcaja-print__head">
          {sale.shop.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sale.shop.logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", margin: "0 auto 8px" }} />
          )}
          <div className="bcaja-print__shop">{sale.shop.name}</div>
          {address && <div className="bcaja-print__meta">{address}</div>}
          {sale.shop.phone && <div className="bcaja-print__meta">{sale.shop.phone}</div>}
        </div>

        {sale.cancelled && (
          <div style={{ textAlign: "center" }}><span className="bcaja-print__stamp">{t("print.cancelledStamp")}</span></div>
        )}

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__row"><span>{t("print.ticketNumber")}</span><span>#{shortId}</span></div>
        <div className="bcaja-print__row"><span>{t("print.date")}</span><span>{fmtDateTime(sale.createdAt, tz)}</span></div>
        {sale.barberName && <div className="bcaja-print__row"><span>{t("print.barber")}</span><span>{sale.barberName}</span></div>}
        {sale.clientName && <div className="bcaja-print__row"><span>{t("print.client")}</span><span>{sale.clientName}</span></div>}
        <div className="bcaja-print__row"><span>{t("print.soldBy")}</span><span>{sale.soldByName}</span></div>
        <div className="bcaja-print__row"><span>{t("print.method")}</span><span>{t(PAYMENT_METHOD_KEYS[sale.paymentMethod])}</span></div>

        <hr className="bcaja-print__rule" />
        <div className="bcaja-print__section">{t("print.items")}</div>
        {sale.items.map((it) => (
          <div key={it.id} className="bcaja-print__row">
            <span>{it.qty > 1 ? `${it.qty} × ` : ""}{it.description}</span>
            <span>{fmtMoney(it.unitPrice * it.qty)}</span>
          </div>
        ))}

        <hr className="bcaja-print__rule" />
        {sale.discount > 0 && (
          <>
            <div className="bcaja-print__row"><span>{t("print.gross")}</span><span>{fmtMoney(sale.grossItems)}</span></div>
            <div className="bcaja-print__row"><span>{t("print.discount")}</span><span>−{fmtMoney(sale.discount)}</span></div>
          </>
        )}
        <div className="bcaja-print__row"><span>{t("print.subtotal")}</span><span>{fmtMoney(sale.subtotal)}</span></div>
        {sale.tip > 0 && <div className="bcaja-print__row"><span>{t("print.tip")}</span><span>{fmtMoney(sale.tip)}</span></div>}
        <div className="bcaja-print__row bcaja-print__row--total"><span>{t("print.total")}</span><span>{fmtMoney(sale.total)}</span></div>

        {!sale.cancelled && <div className="bcaja-print__thanks">{t("print.thanks")}</div>}
      </div>
    </>
  );
}
