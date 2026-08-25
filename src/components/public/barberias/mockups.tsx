import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import type { TFunction } from "@/i18n/t";
import { BarberPole } from "./pole";
import { BarberPoleUpgrade } from "./pole-upgrade";

function enter(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}

/**
 * La escena de la portada: el poste de barbero y, a su lado, un
 * recordatorio por WhatsApp, la agenda del día y el ticket del barbero
 * (impreso como recibo). Puro HTML + CSS: pesa nada y pinta en el primer
 * render. Los nombres y montos son de ejemplo — ningún precio de plan vive
 * aquí.
 *
 * Es UNA imagen para el lector de pantalla (role="img" + aria-label): el
 * texto de las tarjetas es decorativo y se oculta con aria-hidden.
 *
 * El poste 3D (three.js) lo monta BarberPoleUpgrade encima del poste CSS,
 * solo en escritorio capaz y después de que la página cargó; en móvil, sin
 * WebGL o con menos movimiento, se queda el poste CSS para siempre.
 */
export function BarberHeroStage({ t }: { t: TFunction }) {
  return (
    <div className="dcbl-stage" role="img" aria-label={t("hero.mock.aria")}>
      <div className="dcbl-pole-host" aria-hidden="true">
        <BarberPole />
        <BarberPoleUpgrade />
      </div>

      <div className="dcbl-card dcbl-card--wa dcbl-enter" style={enter(160)} aria-hidden="true">
        <div className="dcbl-card__head">
          <span className="dcbl-card__dot" />
          <span>{t("hero.mock.waTitle")}</span>
        </div>
        <div className="dcbl-thread">
          <p className="dcbl-bubble dcbl-bubble--in">{t("hero.mock.waMsg")}</p>
          <p className="dcbl-bubble dcbl-bubble--out dcbl-enter-always" style={enter(900)}>
            {t("hero.mock.waReply")}
          </p>
          <p className="dcbl-thread__status dcbl-enter-always" style={enter(1500)}>
            <Check size={14} />
            <span>{t("hero.mock.waStatus")}</span>
          </p>
        </div>
      </div>

      <div className="dcbl-card dcbl-card--agenda dcbl-enter" style={enter(300)} aria-hidden="true">
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

      <div className="dcbl-card dcbl-card--ticket dcbl-receipt dcbl-enter" style={enter(440)} aria-hidden="true">
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
