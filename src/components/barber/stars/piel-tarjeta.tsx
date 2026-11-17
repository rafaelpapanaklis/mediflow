import type { CSSProperties, ReactNode } from "react";
import { acentoBarberWeb, plantillaOfrecidaBarberWeb, rutaWebBarberia } from "@/lib/barber/landing";

/* ═══════════════════════════════════════════════════════════════════════
   El marco de la tarjeta de estrellas con la piel de la plantilla de la
   barbería (ws6-t2): su barra con la marca, sus letras y su acento.

   Lo usan «Mi tarjeta» y la tarjeta por enlace. Sin "use client": se pinta
   en el servidor y envuelve lo que venga (también componentes de navegador).
   Los estilos están en ./piel-tarjeta.css (lo importa cada página).
   ═══════════════════════════════════════════════════════════════════════ */

export function PielTarjeta({
  template,
  acento,
  shop,
  children,
}: {
  /** Plantilla guardada en Mi web (cualquier id: una vieja se viste de Oficio). */
  template: unknown;
  acento: string | null | undefined;
  shop: { name: string; slug: string; logoUrl: string | null; branchName?: string | null };
  children: ReactNode;
}) {
  const piel = plantillaOfrecidaBarberWeb(template);
  const a = acentoBarberWeb(acento);
  const vars = {
    "--piel-acento": a.base,
    "--piel-acento-fuerte": a.fuerte,
    "--piel-acento-suave": a.suave,
    "--piel-acento-claro": a.claro,
  } as CSSProperties;
  const inicial = (shop.name.normalize("NFC").match(/[\p{L}\p{N}]/u)?.[0] ?? "★").toUpperCase();

  return (
    <div className="barber-shell">
      <div className={`dcb-piel dcb-piel--${piel}`} style={vars} data-piel={piel}>
        <header className="dcb-piel__barra">
          <div className="dcb-piel__barra-in">
            <a className="dcb-piel__marca" href={rutaWebBarberia(shop.slug)}>
              {shop.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="dcb-piel__logo" src={shop.logoUrl} alt="" width={36} height={36} />
              ) : (
                <span className="dcb-piel__logo dcb-piel__logo--letra" aria-hidden="true">
                  {inicial}
                </span>
              )}
              <span className="dcb-piel__nombre">{shop.name}</span>
            </a>
            {shop.branchName ? <span className="dcb-piel__sede">{shop.branchName}</span> : null}
          </div>
        </header>
        <div className="dcb-piel__filete" aria-hidden="true" />
        <div className="dcb-public">
          <div className="dcb-shell">{children}</div>
        </div>
      </div>
    </div>
  );
}
