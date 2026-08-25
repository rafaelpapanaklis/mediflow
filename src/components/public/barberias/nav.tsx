import Link from "next/link";
import type { TFunction } from "@/i18n/t";
import {
  BARBER_LANDING_ANCHORS,
  BARBER_LANDING_PATH,
  BARBER_LOGIN_PATH,
  BARBER_REGISTER_PATH,
} from "@/lib/barber/marketing";

/** "DaleControl" con el "Dale" en caramelo, como el wordmark del sitio. */
export function BrandName({ brand }: { brand: string }) {
  const cut = brand.indexOf("Control");
  if (cut <= 0) return <>{brand}</>;
  return (
    <>
      <em>{brand.slice(0, cut)}</em>
      {brand.slice(cut)}
    </>
  );
}

/**
 * Barra pegajosa. Server component: sin menú hamburguesa a propósito — en
 * móvil quedan la marca y los dos botones que importan (entrar / empezar),
 * y las anclas aparecen a partir de 900px de ancho del contenedor. Debajo,
 * la cinta del poste (3px) es la firma del vertical.
 */
export function BarberLandingNav({ t }: { t: TFunction }) {
  const a = BARBER_LANDING_ANCHORS;
  return (
    <header className="dcbl-nav">
      <div className="dcbl-wrap dcbl-nav__in">
        <Link
          href={BARBER_LANDING_PATH}
          className="dcbl-brand"
          aria-label={`${t("nav.brand")} ${t("nav.vertical")}`}
        >
          <span className="dcbl-mark" aria-hidden="true" />
          <span className="dcbl-brand__text" aria-hidden="true">
            <span className="dcbl-brand__name">
              <BrandName brand={t("nav.brand")} />
            </span>
            <span className="dcbl-brand__tag">{t("nav.vertical")}</span>
          </span>
        </Link>

        <nav className="dcbl-nav__links" aria-label={t("nav.ariaMain")}>
          <a href={`#${a.features}`}>{t("nav.features")}</a>
          <a href={`#${a.whatsapp}`}>{t("nav.whatsapp")}</a>
          <a href={`#${a.pricing}`}>{t("nav.pricing")}</a>
          <a href={`#${a.faq}`}>{t("nav.faq")}</a>
        </nav>

        <div className="dcbl-nav__right">
          <Link href={BARBER_LOGIN_PATH} className="dcbl-btn dcbl-btn--ghost dcbl-btn--sm dcbl-nav__login">
            {t("nav.login")}
          </Link>
          <Link href={BARBER_REGISTER_PATH} className="dcbl-btn dcbl-btn--primary dcbl-btn--sm">
            <span className="dcbl-nav__cta-long">{t("nav.cta")}</span>
            <span className="dcbl-nav__cta-short">{t("nav.ctaShort")}</span>
          </Link>
        </div>
      </div>
      <div className="dcbl-tape" aria-hidden="true" />
    </header>
  );
}
