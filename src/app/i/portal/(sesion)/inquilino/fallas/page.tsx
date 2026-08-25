import { redirect } from "next/navigation";
import {
  PORTAL_ISSUE_MAX_CHARS,
  PORTAL_ISSUE_MAX_PHOTOS,
  PORTAL_ISSUE_MAX_PHOTO_BYTES,
  PORTAL_ISSUE_MIN_CHARS,
  civilDate,
  formatCivilDate,
  getTenantScope,
  loadTenantData,
  loadTenantIssues,
} from "@/lib/realty/portal-auth";
import { PortalReportarFalla } from "@/components/realty/portal/portal-reportar-falla";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA INQUILINO — reportar una falla y ver cómo va.

   El formulario está ARRIBA, no escondido detrás de un botón: quien entra
   aquí casi siempre viene a reportar algo, no a admirar la lista.

   El avance se pinta con tres pasos (recibido → en proceso → resuelto)
   porque es la pregunta real: "¿ya lo vieron?". Y cuando hay proveedor
   asignado se dice quién va a ir, que es la segunda pregunta.

   Alimenta el módulo de mantenimiento del panel (T4): lo que se crea aquí
   es un RealtyMaintenance normal.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const PASOS = { ABIERTO: 1, EN_PROCESO: 2, RESUELTO: 3 } as const;

export default async function InquilinoFallasPage() {
  const scope = await getTenantScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const [data, issues] = await Promise.all([loadTenantData(scope), loadTenantIssues(scope)]);

  // Solo se puede reportar sobre un contrato VIGENTE: una falla en una casa
  // que ya se entregó no la va a arreglar nadie, y ofrecerlo sería mentir.
  const contratos = data.leases
    .filter((l) => l.status === "ACTIVO" || l.status === "VENCIDO")
    .map((l) => ({ id: l.id, label: l.propertyTitle }));

  return (
    <>
      {contratos.length > 0 ? (
        <PortalReportarFalla
          contratos={contratos}
          maxFotos={PORTAL_ISSUE_MAX_PHOTOS}
          maxFotoBytes={PORTAL_ISSUE_MAX_PHOTO_BYTES}
          minCaracteres={PORTAL_ISSUE_MIN_CHARS}
          maxCaracteres={PORTAL_ISSUE_MAX_CHARS}
        />
      ) : (
        <section className="dcr-card">
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("contrato.sinContratos")}</p>
            <p className="dcr-empty__body">{t("contrato.sinContratosSub")}</p>
          </div>
        </section>
      )}

      <h2 className="dcr-h2">{t("fallas.listaTitle")}</h2>
      <section className="dcr-card">
        {issues.length === 0 ? (
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("fallas.sinReportes")}</p>
            <p className="dcr-empty__body">{t("fallas.sinReportesSub")}</p>
          </div>
        ) : (
          issues.map((issue) => {
            const paso = PASOS[issue.status];
            return (
              <article key={issue.id} className="dcr-item" style={{ display: "block" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <p className="dcr-h3" style={{ flex: 1 }}>
                    {issue.propertyTitle}
                  </p>
                  <span
                    className={
                      issue.status === "RESUELTO"
                        ? "dcr-pill dcr-pill--ok"
                        : issue.status === "EN_PROCESO"
                          ? "dcr-pill dcr-pill--neutral"
                          : "dcr-pill dcr-pill--wait"
                    }
                  >
                    {t(`fallas.estado${issue.status}`)}
                  </span>
                </div>

                <p className="dcr-p" style={{ marginTop: 4 }}>
                  {issue.description}
                </p>

                <div className="dcr-steps" aria-hidden="true">
                  <span className={paso >= 1 ? "dcr-step dcr-step--on" : "dcr-step"} />
                  <span className={paso >= 2 ? "dcr-step dcr-step--on" : "dcr-step"} />
                  <span className={paso >= 3 ? "dcr-step dcr-step--on" : "dcr-step"} />
                </div>
                <p className="dcr-steps__lbl">
                  {issue.vendorName
                    ? t("fallas.vaAIr", { quien: issue.vendorName })
                    : issue.status === "RESUELTO"
                      ? t("fallas.resuelto", {
                          fecha: formatCivilDate(
                            civilDate(new Date(issue.resolvedAt ?? issue.createdAt), tz),
                          ),
                        })
                      : t("fallas.sinAsignar")}
                </p>
                <p className="dcr-muted" style={{ marginTop: 5 }}>
                  {t("fallas.reportado", {
                    fecha: formatCivilDate(civilDate(new Date(issue.createdAt), tz), {
                      withYear: true,
                    }),
                  })}
                  {issue.photoCount > 0
                    ? ` · ${t("fallas.conFotos", { count: issue.photoCount })}`
                    : ""}
                </p>
              </article>
            );
          })
        )}
      </section>
    </>
  );
}
