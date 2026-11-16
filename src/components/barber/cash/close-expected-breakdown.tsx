import type { TFunction } from "@/i18n/t";
import type { CloseExpectedView } from "./close-expected";
import { fmtMoney, PAYMENT_METHOD_KEYS } from "./money";

/**
 * El cuadro «cómo se llega al esperado» del cierre de turno:
 *
 *     Fondo inicial                      $500.00
 *   + Efectivo cobrado en el turno     $1,380.00
 *       Incluye $30.00 de propinas: ya van dentro, no se suman aparte.
 *   = Esperado en efectivo             $1,880.00
 *   No está en el cajón: Tarjeta, Transferencia
 *
 * Solo las filas que SUMAN llevan importe a la derecha. Las propinas son una
 * nota de su sumando, sin columna de importe, para que nadie las sume otra
 * vez. Sin estado ni efectos: se puede pintar en una prueba.
 */
export function CloseExpectedBreakdown({ view, t }: { view: CloseExpectedView; t: TFunction }) {
  return (
    <div className="bcaja-totals">
      <div className="bcaja-totals__row" data-sum="opening">
        <span>
          <span className="bcaja-totals__op" aria-hidden="true" />
          {t("caja.openingAmount")}
        </span>
        <span>{fmtMoney(view.opening)}</span>
      </div>
      <div className="bcaja-totals__row" data-sum="cash">
        <span>
          <span className="bcaja-totals__op" aria-hidden="true">+</span>
          {t("session.cashCharged")}{" "}
          <span className="bcaja-muted">({t("session.ticketsInSession", { count: view.cashTickets })})</span>
        </span>
        <span>{fmtMoney(view.cashCharged)}</span>
      </div>
      {view.cashTipsIncluded > 0 && (
        <div className="bcaja-totals__note" data-note="tips">
          {t("session.cashChargedTips", { tips: fmtMoney(view.cashTipsIncluded) })}
        </div>
      )}
      {view.extras.map((x) => (
        <div key={x.key} className="bcaja-totals__row" data-sum={x.key}>
          <span>
            <span className="bcaja-totals__op" aria-hidden="true">{x.sign}</span>
            {t(`session.sum.${x.key}`)}
          </span>
          <span>{fmtMoney(x.amount)}</span>
        </div>
      ))}
      <div className="bcaja-totals__row bcaja-totals__row--big" data-sum="expected">
        <span>
          <span className="bcaja-totals__op" aria-hidden="true">=</span>
          {t("session.expected")}
        </span>
        <span>{fmtMoney(view.expected)}</span>
      </div>
      <div className="bcaja-totals__note">{t(view.extras.length > 0 ? "session.expectedHowFull" : "session.expectedHow")}</div>

      <div className="bcaja-totals__aside">
        <div className="bcaja-hint">{t("session.outsideDrawer")}</div>
        {view.outside.map((o) => (
          <div key={o.method} className="bcaja-totals__row" data-outside={o.method}>
            <span>
              {t(PAYMENT_METHOD_KEYS[o.method])} <span className="bcaja-muted">({o.count})</span>
            </span>
            <span>{fmtMoney(o.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
