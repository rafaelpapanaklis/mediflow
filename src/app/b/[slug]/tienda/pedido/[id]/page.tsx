import type { Metadata } from "next";
import Link from "next/link";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { getPublicOrder, isTiendaGateOk, resolveTienda } from "@/lib/barber/tienda";
import { isOpenOrderStatus, rutaTienda, waMeLink } from "@/lib/barber/tienda-core";
import { TiendaShell } from "@/components/barber/tienda/tienda-shell";
import { branchLabel, precioMx } from "@/components/barber/tienda/tienda-grid";
import { PagarEnLinea } from "@/components/barber/tienda/pagar-en-linea";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";
import "@/components/barber/tienda/tienda-publica.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/tienda/pedido/[id] — EL FOLIO (ws6-t1).

   A donde llega el cliente al apartar, y a donde lo regresa Mercado Pago
   (ws6-t5). Dice el folio, qué apartó, dónde se recoge y si se paga ahí o ya
   está pagado. El id es un UUID que solo tiene quien apartó; aun así no sale
   ni el nombre ni el teléfono. noindex siempre.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ pago?: string }>;
}

export const metadata: Metadata = { title: "Tu pedido", robots: { index: false, follow: false } };

export default async function FolioPage(props: Props) {
  const params = await props.params;
  const sp = await props.searchParams;
  const gate = await resolveTienda(params.slug);
  if (!isTiendaGateOk(gate)) {
    const t = getBarberT("es");
    return (
      <TiendaShell shop={null}>
        <div className="dcb-card" style={{ marginTop: 32, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>{t("barber.tienda.noEncontrada")}</h1>
        </div>
      </TiendaShell>
    );
  }
  const tg = getBarberT(gate.shop.locale);
  const t = (k: string, v?: Record<string, string | number>) => tg(`barber.tienda.${k}`, v);
  const o = await getPublicOrder(gate, params.id);
  if (!o) {
    return (
      <TiendaShell shop={gate.shop}>
        <div className="dcb-card" style={{ textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>{t("folio.notFound")}</h1>
          <Link href={rutaTienda(gate.shop.slug)} className="dct-back">{t("backStore")}</Link>
        </div>
      </TiendaShell>
    );
  }
  const open = isOpenOrderStatus(o.status);
  const branchName = o.branch ? (gate.branches.length > 1 ? branchLabel(o.branch) : o.branch.name) : gate.shop.name;
  const where = o.branch?.address ? `${branchName} (${o.branch.address})` : branchName;
  const until = o.expiresAt
    ? new Intl.DateTimeFormat(gate.shop.locale === "en" ? "en-US" : "es-MX", { dateStyle: "long", timeStyle: "short", timeZone: gate.shop.timezone }).format(new Date(o.expiresAt))
    : null;
  const phone = gate.shop.phone ? gate.shop.phone.replace(/\D/g, "").slice(-10) : null;
  const mapsQ = o.branch?.address ? [o.branch.address, o.branch.city].filter(Boolean).join(", ") : null;

  return (
    <TiendaShell shop={gate.shop}>
      <div className="dcb-card" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-folio={o.folio}>
        <span className={o.paidOnline ? "dcb-badge dcb-badge--ok" : open ? "dcb-badge dcb-badge--pending" : "dcb-badge dcb-badge--neutral"} style={{ alignSelf: "flex-start" }}>
          {t(`folio.status${o.status}`)}
        </span>
        <h1 className="dcb-title" style={{ margin: 0 }}>{open ? t("folio.title") : t("folio.closed")}</h1>
        <div>
          <span className="dcb-label">{t("folio.label")}</span>
          <div className="dct-folio">{o.folio}</div>
          {open ? <p className="dcb-help" style={{ margin: 0 }}>{t("folio.showFolio")}</p> : null}
        </div>
        {open ? (
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }} data-recoger>
            {o.paidOnline ? t("folio.pickupPaid", { branch: where }) : t("folio.pickup", { branch: where })}
          </p>
        ) : null}
        {until ? <p className="dcb-sub" style={{ margin: 0 }}>{t("folio.until", { when: until })}</p> : null}
        {sp.pago === "fallo" && open && !o.paidOnline ? <div className="dcb-alert dcb-alert--info" role="status">{t("reserve.payFailed")}</div> : null}
        <ul className="dct-lines">
          {o.items.map((it) => (
            <li key={it.productId}><span>{it.qty} × {it.name}</span><span>{precioMx(it.unitPrice * it.qty)}</span></li>
          ))}
        </ul>
        <div className="dct-total"><span>{t("reserve.total")}</span><strong>{precioMx(o.total)}</strong></div>
        {open && !o.paidOnline && o.status === "PENDING" ? <PagarEnLinea slug={gate.shop.slug} orderId={o.id} label={t("folio.payNow")} /> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {phone ? (
            <a className="dcb-btn dcb-btn--ghost" href={waMeLink(t("folio.waText", { folio: o.folio }), phone)} target="_blank" rel="noopener noreferrer">{t("folio.whatsapp")}</a>
          ) : null}
          {mapsQ ? (
            <a className="dcb-btn dcb-btn--ghost" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQ)}`} target="_blank" rel="noopener noreferrer">{t("folio.map")}</a>
          ) : null}
        </div>
        <Link href={rutaTienda(gate.shop.slug)} className="dct-back">{t("backStore")}</Link>
      </div>
    </TiendaShell>
  );
}
