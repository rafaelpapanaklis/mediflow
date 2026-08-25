import Link from "next/link";
import { redirect } from "next/navigation";
import {
  civilDate,
  formatCivilDate,
  formatMoney,
  formatPeriodMonth,
  getOwnerScope,
  isPeriodMonth,
  loadOwnerStatement,
  periodMonthOf,
  shiftPeriodMonth,
} from "@/lib/realty/portal-auth";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA PROPIETARIO — el estado de cuenta del mes.

   La pregunta que trae a esta persona es UNA: "¿cuánto me depositaron?".
   Está en la caja verde, en grande, y los tres números que la explican
   están justo encima en el orden de la resta.

   El mes se cambia con dos ligas (?mes=YYYY-MM). Sin JavaScript, sin
   selector: dos flechas que el pulgar alcanza. Y el mes siguiente al
   actual se desactiva — un corte del futuro no existe.

   🔴 Los números salen de buildOwnerStatement (puro, portal-core), el
   MISMO que arma el PDF. La pantalla y el papel no pueden discrepar.

   🔴 Los costos de mantenimiento se enseñan como INFORMACIÓN y no se
   restan. Cuando la inmobiliaria paga la reparación la captura como gasto;
   restarla otra vez le cobraría dos veces la misma plomería. La pantalla
   lo dice con todas sus letras en vez de dejarlo a la interpretación.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { mes?: string };
}

