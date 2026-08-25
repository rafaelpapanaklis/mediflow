import Link from "next/link";
import { Scissors } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import {
  BARBER_LANDING_ANCHORS,
  BARBER_LOGIN_PATH,
  BARBER_REGISTER_PATH,
} from "@/lib/barber/marketing";

export function BarberFooter({ t, year }: { t: TFunction; year: number }) {
  const a = BARBER_LANDING_ANCHORS;
  return (
    <footer className="dcbl-footer">
      <div className="dcbl-wrap">
        <div className="dcbl-footer__grid">
          <div>
            <div className="dcbl-brand">
              <span className="dcbl-brand__glyph" aria-hidden="true">
                <Scissors size={18} />
              </span>
              <span className="dcbl-brand__text">
                <span className="dcbl-brand__name" style={{ color: "#faf5ee" }}>
                  {t("nav.brand")}
                </span>
                <span className="dcbl-brand__tag">{t("nav.vertical")}</span>
              </span>
            </div>
            <p className="dcbl-footer__tagline">{t("footer.tagline")}</p>
          </div>
          <div className="dcbl-footer__col">
            <h3>{t("footer.product")}</h3>
            <ul>
              <li>
                <a href={`#${a.features}`}>{t("nav.features")}</a>
              </li>
              <li>
                <a href={`#${a.pricing}`}>{t("nav.pricing")}</a>
              </li>
              <li>
                <a href={`#${a.faq}`}>{t("nav.faq")}</a>
              </li>
              <li>
                <Link href={BARBER_REGISTER_PATH}>{t("footer.register")}</Link>
              </li>
              <li>
                <Link href={BARBER_LOGIN_PATH}>{t("footer.login")}</Link>
              </li>
            </ul>
          </div>
          <div className="dcbl-footer__col">
            <h3>{t("footer.legal")}</h3>
            <ul>
              <li>
                <Link href="/terminos">{t("footer.terms")}</Link>
              </li>
              <li>
                <Link href="/privacidad">{t("footer.privacy")}</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="dcbl-footer__bottom">
          <span>{t("footer.rights", { year })}</span>
          <Link href="/">{t("footer.dental")}</Link>
        </div>
      </div>
    </footer>
  );
}
