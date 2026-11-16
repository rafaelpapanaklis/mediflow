"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { SaleDetail } from "@/lib/barber/cash";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, PAYMENT_METHOD_KEYS } from "./money";
import { ticketPrintLines } from "./print-lines";
import { PrintSetupControls, printWithWidth, usePrintSetup } from "./print-setup";
import { ChatClienteLink } from "../wa-chat";

/** Ticket imprimible / compartible. Todo el dinero viene ya calculado del server. */
export function TicketPrint({
  sale,
  dict,
  starsCardPath = null,
}: {
  sale: SaleDetail;
  dict: Dictionary;
  /** Ruta de la tarjeta de estrellas del cliente (null = sin QR). */
  starsCardPath?: string | null;
}) {
  const t = useBarberT(dict);
  // El enlace ABSOLUTO se arma en el navegador (el dominio con el que se abrió
  // el panel), igual que el QR de la pantalla «Cobrado».
  const [starsCardUrl, setStarsCardUrl] = useState<string | null>(null);
  useEffect(() => {
    setStarsCardUrl(starsCardPath ? `${window.location.origin}${starsCardPath}` : null);
  }, [starsCardPath]);
  // Hoja carta o impresora térmica de 80/58 mm (recordado en este navegador).
  const printSetup = usePrintSetup();
  const ticketRef = useRef<HTMLDivElement | null>(null);
  const thermal = printSetup.width !== "letter";
  // «Reimprimir» desde la ficha del cliente abre ?imprimir=1: el diálogo de
  // impresión sale solo, con el ancho guardado en este navegador (se lee en
  // un efecto de usePrintSetup; por eso la espera corta y el ref).
  const widthRef = useRef(printSetup.width);
  widthRef.current = printSetup.width;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("imprimir") !== "1") return;
    const id = window.setTimeout(() => printWithWidth(widthRef.current, ticketRef), 400);
    return () => window.clearTimeout(id);
  }, []);
  const tz = sale.shop.timezone;
  const shortId = sale.id.slice(-6).toUpperCase();
  const shareText = t("print.shareText", { shop: sale.shop.name, total: fmtMoney(sale.total) });
  // Con WhatsApp conectado y la ventana de 24 h abierta, el ticket se manda
  // desde Mensajes con el texto ya escrito; si no, wa.me como siempre (ws6-t8).

  const address = [sale.shop.address, sale.shop.city, sale.shop.state].filter(Boolean).join(", ");

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
          withLogo={Boolean(sale.shop.logoUrl)}
          onPrint={() => printWithWidth(printSetup.width, ticketRef)}
        />
        <ChatClienteLink className="btn-new btn-new--secondary" phone={sale.clientPhone} texto={shareText}><MessageCircle size={14} /> {t("print.shareWhatsapp")}</ChatClienteLink>
      </div>

      <div className={`bcaja-print ${printSetup.className}`.trim()} ref={ticketRef} data-ancho-impresion={printSetup.width}>
        <div className="bcaja-print__head">
          {sale.shop.logoUrl && (!thermal || printSetup.logo) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="bcaja-print__logo" src={sale.shop.logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", margin: "0 auto 8px" }} />
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
        {ticketPrintLines(sale.items, sale.discount > 0).map((it) => (
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

        {/* ws6-t1: «Escanea y ve tus estrellas» con el enlace personal del cliente. */}
        {!sale.cancelled && starsCardUrl && (
          <div className="bcaja-print__qr" data-qr-tarjeta>
            <div className="bcaja-print__qr-label">{t("print.starsCardQr")}</div>
            <QRCodeSVG value={starsCardUrl} size={128} level="M" marginSize={2} className="bcaja-print__qr-code" />
          </div>
        )}
      </div>
    </>
  );
}