export default async function PropietarioEstadoPage({ searchParams }: PageProps) {
  const scope = await getOwnerScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const hoy = periodMonthOf(new Date(), tz);
  const mes = isPeriodMonth(searchParams.mes) ? searchParams.mes : hoy;

  const data = await loadOwnerStatement(scope, mes);
  if (!data) redirect("/i/portal/propietario/estado-de-cuenta");

  const money = (n: number) => formatMoney(n, data.currency);
  const anterior = shiftPeriodMonth(mes, -1);
  const siguiente = shiftPeriodMonth(mes, 1);
  const hayFuturo = siguiente > hoy;

  const filas = data.statement.porInmueble.filter((p) => p.cobrado !== 0 || p.gastos !== 0);
  const sinMovimientos = filas.length === 0 && data.expenses.length === 0;

  return (
    <>
      <h1 className="dcr-h1">{t("estado.title")}</h1>
      <p className="dcr-sub">{t("estado.sub")}</p>

      <nav className="dcr-months" aria-label={t("estado.mes")}>
        <Link
          className="dcr-months__arrow"
          href={`/i/portal/propietario/estado-de-cuenta?mes=${anterior}`}
          aria-label={t("estado.mesAnterior")}
        >
          ‹
        </Link>
        <span className="dcr-months__now">{formatPeriodMonth(mes)}</span>
        <Link
          className="dcr-months__arrow"
          href={`/i/portal/propietario/estado-de-cuenta?mes=${siguiente}`}
          aria-label={t("estado.mesSiguiente")}
          aria-disabled={hayFuturo ? "true" : undefined}
          tabIndex={hayFuturo ? -1 : undefined}
        >
          ›
        </Link>
      </nav>

      {sinMovimientos ? (
        <section className="dcr-card">
          <div className="dcr-empty">
            <p className="dcr-empty__title">
              {t("estado.sinMovimientos", { mes: formatPeriodMonth(mes) })}
            </p>
            <p className="dcr-empty__body">{t("estado.sinMovimientosSub")}</p>
          </div>
        </section>
      ) : (
        <>
          <section className="dcr-card">
            <div className="dcr-kv">
              <span className="dcr-kv__k">
                {t("estado.cobrado")}
                <br />
                <span style={{ fontSize: 12 }}>{t("estado.cobradoAyuda")}</span>
              </span>
              <span className="dcr-kv__v">{money(data.statement.cobrado)}</span>
            </div>
            <div className="dcr-kv">
              <span className="dcr-kv__k">
                {t("estado.retenido")}
                <br />
                <span style={{ fontSize: 12 }}>
                  {data.statement.sinComisionPactada
                    ? t("estado.sinComisionPactada")
                    : t("estado.retenidoAyuda")}
                </span>
              </span>
              <span className="dcr-kv__v">− {money(data.statement.retenido)}</span>
            </div>
            <div className="dcr-kv">
              <span className="dcr-kv__k">
                {t("estado.gastos")}
                <br />
                <span style={{ fontSize: 12 }}>{t("estado.gastosAyuda")}</span>
              </span>
              <span className="dcr-kv__v">− {money(data.statement.gastos)}</span>
            </div>
          </section>

          <div className="dcr-total">
            <span>
              <span className="dcr-total__lbl">{t("estado.depositado")}</span>
              <span className="dcr-total__help">{t("estado.depositadoAyuda")}</span>
            </span>
            <span className="dcr-total__val">{money(data.statement.depositado)}</span>
          </div>

          <a
            className="dcr-btn dcr-btn--ghost dcr-btn--block"
            style={{ marginTop: 14 }}
            href={`/api/realty/portal/propietario/estado-de-cuenta?mes=${mes}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("estado.descargarPdf")}
          </a>

          {filas.length > 0 ? (
            <>
              <h2 className="dcr-h2">{t("estado.porInmueble")}</h2>
              <section className="dcr-card">
                {filas.map((p) => (
                  <div key={p.propertyId} className="dcr-item">
                    <div className="dcr-item__body">
                      <p className="dcr-h3">{data.propertyTitles[p.propertyId] ?? ""}</p>
                      <p className="dcr-muted">
                        {t("estado.cobrado")}: {money(p.cobrado)} · {t("estado.retenido")}:{" "}
                        {money(p.retenido)} · {t("estado.gastos")}: {money(p.gastos)}
                      </p>
                    </div>
                    <div className="dcr-item__side">
                      <span className="dcr-item__amount">{money(p.depositado)}</span>
                    </div>
                  </div>
                ))}
              </section>
            </>
          ) : null}

          <h2 className="dcr-h2">{t("estado.detalleGastos")}</h2>
          <section className="dcr-card">
            {data.expenses.length === 0 ? (
              <p className="dcr-p">{t("estado.sinGastos")}</p>
            ) : (
              data.expenses.map((g) => (
                <div key={g.id} className="dcr-item">
                  <div className="dcr-item__body">
                    <p className="dcr-h3">{t(`estado.gasto${g.kind}`)}</p>
                    <p className="dcr-muted">
                      {formatCivilDate(civilDate(new Date(g.paidAt), tz))} ·{" "}
                      {data.propertyTitles[g.propertyId] ?? ""}
                    </p>
                    {g.note ? (
                      <p className="dcr-muted" style={{ marginTop: 3 }}>
                        {g.note}
                      </p>
                    ) : null}
                  </div>
                  <div className="dcr-item__side">
                    <span className="dcr-item__amount">{money(g.amount)}</span>
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}

      {data.maintenances.length > 0 ? (
        <>
          <h2 className="dcr-h2">{t("mantenimientos.title")}</h2>
          <section className="dcr-card">
            {data.maintenances.map((m) => (
              <div key={m.id} className="dcr-item">
                <div className="dcr-item__body">
                  <p className="dcr-h3">{m.propertyTitle}</p>
                  <p className="dcr-p">{m.description}</p>
                  <p className="dcr-muted" style={{ marginTop: 3 }}>
                    {formatCivilDate(civilDate(new Date(m.createdAt), tz))} ·{" "}
                    {t(`fallas.estado${m.status}`)}
                  </p>
                </div>
                <div className="dcr-item__side">
                  <span className="dcr-item__amount">
                    {m.cost === null ? "—" : money(m.cost)}
                  </span>
                </div>
              </div>
            ))}
          </section>
          <p className="dcr-alert dcr-alert--note" style={{ marginTop: 12 }}>
            {t("estado.avisoMantenimiento")}
          </p>
        </>
      ) : null}
    </>
  );
}
