import type { ReactNode } from "react";
import type { TiendaShop } from "@/lib/barber/tienda";

/**
 * El marco de la tienda pública: el mismo tema caramelo y el mismo
 * contenedor que la reserva (.barber-shell + .dcb-public), un poco más
 * ancho, con la cabecera de la barbería.
 */
export function TiendaShell({ shop, children }: { shop: TiendaShop | null; children: ReactNode }) {
  return (
    <div className="barber-shell">
      <div className="dcb-public">
        <div className="dcb-shell dcb-shell--wide" style={{ maxWidth: 960 }}>
          {shop ? (
            <header className="dcb-head">
              {shop.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="dcb-head__logo" src={shop.logoUrl} alt="" />
              ) : (
                <span className="dcb-head__logo dcb-head__logo--fallback" aria-hidden="true">{shop.name.charAt(0).toUpperCase()}</span>
              )}
              <div>
                <a href={`/b/${encodeURIComponent(shop.slug)}`} className="dcb-head__name" style={{ color: "inherit", textDecoration: "none", display: "block" }}>{shop.name}</a>
                {shop.branchName || shop.city ? <p className="dcb-head__meta">{[shop.branchName, shop.city].filter(Boolean).join(" · ")}</p> : null}
              </div>
            </header>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
