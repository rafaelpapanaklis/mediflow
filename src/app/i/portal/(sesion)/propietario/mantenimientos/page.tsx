import { redirect } from "next/navigation";
import {
  civilDate,
  formatCivilDate,
  formatMoney,
  getOwnerScope,
  loadOwnerMaintenances,
  sumMoney,
} from "@/lib/realty/portal-auth";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   CARA PROPIETARIO — mantenimientos de sus inmuebles, con su costo.

   Es la contraparte de la pantalla de fallas del inquilino: lo que el
   inquilino reporta desde su celular aparece aquí, con el proveedor que lo
   atendió y lo que costó.

   Del reporte NO sale quién lo mandó: `reportedBy` guarda el nombre del
   inquilino y en esta pantalla no se pinta. El propietario ya sabe quién
   vive en su casa (lo ve en Mis inmuebles); repetirlo en cada queja
   convertiría la lista en un expediente de conducta.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function PropietarioMantenimientosPage() {
  const scope = await getOwnerScope();
  if (!scope) redirect("/i/portal");

  const t = portalT();
  const tz = scope.account.timezone;
  const items = await loadOwnerMaintenances(scope);
  // La moneda sale del inmueble; un corte que mezclara pesos y dólares
  // en un solo total sería un número sin significado, así que el total
  // solo se pinta cuando TODOS coinciden.
  const total = sumMoney(items.map((m) => m.cost));
  const monedas = Array.from(new Set(items.map((m) => m.currency)));
  const monedaUnica = monedas.length === 1 ? monedas[0] : null;

  return (
    <>
      <h1 className="dcr-h1">{t("mantenimientos.title")}</h1>
      <p className="dcr-sub">{t("mantenimientos.sub")}</p>

      {items.length === 0 ? (
        <section className="dcr-card">
          <div className="dcr-empty">
            <p className="dcr-empty__title">{t("mantenimientos.sinMantenimientos")}</p>
            <p className="dcr-empty__body">{t("mantenimientos.sinMantenimientosSub")}</p>
          </div>
        </section>
      ) : (
        <>
          {total > 0 && monedaUnica ? (
            <div className="dcr-total">
              <span>
                <span className="dcr-total__lbl">{t("mantenimientos.costo")}</span>
                <span className="dcr-total__help">{t("estado.avisoMantenimiento")}</span>
              </span>
              <span className="dcr-total__val">{formatMoney(total, monedaUnica)}</span>
            </div>
          ) : null}

          <section className="dcr-card">
            {items.map((m) => (
              <article key={m.id} className="dcr-item">
                <div className="dcr-item__body">
                  <p className="dcr-h3">{m.propertyTitle}</p>
                  <p className="dcr-p">{m.description}</p>
                  <p className="dcr-muted" style={{ marginTop: 4 }}>
                    {t("fallas.reportado", {
                      fecha: formatCivilDate(civilDate(new Date(m.createdAt), tz), {
                        withYear: true,
                      }),
                    })}
                  </p>
                  <p className="dcr-muted" style={{ marginTop: 2 }}>
                    {m.vendorName
                      ? t("mantenimientos.quien", { quien: m.vendorName })
                      : t("mantenimientos.sinQuien")}
                  </p>
                </div>
                <div className="dcr-item__side">
                  <span className="dcr-item__amount">
                    {m.cost === null ? "—" : formatMoney(m.cost, m.currency)}
                  </span>
                  <span
                    className={
                      m.status === "RESUELTO"
                        ? "dcr-pill dcr-pill--ok"
                        : m.status === "EN_PROCESO"
                          ? "dcr-pill dcr-pill--neutral"
                          : "dcr-pill dcr-pill--wait"
                    }
                  >
                    {t(`fallas.estado${m.status}`)}
                  </span>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
