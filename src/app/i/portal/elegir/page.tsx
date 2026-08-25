import { redirect } from "next/navigation";
import {
  getPortalSession,
  portalIdentityKey,
  resolvePortalIdentities,
} from "@/lib/realty/portal-auth";
import { PortalElegir } from "@/components/realty/portal/portal-elegir";
import { PortalSalir } from "@/components/realty/portal/portal-salir";
import { portalT } from "@/components/realty/portal/portal-i18n";

/**
 * /i/portal/elegir — con cuál de sus dos caras entra.
 *
 * Solo se ve cuando el mismo teléfono tiene más de una relación (inquilino
 * en una inmobiliaria, propietario en otra; o las dos en la misma). Con
 * UNA sola, el servidor manda directo y esta pantalla nunca aparece.
 *
 * Es también la pantalla de "cambiar de cuenta": no hace falta pedir otro
 * código para saltar de una cara a la otra, porque el teléfono ya está
 * verificado en la cookie firmada.
 */

export const dynamic = "force-dynamic";

export default async function PortalElegirPage() {
  const session = getPortalSession();
  if (!session) redirect("/i/portal");

  const identities = await resolvePortalIdentities(session.phone);
  // Se quedó sin ninguna cara (le terminaron el contrato, la inmobiliaria
  // se dio de baja): la sesión ya no vale para nada. Al login.
  if (identities.length === 0) redirect("/i/portal");

  // 🔴 EL ATAJO SOLO VALE SI LA CARA DE LA COOKIE ES **ESA MISMA**.
  //
  // Esta página NO puede escribir cookies (es un componente de servidor):
  // la cara la fija el endpoint /auth/elegir. Comprobar solo que la cookie
  // traiga *alguna* cara abre un bucle real: alguien que entró como
  // PROPIETARIO y a quien luego le reasignaron el inmueble se queda con una
  // sola identidad (INQUILINO), esta página lo mandaría a /inquilino, el
  // guard de (sesion) no encontraría alcance para la cara guardada
  // (PROPIETARIO) y lo devolvería aquí. ERR_TOO_MANY_REDIRECTS.
  //
  // Con la llave comparada, ese caso cae al botón: un toque arregla la
  // cookie y se acabó.
  const yaFijada =
    session.role && session.accountId
      ? portalIdentityKey(session.role, session.accountId)
      : null;
  if (identities.length === 1 && yaFijada && identities[0].key === yaFijada) {
    redirect(
      identities[0].role === "INQUILINO" ? "/i/portal/inquilino" : "/i/portal/propietario",
    );
  }

  const t = portalT();

  return (
    <div className="dcr-app dcr-app--plain">
      <main className="dcr-public">
        <div className="dcr-shell">
          <PortalElegir
            opciones={identities.map((i) => ({
              key: i.key,
              role: i.role,
              accountName: i.account.name,
              accountLogoUrl: i.account.logoUrl,
              count: i.count,
            }))}
          />
          <div style={{ marginTop: 16 }}>
            <PortalSalir />
          </div>
          <p className="dcr-alert dcr-alert--note" style={{ marginTop: 14 }}>
            {t("login.pie")}
          </p>
        </div>
      </main>
    </div>
  );
}
