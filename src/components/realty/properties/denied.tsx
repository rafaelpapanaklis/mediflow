import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import s from "./properties.module.css";

/**
 * Aviso de "aquí no entras", en sus dos sabores: el plan no incluye la
 * sección o el rol no tiene el permiso.
 *
 * Es un SERVER component a propósito: se pinta en el corte del servidor,
 * antes de mandarle un solo dato al navegador. Un aviso que llegara como
 * componente cliente implicaría que los datos ya viajaron.
 *
 * 🔴 Cero precios de plan: en este panel no se anuncia cuánto cuesta nada.
 * Se dice qué falta y se manda a la pantalla de suscripción, que es la que
 * tiene esa conversación.
 */
export function RealtyDenied({
  dict,
  kind,
}: {
  dict: Dictionary;
  kind: "plan" | "permission";
}) {
  const t = makeRealtyT(dict);
  return (
    <div className={`realty-page ${s.page}`}>
      <section className={s.card}>
        <div className={s.empty}>
          <span className={s.emptyIcon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <span className={s.emptyTitle}>
            {kind === "plan" ? t("errors.planTitle") : t("errors.permTitle")}
          </span>
          <span className={s.emptyBody}>
            {kind === "plan" ? t("errors.planBody") : t("errors.permBody")}
          </span>
        </div>
      </section>
    </div>
  );
}

/**
 * Origen absoluto de la petición ("https://www.dalecontrol.com").
 *
 * Hace falta para que "copiar liga" copie algo que se pueda pegar en un
 * WhatsApp: una ruta relativa no le sirve a nadie fuera del panel. Se lee
 * de las cabeceras y no de una variable de entorno porque el mismo build
 * corre en producción y en las vistas previas de Vercel, cada una con su
 * propio dominio.
 */
export function realtyOrigin(h: ReadonlyHeaders): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
