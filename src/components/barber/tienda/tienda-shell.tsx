import type { ReactNode } from "react";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type { TiendaShop } from "@/lib/barber/tienda";
import { rutaReservaBarberia, rutaWebBarberia } from "@/lib/barber/landing";

/**
 * El marco de la tienda pública: el mismo tema caramelo y el mismo
 * contenedor que la reserva (.barber-shell + .dcb-public), un poco más
 * ancho, con la cabecera de la barbería.
 *
 * La cabecera es una barra PEGADA arriba (16-nov): «← Volver a <barbería>»
 * y «Reservar cita» se quedan a la vista en la tienda, en cada producto y en
 * el pedido, por mucho que se baje. Sticky y no fixed: .dcb-public es un
 * contenedor de consulta y un fixed se anclaría a él.
 */
export function TiendaShell({ shop, children }: { shop: TiendaShop | null; children: ReactNode }) {
  const t = getBarberT(shop?.locale ?? "es");
  return (
    <div className="barber-shell">
      <div className="dcb-public">
        <div className="dcb-shell dcb-shell--wide" style={{ maxWidth: 960 }}>
          {shop ? (
            <header className="dct-barra" data-tienda-barra>
              <a href={rutaWebBarberia(shop.slug)} className="dct-barra__volver" data-accion="volver-barberia">
                <span className="dct-barra__flecha" aria-hidden="true">←</span>
                {shop.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="dcb-head__logo dct-barra__logo" src={shop.logoUrl} alt="" />
                ) : (
                  <span className="dcb-head__logo dcb-head__logo--fallback dct-barra__logo" aria-hidden="true">
                    {shop.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="dct-barra__txt">
                  <span className="dct-barra__nombre">{t("barber.tienda.backTo", { shop: shop.name })}</span>
                  {shop.branchName || shop.city ? (
                    <span className="dct-barra__meta">{[shop.branchName, shop.city].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
              </a>
              <a href={rutaReservaBarberia(shop.slug)} className="dcb-btn dcb-btn--primary dcb-btn--sm dct-barra__reservar" data-accion="reservar">
                {t("barber.tienda.book")}
              </a>
            </header>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
