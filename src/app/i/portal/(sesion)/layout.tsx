import { redirect } from "next/navigation";
import { getPortalScope } from "@/lib/realty/portal-auth";
import { PortalSalir } from "@/components/realty/portal/portal-salir";
import { PortalTabs } from "@/components/realty/portal/portal-tabs";

/* ═══════════════════════════════════════════════════════════════════════
   GUARD Y ARMAZÓN DE LA PARTE PRIVADA DEL PORTAL.

   El grupo (sesion) existe para que el login (/i/portal) y la pantalla de
   elegir se queden FUERA del guard sin un solo `if`: aquí dentro no hay
   nada que se pueda ver sin sesión, y ahí fuera no hay nada que la exija.

   ⚠️ ESTE GUARD NO ES EL ÚNICO. Un layout puede quedarse montado durante
   una navegación suave, así que no se vuelve a ejecutar y una sesión que
   caduque a media visita no se atraparía aquí. Por eso CADA página vuelve
   a pedir su alcance (getTenantScope / getOwnerScope) y redirige si es
   null — que además lo necesita para leer sus datos, así que no cuesta una
   consulta de más. Este layout es la primera cerradura, no la única.

   Y el armazón: cabecera pegada arriba, contenido y barra de pestañas
   abajo. La barra va FUERA de .dcr-public a propósito (container-type
   atrapa el position:fixed de sus descendientes).
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

export default async function PortalSesionLayout({ children }: { children: React.ReactNode }) {
  const scope = await getPortalScope();
  if (!scope) redirect("/i/portal");

  const { account } = scope;

  return (
    <div className="dcr-app">
      <header className="dcr-top">
        {account.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="dcr-top__logo" src={account.logoUrl} alt="" />
        ) : (
          <span className="dcr-top__logo dcr-top__logo--fallback" aria-hidden="true">
            {account.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="dcr-top__txt">
          <p className="dcr-top__name">{account.name}</p>
          <p className="dcr-top__meta">{scope.personName}</p>
        </div>
        <PortalSalir compacto />
      </header>

      <main className="dcr-public">
        <div className="dcr-shell">{children}</div>
      </main>

      <PortalTabs role={scope.role} />
    </div>
  );
}
