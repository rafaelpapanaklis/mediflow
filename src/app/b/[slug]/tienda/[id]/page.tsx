import type { Metadata } from "next";
import Link from "next/link";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { isTiendaGateOk, loadTiendaProduct, portalPrefill, resolveTienda } from "@/lib/barber/tienda";
import { rutaProductoTienda, rutaTienda, waMeLink } from "@/lib/barber/tienda-core";
import { getPortalSession } from "@/lib/barber/client-portal";
import { barberCaptchaSiteKey } from "@/lib/barber/captcha";
import { TiendaShell } from "@/components/barber/tienda/tienda-shell";
import { branchLabel, precioMx } from "@/components/barber/tienda/tienda-grid";
import { ApartarForm } from "@/components/barber/tienda/apartar";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";
import "@/components/barber/tienda/tienda-publica.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/tienda/[id] — LA LIGA DE COMPRA de un producto (ws6-t1).

   Es lo que la barbería comparte («Copiar liga» / «Compartir por WhatsApp»):
   foto, nombre, precio, descripción, existencias y «Apartar». og:image = la
   foto del producto, para que la vista previa de WhatsApp la enseñe. Solo
   existe si el producto está activo y marcado «Mostrar en mi página»; si no,
   «no disponible» (sin decir por qué).
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

interface Props {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const gate = await resolveTienda(params.slug);
  if (!isTiendaGateOk(gate)) return { title: "Tienda no disponible", robots: { index: false, follow: false } };
  const p = await loadTiendaProduct(gate, params.id);
  if (!p) return { title: "Producto no disponible", robots: { index: false, follow: false } };
  const t = getBarberT(gate.shop.locale);
  const title = t("barber.tienda.meta.productTitle", { name: p.name, shop: gate.shop.name });
  const description = p.description || t("barber.tienda.meta.productDescription", { name: p.name, price: precioMx(p.price), shop: gate.shop.name });
  const url = `${SITE_URL}${rutaProductoTienda(gate.shop.slug, p.id)}`;
  const image = p.photoUrl ?? gate.shop.logoUrl;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "es_MX", url, siteName: gate.shop.name, title, description, images: image ? [image] : [] },
    twitter: { card: p.photoUrl ? "summary_large_image" : "summary", title, description, images: image ? [image] : [] },
  };
}

export default async function ProductoTiendaPage(props: Props) {
  const params = await props.params;
  const gate = await resolveTienda(params.slug);
  const tEs = getBarberT("es");
  if (!isTiendaGateOk(gate)) {
    return (
      <TiendaShell shop={null}>
        <div className="dcb-card" style={{ marginTop: 32, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>{tEs("barber.tienda.noEncontrada")}</h1>
        </div>
      </TiendaShell>
    );
  }
  const tg = getBarberT(gate.shop.locale);
  const t = (k: string, v?: Record<string, string | number>) => tg(`barber.tienda.${k}`, v);
  const p = await loadTiendaProduct(gate, params.id);
  const back = (
    <Link href={rutaTienda(gate.shop.slug)} className="dct-back">← {t("backStore")}</Link>
  );
  if (!p) {
    return (
      <TiendaShell shop={gate.shop}>
        <div className="dct-head">{back}</div>
        <div className="dcb-card" style={{ textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>{t("noEncontrada")}</h1>
        </div>
      </TiendaShell>
    );
  }
  const branch = gate.branches.find((b) => b.id === p.branchId) ?? null;
  const multi = gate.branches.length > 1;
  const prefill = p.orderable && p.available > 0 ? await portalPrefill(gate, (id) => getPortalSession(id)) : null;
  const dict = (getBarberDict(gate.shop.locale).barber as Dictionary).tienda as Dictionary;
  const tagCls = p.tag === "out" ? "dct-tag dct-tag--out" : p.tag === "low" ? "dct-tag dct-tag--low" : "dct-tag";
  const tagLabel = p.tag === "out" ? t("tagOut") : p.tag === "low" ? t("tagLow") : t("tagAvailable");
  const phone = gate.shop.phone ? gate.shop.phone.replace(/\D/g, "").slice(-10) : null;

  return (
    <TiendaShell shop={gate.shop}>
      <div className="dct-head">{back}</div>
      <div className="dct-product" data-producto={p.id}>
        <div className="dct-product__photo">
          {p.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photoUrl} alt={p.name} />
          ) : (
            <div className="dct-ph" style={{ fontSize: 72 }} aria-hidden="true">{(p.name.trim().charAt(0) || "?").toUpperCase()}</div>
          )}
          <span className={tagCls}>{tagLabel}</span>
        </div>
        <div className="dct-product__info">
          {p.category ? <span className="dct-cat">{p.category}</span> : null}
          <h1 className="dct-product__name">{p.name}</h1>
          <span className="dct-product__price">{precioMx(p.price)}</span>
          {p.description ? <p className="dct-product__desc">{p.description}</p> : null}
          <div className="dct-meta">
            {p.available > 0 && p.tag === "low" ? <span>{t("left", { count: p.available })}</span> : null}
            {branch ? <span>{t("pickupAt", { branch: multi ? branchLabel(branch) : branch.address || branch.name })}</span> : null}
          </div>
          {p.available <= 0 ? (
            <div className="dcb-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p className="dcb-sub" style={{ margin: 0 }}>{t("outBody")}</p>
              {phone ? (
                <a className="dcb-btn dcb-btn--ghost" href={waMeLink(`${p.name}`, phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              ) : null}
            </div>
          ) : p.orderable ? (
            <ApartarForm
              dict={dict}
              slug={gate.shop.slug}
              productId={p.id}
              price={p.price}
              available={p.available}
              locale={gate.shop.locale}
              captchaSiteKey={barberCaptchaSiteKey()}
              prefill={prefill}
            />
          ) : (
            <p className="dcb-sub" style={{ margin: 0 }}>{t("onlyInStore")}</p>
          )}
        </div>
      </div>
    </TiendaShell>
  );
}
