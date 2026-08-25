import { redirect } from "next/navigation";
import {
  civilDate,
  formatCivilDate,
  formatMoney,
  formatPeriodMonth,
  getTenantScope,
  loadTenantData,
} from "@/lib/realty/portal-auth";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA INQUILINO — sus documentos.

   Exactamente dos cosas: su CONTRATO firmado y sus RECIBOS de pago.

   🔴 LO QUE NO SALE AQUÍ, Y POR QUÉ. RealtyPropertyDocument guarda
   escrituras, prediales, régimen de condominio e identificaciones. Son
   papeles del INMUEBLE y de su DUEÑO, no del inquilino: la escritura dice
   quién es el propietario y cuánto pagó por la casa. Nada de eso está en
   esta pantalla ni tiene endpoint que lo entregue desde el portal del
   inquilino — no es un filtro de la interfaz, es que resolveTenantFile
   solo conoce dos tipos: "contrato" y "recibo".

   Las ligas no se guardan: se firman al vuelo y caducan en cinco minutos,
   así que una pegada en un chat deja de servir sola.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function InquilinoDocumentosPage() {
  const scope = await getTenantScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const data = await loadTenantData(scope);

  const conDocumento = data.leases.filter((l) => l.hasSignedDoc);
  const vacio = conDocumento.length === 0 && data.receipts.length === 0;

  return (
    <>
      <h1 className="dcr-h1">{t("documentos.title")}</h1>
      <p className="dcr-sub">{t("documentos.sub")}</p>

      {vacio ? (
        <section className="dcr-card">
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("documentos.sinDocumentos")}</p>
            <p className="dcr-empty__body">{t("documentos.sinDocumentosSub")}</p>
          </div>
        </section>
      ) : null}

      {conDocumento.length > 0 ? (
        <>
          <h2 className="dcr-h2">{t("documentos.contrato")}</h2>
          <section className="dcr-card">
            {conDocumento.map((l) => (
              <div key={l.id} className="dcr-item">
                <div className="dcr-item__body">
                  <p className="dcr-h3">{l.propertyTitle}</p>
                  <p className="dcr-muted">
                    {t("contrato.vigenciaValor", {
                      inicio: formatCivilDate(civilDate(new Date(l.startsAt), tz), {
                        withYear: true,
                      }),
                      fin: formatCivilDate(civilDate(new Date(l.endsAt), tz), { withYear: true }),
                    })}
                  </p>
                </div>
                <div className="dcr-item__side">
                  <a
                    className="dcr-btn dcr-btn--ghost dcr-btn--sm"
                    href={`/api/realty/portal/archivo?tipo=contrato&id=${encodeURIComponent(l.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("documentos.abrir")}
                  </a>
                </div>
              </div>
            ))}
          </section>
        </>
      ) : null}

      {data.receipts.length > 0 ? (
        <>
          <h2 className="dcr-h2">{t("documentos.recibos")}</h2>
          <section className="dcr-card">
            {data.receipts.map((p) => (
              <div key={p.id} className="dcr-item">
                <div className="dcr-item__body">
                  <p className="dcr-h3">
                    {p.periodMonth
                      ? t("pagos.periodo", { mes: formatPeriodMonth(p.periodMonth) })
                      : t("contrato.title")}
                  </p>
                  <p className="dcr-muted">
                    {formatCivilDate(civilDate(new Date(p.paidAt), tz), { withYear: true })} ·{" "}
                    {formatMoney(p.amount, data.currency)}
                  </p>
                </div>
                <div className="dcr-item__side">
                  <a
                    className="dcr-btn dcr-btn--ghost dcr-btn--sm"
                    href={`/api/realty/portal/inquilino/recibo/${encodeURIComponent(p.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("documentos.descargar")}
                  </a>
                </div>
              </div>
            ))}
          </section>
        </>
      ) : null}

      <p className="dcr-alert dcr-alert--note" style={{ marginTop: 14 }}>
        {t("documentos.avisoPrivacidad")}
      </p>
    </>
  );
}
