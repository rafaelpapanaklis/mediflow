import { redirect } from "next/navigation";
import {
  civilDate,
  dueState,
  formatCivilDate,
  formatMoney,
  formatPeriodMonth,
  getTenantScope,
  isChargeOpen,
  loadTenantData,
} from "@/lib/realty/portal-auth";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA INQUILINO — sus pagos.

   Arriba lo que debe; abajo lo que ya pagó, con su recibo.

   🔴 RECIBO, NUNCA FACTURA. Este vertical no timbra CFDI: el PDF lo dice
   en el pie y la pantalla lo repite. Que alguien crea que ya tiene su
   deducible y lo descubra en abril es peor que no darle nada.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function InquilinoPagosPage() {
  const scope = await getTenantScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const data = await loadTenantData(scope);

  const pendientes = data.charges
    .filter((c) => isChargeOpen(c.status) && c.amount - c.paid > 0.004)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  return (
    <>
      <h1 className="dcr-h1">{t("pagos.title")}</h1>
      <p className="dcr-sub">{t("pagos.sub")}</p>

      <h2 className="dcr-h2">{t("pagos.pendientes")}</h2>
      <section className="dcr-card">
        {pendientes.length === 0 ? (
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("pagos.sinPendientes")}</p>
            <p className="dcr-empty__body">{t("adeudo.alCorrienteSub")}</p>
          </div>
        ) : (
          pendientes.map((c) => {
            const estado = dueState(new Date(c.dueAt), new Date(), tz);
            return (
              <div key={c.id} className="dcr-item">
                <div className="dcr-item__body">
                  <p className="dcr-h3">{t("pagos.periodo", { mes: formatPeriodMonth(c.periodMonth) })}</p>
                  <p className="dcr-muted">
                    {estado.tone === "retraso"
                      ? t("adeudo.retraso", { count: estado.daysLate })
                      : estado.tone === "venceHoy"
                        ? t("adeudo.venceHoy")
                        : t("pagos.vence", { fecha: formatCivilDate(estado.dueDate) })}
                  </p>
                  {c.paid > 0 ? (
                    <p className="dcr-muted" style={{ marginTop: 3 }}>
                      {t("pagos.restante", {
                        monto: formatMoney(c.amount - c.paid, data.currency),
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="dcr-item__side">
                  <span className="dcr-item__amount">{formatMoney(c.amount, data.currency)}</span>
                  <span
                    className={
                      estado.tone === "retraso" ? "dcr-pill dcr-pill--wait" : "dcr-pill dcr-pill--neutral"
                    }
                  >
                    {t(`pagos.estado${c.status}`)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </section>

      <h2 className="dcr-h2">{t("pagos.historial")}</h2>
      <section className="dcr-card">
        {data.receipts.length === 0 ? (
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("pagos.sinPagos")}</p>
            <p className="dcr-empty__body">{t("pagos.sinPagosSub")}</p>
          </div>
        ) : (
          data.receipts.map((p) => (
            <div key={p.id} className="dcr-item">
              <div className="dcr-item__body">
                <p className="dcr-h3">
                  {p.periodMonth
                    ? t("pagos.periodo", { mes: formatPeriodMonth(p.periodMonth) })
                    : t("contrato.title")}
                </p>
                <p className="dcr-muted">
                  {formatCivilDate(civilDate(new Date(p.paidAt), tz), { withYear: true })} ·{" "}
                  {t(`pagos.metodo${p.method}`)}
                </p>
                {p.reference ? (
                  <p className="dcr-muted" style={{ marginTop: 3 }}>
                    {t("pagos.referencia")}: {p.reference}
                  </p>
                ) : null}
                <a
                  className="dcr-btn dcr-btn--ghost dcr-btn--sm"
                  style={{ marginTop: 9 }}
                  href={`/api/realty/portal/inquilino/recibo/${encodeURIComponent(p.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("pagos.descargarRecibo")}
                </a>
              </div>
              <div className="dcr-item__side">
                <span className="dcr-item__amount">{formatMoney(p.amount, data.currency)}</span>
                <span className="dcr-pill dcr-pill--ok">{t("pagos.estadoPAGADO")}</span>
              </div>
            </div>
          ))
        )}
      </section>

      <p className="dcr-alert dcr-alert--note" style={{ marginTop: 14 }}>
        {t("pagos.avisoRecibo")}
      </p>
    </>
  );
}
