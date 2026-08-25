import { Check } from "lucide-react";
import type { TFunction } from "@/i18n/t";

/**
 * La escena de la portada: un recordatorio por WhatsApp, la agenda del día
 * y el ticket del barbero. Puro HTML + CSS (cero JS, cero imágenes): pesa
 * nada y pinta en el primer render. Los nombres y montos son de ejemplo —
 * ningún precio de plan vive aquí.
 *
 * Es UNA imagen para el lector de pantalla (role="img" + aria-label): el
 * texto de las tarjetas es decorativo y se oculta con aria-hidden.
 */
export function BarberHeroStage({ t }: { t: TFunction }) {
  return (
    <div className="dcbl-stage" role="img" aria-label={t("hero.mock.aria")}>
      <div className="dcbl-card dcbl-card--wa" aria-hidden="true">
        <div className="dcbl-card__head">
          <span className="dcbl-card__dot" />
          <span>{t("hero.mock.waTitle")}</span>
        </div>
        <div className="dcbl-thread">
          <p className="dcbl-bubble dcbl-bubble--in">{t("hero.mock.waMsg")}</p>
          <p className="dcbl-bubble dcbl-bubble--out">{t("hero.mock.waReply")}</p>
          <p className="dcbl-thread__status">
            <Check size={14} />
            <span>{t("hero.mock.waStatus")}</span>
          </p>
        </div>
      </div>

      <div className="dcbl-card dcbl-card--agenda" aria-hidden="true">
        <div className="dcbl-card__head">{t("hero.mock.agendaTitle")}</div>
        <div className="dcbl-agenda">
          <div className="dcbl-agenda__col">
            <span className="dcbl-agenda__chair">{t("hero.mock.chairA")}</span>
            <span className="dcbl-slot">{t("hero.mock.slotA1")}</span>
            <span className="dcbl-slot dcbl-slot--hot">{t("hero.mock.slotA2")}</span>
          </div>
          <div className="dcbl-agenda__col">
            <span className="dcbl-agenda__chair">{t("hero.mock.chairB")}</span>
            <span className="dcbl-slot">{t("hero.mock.slotB1")}</span>
            <span className="dcbl-slot dcbl-slot--free">{t("hero.mock.slotB2")}</span>
          </div>
        </div>
      </div>

      <div className="dcbl-card dcbl-card--ticket" aria-hidden="true">
        <div className="dcbl-card__head">{t("hero.mock.ticketTitle")}</div>
        <div className="dcbl-ticket">
          <div className="dcbl-ticket__row">
            <span>{t("hero.mock.ticketService")}</span>
            <span>{t("hero.mock.ticketServiceAmount")}</span>
          </div>
          <div className="dcbl-ticket__row">
            <span>{t("hero.mock.ticketTip")}</span>
            <span>{t("hero.mock.ticketTipAmount")}</span>
          </div>
          <div className="dcbl-ticket__row dcbl-ticket__row--total">
            <span>{t("hero.mock.ticketCommission")}</span>
            <span>{t("hero.mock.ticketCommissionAmount")}</span>
          </div>
          <p className="dcbl-ticket__note">{t("hero.mock.ticketNote")}</p>
        </div>
      </div>
    </div>
  );
}
