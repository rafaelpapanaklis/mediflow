import { redirect } from "next/navigation";
import {
  civilDate,
  civilDaysBetween,
  formatCivilDate,
  formatMoney,
  getOwnerScope,
  loadOwnerLeases,
} from "@/lib/realty/portal-auth";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA PROPIETARIO — sus contratos y sus vencimientos.

   Ordenados por fecha de fin ASCENDENTE a propósito: lo primero que ve es
   lo que se le vence antes, que es la única razón por la que alguien abre
   esta pantalla. Un contrato que vence en menos de 60 días se marca.

   Del inquilino, otra vez, SOLO el nombre.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/** Ventana de aviso. Dos meses es lo que tarda re-rentar una casa. */
const AVISO_DIAS = 60;

export default async function PropietarioContratosPage() {
  const scope = await getOwnerScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const hoy = civilDate(new Date(), tz);
  const leases = await loadOwnerLeases(scope);

  return (
    <>
      <h1 className="dcr-h1">{t("contratos.title")}</h1>
      <p className="dcr-sub">{t("contratos.sub")}</p>

      {leases.length === 0 ? (
        <section className="dcr-card">
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("contratos.sinContratos")}</p>
            <p className="dcr-empty__body">{t("contratos.sinContratosSub")}</p>
          </div>
        </section>
      ) : (
        leases.map((l) => {
          const fin = civilDate(new Date(l.endsAt), tz);
          const faltan = civilDaysBetween(hoy, fin);
          const porVencer = faltan >= 0 && faltan <= AVISO_DIAS && l.status === "ACTIVO";
          return (
            <section key={l.id} className="dcr-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <h2 className="dcr-h3" style={{ flex: 1 }}>
                  {l.propertyTitle}
                </h2>
                <span
                  className={
                    faltan < 0
                      ? "dcr-pill dcr-pill--wait"
                      : porVencer
                        ? "dcr-pill dcr-pill--wait"
                        : l.status === "ACTIVO"
                          ? "dcr-pill dcr-pill--ok"
                          : "dcr-pill dcr-pill--neutral"
                  }
                >
                  {faltan < 0
                    ? t("contratos.vencido")
                    : faltan === 0
                      ? // "Vence en 0 días" no lo dice nadie.
                        t("adeudo.venceHoy")
                      : porVencer
                        ? t("contratos.vencePronto", { count: faltan })
                        : t(`contrato.estado${l.status}`)}
                </span>
              </div>

              <div className="dcr-kv">
                <span className="dcr-kv__k">{t("contratos.inquilino")}</span>
                <span className="dcr-kv__v">{l.tenantName ?? t("contratos.sinInquilino")}</span>
              </div>
              <div className="dcr-kv">
                <span className="dcr-kv__k">{t("contrato.vigencia")}</span>
                <span className="dcr-kv__v">
                  {t("contratos.vigencia", {
                    inicio: formatCivilDate(civilDate(new Date(l.startsAt), tz), {
                      withYear: true,
                    }),
                    fin: formatCivilDate(fin, { withYear: true }),
                  })}
                </span>
              </div>
              <div className="dcr-kv">
                <span className="dcr-kv__k">{t("contratos.renta")}</span>
                <span className="dcr-kv__v">{formatMoney(l.rentAmount, l.currency)}</span>
              </div>
              <div className="dcr-kv">
                <span className="dcr-kv__k">{t("contrato.diaPago")}</span>
                <span className="dcr-kv__v">{t("contratos.diaPago", { dia: l.paymentDay })}</span>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
