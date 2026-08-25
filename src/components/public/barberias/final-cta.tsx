import Link from "next/link";
import type { TFunction } from "@/i18n/t";
import { BARBER_LOGIN_PATH, BARBER_REGISTER_PATH } from "@/lib/barber/marketing";

export function BarberFinalCta({ t }: { t: TFunction }) {
  return (
    <section className="dcbl-section dcbl-final dcbl-dark">
      <div className="dcbl-wrap">
        <div className="dcbl-final__box">
          <h2 className="dcbl-h2">{t("final.title")}</h2>
          <p className="dcbl-lead dcbl-final__body">{t("final.body")}</p>
          <Link href={BARBER_REGISTER_PATH} className="dcbl-btn dcbl-btn--primary">
            {t("final.cta")}
          </Link>
          <p className="dcbl-final__login">
            {t("final.loginHint")} <Link href={BARBER_LOGIN_PATH}>{t("final.login")}</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
