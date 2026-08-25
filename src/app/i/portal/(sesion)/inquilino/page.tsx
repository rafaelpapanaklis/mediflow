import Link from "next/link";
import { redirect } from "next/navigation";
import {
  civilDate,
  dueState,
  formatCivilDate,
  formatMoney,
  getTenantScope,
  isChargeOpen,
  loadTenantData,
  resolvePortalIdentities,
} from "@/lib/realty/portal-auth";
import { PortalSalir } from "@/components/realty/portal/portal-salir";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA INQUILINO — la primera pantalla.

   Lo primero que ve es lo único que de verdad le quita el sueño: si debe
   algo y para cuándo. Después, su contrato.

   🔴 EL TONO. "Llevas 12 días de retraso" y punto: sin rojo de alarma, sin
   signos de admiración, sin "URGENTE". Quien abre esto ya sabe que debe la
   renta —probablemente por eso entró— y humillarlo no le consigue el
   dinero. El tono más fuerte que existe en esta pantalla es un ámbar
   sobrio (ver .dcr-due--retraso en realty-portal.css).

   Y el dato que de verdad ayuda: la fecha exacta. "Vence el 5 de
   septiembre" se puede anotar; "vence pronto" no.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function InquilinoInicioPage() {
  const scope = await getTenantScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const data = await loadTenantData(scope);
  const identidades = await resolvePortalIdentities(scope.phone);

  const abiertos = data.charges
    .filter((c) => isChargeOpen(c.status) && c.amount - c.paid > 0.004)
    // El más urgente es el MÁS VIEJO sin pagar, no el siguiente por vencer:
    // si hay uno de hace dos meses, ese es el que importa.
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const urgente = abiertos[0] ?? null;
  const estado = urgente ? dueState(new Date(urgente.dueAt), new Date(), tz) : null;
  // Sin cargo abierto el tono es el tranquilo, tanto si está al corriente
  // como si la inmobiliaria todavía no le ha generado ningún cargo.
  const tono = estado?.tone ?? "alCorriente";

  const titulo = (() => {
    if (!estado) {
      return data.charges.length === 0 ? t("adeudo.sinCargos") : t("adeudo.alCorriente");
    }
    if (estado.tone === "retraso") return t("adeudo.retraso", { count: estado.daysLate });
    if (estado.tone === "venceHoy") return t("adeudo.venceHoy");
    return t("adeudo.porVencer", { fecha: formatCivilDate(estado.dueDate) });
  })();

  const subtitulo = (() => {
    if (!estado) {
      return data.charges.length === 0 ? t("adeudo.sinCargosSub") : t("adeudo.alCorrienteSub");
    }
    if (estado.tone === "retraso") {
      return t("adeudo.retrasoSub", { fecha: formatCivilDate(estado.dueDate) });
    }
    if (estado.tone === "venceHoy") return t("adeudo.venceHoySub");
    return t("adeudo.porVencerSub", { count: estado.daysLeft });
  })();

  return (
    <>
      <section className={`dcr-due dcr-due--${tono}`}>
        <p className="dcr-due__lead">{titulo}</p>
        <p className="dcr-due__sub">{subtitulo}</p>
        {data.saldo > 0 ? (
          <>
            <span className="dcr-due__amountLbl">{t("adeudo.saldo")}</span>
            <span className="dcr-due__amount">{formatMoney(data.saldo, data.currency)}</span>
            <p className="dcr-due__sub" style={{ marginTop: 4 }}>
              {t("adeudo.saldoDetalle", { count: abiertos.length })}
            </p>
            <Link
              href="/i/portal/inquilino/pagos"
              className="dcr-btn dcr-btn--primary dcr-btn--block"
              style={{ marginTop: 14 }}
            >
              {t("nav.inquilinoPagos")}
            </Link>
          </>
        ) : null}
      </section>

      <h2 className="dcr-h2">
        {data.leases.length > 1 ? t("contrato.titlePlural") : t("contrato.title")}
      </h2>

      {data.leases.length === 0 ? (
        <div className="dcr-card">
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("contrato.sinContratos")}</p>
            <p className="dcr-empty__body">{t("contrato.sinContratosSub")}</p>
          </div>
        </div>
      ) : (
        data.leases.map((l) => (
          <section key={l.id} className="dcr-card">
            <h3 className="dcr-h3">{l.propertyTitle}</h3>
            {l.propertyAddress ? (
              <p className="dcr-muted" style={{ marginBottom: 12 }}>
                {l.propertyAddress}
              </p>
            ) : null}

            <div className="dcr-kv">
              <span className="dcr-kv__k">{t("contrato.estado")}</span>
              <span className="dcr-kv__v">
                <span className={l.status === "ACTIVO" ? "dcr-pill dcr-pill--ok" : "dcr-pill dcr-pill--neutral"}>
                  {t(`contrato.estado${l.status}`)}
                </span>
              </span>
            </div>
            <div className="dcr-kv">
              <span className="dcr-kv__k">{t("contrato.vigencia")}</span>
              <span className="dcr-kv__v">
                {t("contrato.vigenciaValor", {
                  inicio: formatCivilDate(civilDate(new Date(l.startsAt), tz), { withYear: true }),
                  fin: formatCivilDate(civilDate(new Date(l.endsAt), tz), { withYear: true }),
                })}
              </span>
            </div>
            <div className="dcr-kv">
              <span className="dcr-kv__k">{t("contrato.renta")}</span>
              <span className="dcr-kv__v">{formatMoney(l.rentAmount, l.currency)}</span>
            </div>
            <div className="dcr-kv">
              <span className="dcr-kv__k">{t("contrato.diaPago")}</span>
              <span className="dcr-kv__v">{t("contrato.diaPagoValor", { dia: l.paymentDay })}</span>
            </div>
            <div className="dcr-kv">
              <span className="dcr-kv__k">{t("contrato.deposito")}</span>
              <span className="dcr-kv__v">
                {l.deposit
                  ? `${formatMoney(l.deposit.amount, l.currency)} · ${t(`contrato.deposito${l.deposit.status}`)}`
                  : l.depositAmount > 0
                    ? formatMoney(l.depositAmount, l.currency)
                    : t("contrato.sinDeposito")}
              </span>
            </div>

            {l.hasSignedDoc ? (
              <a
                className="dcr-btn dcr-btn--ghost dcr-btn--block"
                style={{ marginTop: 14 }}
                href={`/api/realty/portal/archivo?tipo=contrato&id=${encodeURIComponent(l.id)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("contrato.verDocumento")}
              </a>
            ) : (
              <p className="dcr-alert dcr-alert--note" style={{ margin: "14px 0 0" }}>
                {t("contrato.sinDocumento")}
              </p>
            )}
          </section>
        ))
      )}

      <section className="dcr-card">
        <h3 className="dcr-h3">{t("adeudo.comoPagar")}</h3>
        <p className="dcr-p" style={{ marginTop: 4 }}>
          {t("adeudo.comoPagarBody")}
        </p>
        {scope.account.phone ? (
          <a
            className="dcr-btn dcr-btn--ghost dcr-btn--block"
            style={{ marginTop: 14 }}
            href={`https://wa.me/52${scope.account.phone.replace(/\D/g, "").slice(-10)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("ayuda.escribir", { nombre: scope.account.name })}
          </a>
        ) : null}
      </section>

      <div style={{ marginTop: 18 }}>
        {identidades.length > 1 ? (
          <Link
            href="/i/portal/elegir"
            className="dcr-btn dcr-btn--ghost dcr-btn--block"
            style={{ marginBottom: 10 }}
          >
            {t("elegir.cambiar")}
          </Link>
        ) : null}
        <PortalSalir />
      </div>
    </>
  );
}
