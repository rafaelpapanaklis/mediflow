import Link from "next/link";
import { redirect } from "next/navigation";
import {
  civilDate,
  formatCivilDate,
  formatMoney,
  getOwnerScope,
  loadOwnerProperties,
  resolvePortalIdentities,
} from "@/lib/realty/portal-auth";
import { PortalSalir } from "@/components/realty/portal/portal-salir";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA PROPIETARIO — sus inmuebles.

   Qué está rentado, qué está libre y quién lo renta.

   🔴 DEL INQUILINO SOLO SALE EL NOMBRE. Ni su teléfono, ni su correo, ni
   su investigación de solvencia, ni cuánto lleva de retraso. El
   propietario tiene derecho a saber quién ocupa su casa y qué le
   depositaron; el historial de cobranza de una persona es de la
   inmobiliaria y del inquilino. La lista blanca está en loadOwnerProperties
   (portal-auth.ts): `select: { contact: { select: { name: true } } }`.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function PropietarioInicioPage() {
  const scope = await getOwnerScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const [propiedades, identidades] = await Promise.all([
    loadOwnerProperties(scope),
    resolvePortalIdentities(scope.phone),
  ]);

  return (
    <>
      <h1 className="dcr-h1">{t("inmuebles.title")}</h1>
      <p className="dcr-sub">{t("inmuebles.sub")}</p>

      <Link href="/i/portal/propietario/estado-de-cuenta" className="dcr-btn dcr-btn--primary dcr-btn--block">
        {t("nav.propietarioEstado")}
      </Link>

      {propiedades.length === 0 ? (
        <section className="dcr-card">
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("inmuebles.sinInmuebles")}</p>
            <p className="dcr-empty__body">{t("inmuebles.sinInmueblesSub")}</p>
          </div>
        </section>
      ) : (
        propiedades.map((p) => (
          <section key={p.id} className="dcr-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h2 className="dcr-h3" style={{ flex: 1 }}>
                {p.title}
              </h2>
              <span
                className={
                  p.status === "RENTADO"
                    ? "dcr-pill dcr-pill--ok"
                    : p.status === "DISPONIBLE"
                      ? "dcr-pill dcr-pill--neutral"
                      : "dcr-pill dcr-pill--wait"
                }
              >
                {t(`inmuebles.estado${p.status}`)}
              </span>
            </div>
            {p.address ? (
              <p className="dcr-muted" style={{ marginBottom: 10 }}>
                {p.address}
              </p>
            ) : null}

            {p.lease ? (
              <>
                <div className="dcr-kv">
                  <span className="dcr-kv__k">{t("contratos.inquilino")}</span>
                  <span className="dcr-kv__v">
                    {p.lease.tenantName ?? t("inmuebles.sinInquilino")}
                  </span>
                </div>
                <div className="dcr-kv">
                  <span className="dcr-kv__k">{t("inmuebles.rentaMensual")}</span>
                  <span className="dcr-kv__v">
                    {formatMoney(p.lease.rentAmount, p.lease.currency)}
                  </span>
                </div>
                <div className="dcr-kv">
                  <span className="dcr-kv__k">{t("nav.propietarioContratos")}</span>
                  <span className="dcr-kv__v">
                    {t("inmuebles.contratoHasta", {
                      fecha: formatCivilDate(civilDate(new Date(p.lease.endsAt), tz), {
                        withYear: true,
                      }),
                    })}
                  </span>
                </div>
              </>
            ) : (
              <p className="dcr-p">{t("inmuebles.sinContrato")}</p>
            )}

            <p className="dcr-muted" style={{ marginTop: 12 }}>
              {p.commissionPct && p.commissionPct > 0
                ? t("inmuebles.comision", { pct: p.commissionPct })
                : t("inmuebles.sinComision")}
            </p>
          </section>
        ))
      )}

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
